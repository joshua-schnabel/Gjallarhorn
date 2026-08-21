import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from '../src/config.ts';

/** The minimum that must be present for a valid configuration. */
const MINIMAL = {
    PUBLIC_HOSTNAME: 'doorbell.lan',
    MQTT_HOST: 'mosquitto',
} as const;

describe('loadConfig', () => {
    test('accepts a minimal configuration and applies defaults', () => {
        const config = loadConfig({ ...MINIMAL });

        assert.equal(config.publicHostname, 'doorbell.lan');
        assert.equal(config.httpPort, 8443);
        assert.equal(config.mqtt.port, 1883);
        assert.equal(config.mqtt.baseTopic, 'doorbell');
        assert.equal(config.logLevel, 'info');
        assert.equal(config.snapshotDir, '/data/snapshots');
    });

    test('refuses to start without PUBLIC_HOSTNAME', () => {
        // The acceptance criterion: it must fail, not guess a name.
        assert.throws(
            () => loadConfig({ MQTT_HOST: 'mosquitto' }),
            (error: unknown) => {
                assert.ok(error instanceof ConfigError);
                assert.ok(error.problems.some((p) => p.startsWith('PUBLIC_HOSTNAME is required')));
                return true;
            },
        );
    });

    test('reports every problem at once rather than one per restart', () => {
        try {
            loadConfig({ HTTP_PORT: 'not-a-number', LOG_LEVEL: 'shouty' });
            assert.fail('expected ConfigError');
        } catch (error) {
            assert.ok(error instanceof ConfigError);
            const joined = error.problems.join('\n');
            assert.match(joined, /PUBLIC_HOSTNAME is required/);
            assert.match(joined, /MQTT_HOST is required/);
            assert.match(joined, /HTTP_PORT must be a whole number/);
            assert.match(joined, /LOG_LEVEL must be one of/);
            assert.ok(error.problems.length >= 4, 'all four problems reported together');
        }
    });

    test('rejects a URL where a hostname is required', () => {
        // A common mistake, and one that would otherwise produce a certificate for a
        // name nothing validates against.
        try {
            loadConfig({ ...MINIMAL, PUBLIC_HOSTNAME: 'https://doorbell.lan:8443' });
            assert.fail('expected ConfigError');
        } catch (error) {
            assert.ok(error instanceof ConfigError);
            assert.match(error.problems.join('\n'), /must be a bare hostname, not a URL/);
        }
    });

    test('rejects a malformed hostname', () => {
        assert.throws(() => loadConfig({ ...MINIMAL, PUBLIC_HOSTNAME: 'not a hostname' }), ConfigError);
    });

    test('rejects out-of-range ports', () => {
        assert.throws(() => loadConfig({ ...MINIMAL, HTTP_PORT: '70000' }), ConfigError);
        assert.throws(() => loadConfig({ ...MINIMAL, HTTP_PORT: '0' }), ConfigError);
    });

    test('requires TLS certificate and key together', () => {
        try {
            loadConfig({ ...MINIMAL, TLS_CERT_PATH: '/certs/server.crt' });
            assert.fail('expected ConfigError');
        } catch (error) {
            assert.ok(error instanceof ConfigError);
            assert.match(error.problems.join('\n'), /must be set together/);
        }
        // Both set is fine.
        const config = loadConfig({ ...MINIMAL, TLS_CERT_PATH: '/a.crt', TLS_KEY_PATH: '/a.key' });
        assert.equal(config.tls.certPath, '/a.crt');
    });

    test('treats empty strings as absent', () => {
        // Docker passes through empty variables from .env; they must not count as set.
        assert.throws(() => loadConfig({ PUBLIC_HOSTNAME: '  ', MQTT_HOST: 'x' }), ConfigError);
        const config = loadConfig({ ...MINIMAL, MQTT_USERNAME: '' });
        assert.equal(config.mqtt.username, undefined);
    });

    test('snapshotDir follows dataDir unless set explicitly', () => {
        assert.equal(loadConfig({ ...MINIMAL, DATA_DIR: '/var/doorbell' }).snapshotDir, '/var/doorbell/snapshots');
        assert.equal(
            loadConfig({ ...MINIMAL, DATA_DIR: '/var/doorbell', SNAPSHOT_DIR: '/mnt/pics' }).snapshotDir,
            '/mnt/pics',
        );
    });

    test('the error message tells the operator where to look', () => {
        try {
            loadConfig({});
            assert.fail('expected ConfigError');
        } catch (error) {
            assert.ok(error instanceof ConfigError);
            assert.match(error.message, /refusing to start/);
            assert.match(error.message, /deploy\/\.env\.example/);
        }
    });
});
