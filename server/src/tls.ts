/**
 * TLS material.
 *
 * Either a certificate supplied by the operator, or a local CA and server certificate the
 * service generates and reuses.
 *
 * The generated path exists so that a first-time user gets a working, genuinely trusted
 * origin without arranging a CA. That matters more than it sounds: Chrome refuses to
 * register a service worker on an origin with a certificate error, and the Android client
 * has to trust the origin for WebRTC permission prompts to behave. See ADR-003.
 *
 * Certificate generation uses `node-forge` because Node's crypto module can generate keys
 * but cannot issue X.509 certificates. It is pure JavaScript, so it adds no native
 * dependency and does not complicate multi-architecture builds.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import forge from 'node-forge';
import type { Config } from './config.ts';

export interface TlsMaterial {
    readonly cert: string;
    readonly key: string;
    /** PEM of the local CA, when one was generated. Absent for supplied certificates. */
    readonly caCert: string | undefined;
    readonly source: 'supplied' | 'generated' | 'reused';
}

/** Long, because re-issuing it means re-provisioning every tablet. */
const CA_VALIDITY_DAYS = 3650;
/** Short enough to stay conventional, long enough not to be a chore. */
const LEAF_VALIDITY_DAYS = 397;
/** Re-issue the leaf when it has less than this left, so it never silently expires. */
const LEAF_RENEW_BEFORE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * DAY_MS);
}

function generateKeyPair(): forge.pki.rsa.KeyPair {
    return forge.pki.rsa.generateKeyPair({ bits: 2048 });
}

function randomSerial(): string {
    // Leading '00' keeps the integer positive when DER-encoded.
    return '00' + forge.util.bytesToHex(forge.random.getBytesSync(16));
}

function createCa(hostname: string): { certPem: string; keyPem: string } {
    const keys = generateKeyPair();
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = randomSerial();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = daysFromNow(CA_VALIDITY_DAYS);

    const attrs: forge.pki.CertificateField[] = [
        { name: 'commonName', value: `Doorbell local CA (${hostname})` },
        { name: 'organizationName', value: 'Doorbell' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
        { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    return {
        certPem: forge.pki.certificateToPem(cert),
        keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    };
}

function createLeaf(
    hostname: string,
    caCertPem: string,
    caKeyPem: string,
): { certPem: string; keyPem: string } {
    const caCert = forge.pki.certificateFromPem(caCertPem);
    const caKey = forge.pki.privateKeyFromPem(caKeyPem);

    const keys = generateKeyPair();
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = randomSerial();
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = daysFromNow(LEAF_VALIDITY_DAYS);

    cert.setSubject([{ name: 'commonName', value: hostname }]);
    cert.setIssuer(caCert.subject.attributes);
    cert.setExtensions([
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
            name: 'subjectAltName',
            // The hostname is what clients validate. localhost and the loopback address
            // are included so the container health check can reach the same listener.
            altNames: [
                { type: 2, value: hostname },
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
            ],
        },
    ]);
    cert.sign(caKey, forge.md.sha256.create());

    return {
        certPem: forge.pki.certificateToPem(cert),
        keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    };
}

async function readIfPresent(path: string): Promise<string | undefined> {
    try {
        return await readFile(path, 'utf8');
    } catch {
        return undefined;
    }
}

/** True when the certificate is missing, unreadable, expiring soon, or for another name. */
export function leafNeedsReissue(certPem: string | undefined, hostname: string): boolean {
    if (certPem === undefined) return true;
    let cert: forge.pki.Certificate;
    try {
        cert = forge.pki.certificateFromPem(certPem);
    } catch {
        return true;
    }
    if (cert.validity.notAfter.getTime() - Date.now() < LEAF_RENEW_BEFORE_DAYS * DAY_MS) return true;

    const san = cert.getExtension('subjectAltName') as
        { altNames?: Array<{ type: number; value?: string }> } | undefined;
    const names = san?.altNames?.filter((n) => n.type === 2).map((n) => n.value) ?? [];
    return !names.includes(hostname);
}

/**
 * Returns usable TLS material, generating and persisting a local CA and certificate when
 * none was supplied. Reuses what is already on disk unless it is unusable for the
 * configured hostname.
 */
export async function ensureTls(config: Config): Promise<TlsMaterial> {
    const { certPath, keyPath, certsDir } = config.tls;

    if (certPath !== undefined && keyPath !== undefined) {
        const [cert, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
        return { cert, key, caCert: undefined, source: 'supplied' };
    }

    await mkdir(certsDir, { recursive: true });

    const caCertFile = join(certsDir, 'ca.crt');
    const caKeyFile = join(certsDir, 'ca.key');
    const leafCertFile = join(certsDir, 'server.crt');
    const leafKeyFile = join(certsDir, 'server.key');

    let caCertPem = await readIfPresent(caCertFile);
    let caKeyPem = await readIfPresent(caKeyFile);

    if (caCertPem === undefined || caKeyPem === undefined) {
        const ca = createCa(config.publicHostname);
        caCertPem = ca.certPem;
        caKeyPem = ca.keyPem;
        await writeFile(caCertFile, caCertPem, { mode: 0o644 });
        // The CA key can sign for any name. It is the most sensitive file here.
        await writeFile(caKeyFile, caKeyPem, { mode: 0o600 });
    }

    const existingLeaf = await readIfPresent(leafCertFile);
    const existingLeafKey = await readIfPresent(leafKeyFile);

    if (
        existingLeaf !== undefined &&
        existingLeafKey !== undefined &&
        !leafNeedsReissue(existingLeaf, config.publicHostname)
    ) {
        return { cert: existingLeaf, key: existingLeafKey, caCert: caCertPem, source: 'reused' };
    }

    const leaf = createLeaf(config.publicHostname, caCertPem, caKeyPem);
    await writeFile(leafCertFile, leaf.certPem, { mode: 0o644 });
    await writeFile(leafKeyFile, leaf.keyPem, { mode: 0o600 });

    return { cert: leaf.certPem, key: leaf.keyPem, caCert: caCertPem, source: 'generated' };
}
