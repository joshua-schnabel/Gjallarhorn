/**
 * Fastify application factory.
 *
 * Kept separate from the server entry point so tests can build an app and drive it with
 * `fastify.inject()` without opening a socket or needing TLS material.
 */

import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { Config } from './config.ts';

export interface AppDeps {
    readonly config: Config;
    /** PEM of the local CA, served for tablet onboarding. Absent for supplied certificates. */
    readonly caCert?: string | undefined;
}

const HealthSchema = Type.Object({
    status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
});

const ProblemSchema = Type.Object({
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer(),
    detail: Type.Optional(Type.String()),
    requestId: Type.Optional(Type.String()),
});

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
    const { config, caCert } = deps;

    const app = Fastify({
        logger: {
            level: config.logLevel,
            // Secrets must never reach the log. Redaction is structural rather than a
            // matter of remembering not to log them (AGENTS.md section 5).
            redact: {
                paths: [
                    'req.headers.authorization',
                    'req.headers.cookie',
                    'password',
                    'token',
                    'pairingCode',
                    '*.password',
                    '*.token',
                ],
                censor: '[redacted]',
            },
            serializers: {
                req(req: { method: string; url: string; id?: string }) {
                    return { method: req.method, url: req.url, id: req.id };
                },
            },
        },
        // Fastify generates a request id; it appears in every log line and in problem
        // responses, which is what makes a report traceable to a log.
        requestIdHeader: 'x-request-id',
        trustProxy: false,
        bodyLimit: 1024 * 1024,
    });

    // RFC 9457 problem details for every error, so clients see one shape.
    app.setErrorHandler((error: FastifyError, request, reply) => {
        const status = error.statusCode ?? 500;
        if (status >= 500) request.log.error({ err: error }, 'request failed');
        else request.log.warn({ err: error, status }, 'request rejected');

        void reply
            .status(status)
            .type('application/problem+json')
            .send({
                type: 'about:blank',
                title: status >= 500 ? 'Internal Server Error' : error.message,
                status,
                requestId: request.id,
            });
    });

    app.setNotFoundHandler((request, reply) => {
        void reply.status(404).type('application/problem+json').send({
            type: 'about:blank',
            title: 'Not Found',
            status: 404,
            requestId: request.id,
        });
    });

    app.get(
        '/api/v1/health',
        {
            schema: {
                response: { 200: HealthSchema, 503: ProblemSchema },
            },
        },
        async () => {
            // Subsystem reporting arrives with the subsystems. Claiming to check MQTT
            // before an MQTT client exists would be a health check that lies.
            return { status: 'ok' as const };
        },
    );

    if (caCert !== undefined) {
        // Served unauthenticated on purpose: it is a public certificate, and the tablet
        // needs it before it can trust anything else here.
        app.get(config.tls.caDownloadPath, async (_request, reply) => {
            return reply
                .type('application/x-x509-ca-cert')
                .header('content-disposition', 'attachment; filename="doorbell-ca.crt"')
                .send(caCert);
        });
    }

    return app;
}
