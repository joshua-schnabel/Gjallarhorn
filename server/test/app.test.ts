import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

function testConfig(overrides: Record<string, string> = {}) {
    return loadConfig({
        PUBLIC_HOSTNAME: 'doorbell.lan',
        MQTT_HOST: 'mosquitto',
        LOG_LEVEL: 'error', // keep test output readable
        ...overrides,
    });
}

describe('health', () => {
    test('answers with the shape the API specification declares', async () => {
        const app = await buildApp({ config: testConfig() });
        try {
            const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

            assert.equal(response.statusCode, 200);
            assert.deepEqual(response.json(), { status: 'ok' });
        } finally {
            await app.close();
        }
    });

    test('does not claim to check subsystems that do not exist yet', async () => {
        // mqttConnected is optional in the spec. Reporting it before an MQTT client
        // exists would be a health check that lies.
        const app = await buildApp({ config: testConfig() });
        try {
            const body = (await app.inject({ method: 'GET', url: '/api/v1/health' })).json();
            assert.equal('mqttConnected' in (body as object), false);
        } finally {
            await app.close();
        }
    });
});

describe('errors', () => {
    test('unknown routes return RFC 9457 problem details', async () => {
        const app = await buildApp({ config: testConfig() });
        try {
            const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });

            assert.equal(response.statusCode, 404);
            assert.match(response.headers['content-type'] ?? '', /application\/problem\+json/);

            const body = response.json() as Record<string, unknown>;
            assert.equal(body['status'], 404);
            assert.equal(body['title'], 'Not Found');
            assert.ok(body['requestId'], 'a request id ties the response to the logs');
        } finally {
            await app.close();
        }
    });
});

describe('CA download', () => {
    test('serves the CA certificate unauthenticated when one was generated', async () => {
        // The tablet needs this before it can trust anything else here, so it cannot be
        // behind authentication. It is a public certificate.
        const app = await buildApp({ config: testConfig(), caCert: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n' });
        try {
            const response = await app.inject({ method: 'GET', url: '/ca.crt' });

            assert.equal(response.statusCode, 200);
            assert.match(response.headers['content-type'] ?? '', /x-x509-ca-cert/);
            assert.match(response.headers['content-disposition'] ?? '', /attachment/);
            assert.match(response.body, /BEGIN CERTIFICATE/);
        } finally {
            await app.close();
        }
    });

    test('is absent when the operator supplied their own certificate', async () => {
        const app = await buildApp({ config: testConfig() });
        try {
            const response = await app.inject({ method: 'GET', url: '/ca.crt' });
            assert.equal(response.statusCode, 404);
        } finally {
            await app.close();
        }
    });

    test('honours a configured download path', async () => {
        const app = await buildApp({
            config: testConfig({ TLS_CA_DOWNLOAD_PATH: '/pki/root.crt' }),
            caCert: 'x',
        });
        try {
            assert.equal((await app.inject({ method: 'GET', url: '/pki/root.crt' })).statusCode, 200);
            assert.equal((await app.inject({ method: 'GET', url: '/ca.crt' })).statusCode, 404);
        } finally {
            await app.close();
        }
    });
});
