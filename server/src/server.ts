/**
 * Service entry point.
 *
 * Order matters here: configuration is validated before anything else happens, and TLS
 * material is resolved before the listener starts. A misconfigured service must fail here
 * with a readable message rather than start and fail later somewhere less obvious.
 */

import { mkdir } from 'node:fs/promises';
import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { ensureTls } from './tls.ts';

async function main(): Promise<void> {
    const config = loadConfig();

    await mkdir(config.dataDir, { recursive: true });
    await mkdir(config.snapshotDir, { recursive: true });

    const tls = await ensureTls(config);

    const app = await buildApp({ config, caCert: tls.caCert });

    // Fastify cannot be given TLS material after construction, so the HTTPS server is
    // built here and Fastify's handler is attached to it.
    const { createServer } = await import('node:https');
    const server = createServer({ cert: tls.cert, key: tls.key });
    server.on('request', (req, res) => {
        app.server.emit('request', req, res);
    });

    await app.ready();

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.httpPort, '0.0.0.0', () => {
            server.removeListener('error', reject);
            resolve();
        });
    });

    app.log.info(
        {
            publicHostname: config.publicHostname,
            port: config.httpPort,
            tls: tls.source,
            caDownloadPath: tls.caCert !== undefined ? config.tls.caDownloadPath : undefined,
        },
        'backend listening',
    );

    if (tls.source === 'generated') {
        app.log.info(
            `A local CA was generated. Install it on the tablet from ` +
                `https://${config.publicHostname}:${config.httpPort}${config.tls.caDownloadPath} ` +
                `before pairing, otherwise the client cannot trust this server.`,
        );
    }

    const shutdown = (signal: string): void => {
        app.log.info({ signal }, 'shutting down');
        server.close(() => {
            void app.close().then(() => process.exit(0));
        });
        // Do not wait forever for connections to drain.
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
    await main();
} catch (error) {
    if (error instanceof ConfigError) {
        // Deliberately not a stack trace: this is an operator error, and the message
        // already says what to fix.
        process.stderr.write(`\n${error.message}\n`);
        process.exit(78); // EX_CONFIG
    }
    process.stderr.write(`\nFailed to start: ${String(error)}\n`);
    process.exit(1);
}
