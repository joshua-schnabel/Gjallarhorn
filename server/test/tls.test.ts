import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { ensureTls, leafNeedsReissue } from '../src/tls.ts';

let dir = '';

before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'doorbell-tls-'));
});

after(async () => {
    await rm(dir, { recursive: true, force: true });
});

function configFor(hostname: string, certsDir: string) {
    return loadConfig({
        PUBLIC_HOSTNAME: hostname,
        MQTT_HOST: 'mosquitto',
        TLS_CERTS_DIR: certsDir,
        DATA_DIR: certsDir,
    });
}

describe('ensureTls', () => {
    test('generates a CA and a server certificate on first start', async () => {
        const certsDir = join(dir, 'first');
        const material = await ensureTls(configFor('doorbell.lan', certsDir));

        assert.equal(material.source, 'generated');
        assert.ok(material.caCert, 'a CA certificate is produced for tablet onboarding');

        // Verified through Node's own X.509 parser rather than the library that made it.
        const cert = new X509Certificate(material.cert);
        assert.match(cert.subjectAltName ?? '', /DNS:doorbell\.lan/);
        assert.ok(cert.validTo);

        // The material is persisted, so a restart does not invalidate the tablet's trust.
        await readFile(join(certsDir, 'ca.crt'), 'utf8');
        await readFile(join(certsDir, 'ca.key'), 'utf8');
        await readFile(join(certsDir, 'server.crt'), 'utf8');
    });

    test('the server certificate is signed by the generated CA', async () => {
        const certsDir = join(dir, 'chain');
        const material = await ensureTls(configFor('doorbell.lan', certsDir));

        const leaf = new X509Certificate(material.cert);
        const ca = new X509Certificate(material.caCert ?? '');

        assert.ok(leaf.verify(ca.publicKey), 'leaf verifies against the CA public key');
        assert.equal(ca.ca, true, 'the CA certificate is marked as a CA');
    });

    test('reuses existing material on the next start', async () => {
        const certsDir = join(dir, 'reuse');
        const first = await ensureTls(configFor('doorbell.lan', certsDir));
        const second = await ensureTls(configFor('doorbell.lan', certsDir));

        assert.equal(second.source, 'reused');
        assert.equal(second.cert, first.cert, 'the certificate is not regenerated');
        assert.equal(second.caCert, first.caCert, 'the CA is stable across restarts');
    });

    test('re-issues the leaf when the hostname changes, keeping the CA', async () => {
        const certsDir = join(dir, 'rename');
        const first = await ensureTls(configFor('old.lan', certsDir));
        const second = await ensureTls(configFor('new.lan', certsDir));

        assert.equal(second.source, 'generated');
        assert.equal(second.caCert, first.caCert, 'the CA survives, so tablets stay provisioned');
        assert.match(new X509Certificate(second.cert).subjectAltName ?? '', /DNS:new\.lan/);
    });

    test('uses supplied certificate and key when configured', async () => {
        const certsDir = join(dir, 'supplied');
        const generated = await ensureTls(configFor('doorbell.lan', certsDir));

        const certFile = join(dir, 'own.crt');
        const keyFile = join(dir, 'own.key');
        await writeFile(certFile, generated.cert);
        await writeFile(keyFile, generated.key);

        const config = loadConfig({
            PUBLIC_HOSTNAME: 'doorbell.lan',
            MQTT_HOST: 'mosquitto',
            TLS_CERT_PATH: certFile,
            TLS_KEY_PATH: keyFile,
        });
        const material = await ensureTls(config);

        assert.equal(material.source, 'supplied');
        assert.equal(material.caCert, undefined, 'no CA is offered for a supplied certificate');
        assert.equal(material.cert, generated.cert);
    });
});

describe('leafNeedsReissue', () => {
    test('true when there is no certificate', () => {
        assert.equal(leafNeedsReissue(undefined, 'doorbell.lan'), true);
    });

    test('true when the certificate is unparseable', () => {
        assert.equal(leafNeedsReissue('not a certificate', 'doorbell.lan'), true);
    });

    test('false for a fresh certificate with the right name', async () => {
        const certsDir = join(dir, 'fresh');
        const material = await ensureTls(configFor('doorbell.lan', certsDir));
        assert.equal(leafNeedsReissue(material.cert, 'doorbell.lan'), false);
    });

    test('true when the certificate is for a different name', async () => {
        const certsDir = join(dir, 'othername');
        const material = await ensureTls(configFor('doorbell.lan', certsDir));
        assert.equal(leafNeedsReissue(material.cert, 'something-else.lan'), true);
    });
});
