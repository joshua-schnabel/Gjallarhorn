#!/usr/bin/env node
/**
 * TLS assertions against a running backend.
 *
 * Bootstraps trust the way a tablet does — fetch the CA over an unverified connection,
 * then reconnect with strict verification — and then proves that the verification is not
 * vacuous by checking that a wrong hostname and an unrelated CA are both rejected.
 *
 * That last part is the point. A passing TLS handshake says very little on its own; a
 * handshake that passes for the right name and fails for the wrong one says the chain is
 * real.
 *
 * Usage: node scripts/verify-tls.mjs <host> <port> <expected-hostname>
 */

import https from 'node:https';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

const [host = '127.0.0.1', port = '18443', servername = 'doorbell.lan'] = process.argv.slice(2);

const failures = [];

function check(name, ok, detail = '') {
    const status = ok ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(name);
}

function get(path, options) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            { host, port: Number(port), path, method: 'GET', timeout: 15000, ...options },
            (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => resolve({ status: res.statusCode, body }));
            },
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        req.end();
    });
}

/** Resolves to the error when the request fails, and rejects when it unexpectedly succeeds. */
async function expectRejection(name, options) {
    try {
        await get('/api/v1/health', options);
        check(name, false, 'the connection was accepted when it should have been refused');
    } catch (err) {
        check(name, true, err.code ?? err.message);
    }
}

console.log(`TLS verification against https://${servername} (${host}:${port})`);

// 1. Unverified fetch of the CA — how a tablet bootstraps trust.
const caResponse = await get('/ca.crt', { rejectUnauthorized: false });
check('CA certificate is served', caResponse.status === 200, `HTTP ${caResponse.status}`);

const caPem = caResponse.body;
check('CA download looks like PEM', caPem.includes('BEGIN CERTIFICATE'));

let caCert;
try {
    caCert = new X509Certificate(caPem);
    check('CA parses and is marked as a CA', caCert.ca === true, caCert.subject.replace(/\n/g, ' '));
} catch (err) {
    check('CA parses', false, err.message);
}

// 2. Strict verification against that CA, with the hostname the certificate is issued for.
try {
    const res = await get('/api/v1/health', {
        ca: caPem,
        servername,
        rejectUnauthorized: true,
        checkServerIdentity: (_host, cert) => tls.checkServerIdentity(servername, cert),
    });
    check('strict TLS verification succeeds', res.status === 200, `health: ${res.body}`);
} catch (err) {
    check('strict TLS verification succeeds', false, err.message);
}

// 3. The negative cases. Without these, the positive case proves nothing.
await expectRejection('a wrong hostname is rejected', {
    ca: caPem,
    servername: 'wrong.invalid',
    rejectUnauthorized: true,
    checkServerIdentity: (_host, cert) => tls.checkServerIdentity('wrong.invalid', cert),
});

await expectRejection('an unrelated CA is rejected', {
    ca: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    servername,
    rejectUnauthorized: true,
});

if (failures.length > 0) {
    console.error(`\n${failures.length} TLS check(s) failed: ${failures.join(', ')}`);
    process.exit(1);
}
console.log('\nAll TLS checks passed.');
