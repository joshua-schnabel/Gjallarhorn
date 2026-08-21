/**
 * Configuration loading and validation.
 *
 * Everything the service needs comes from the environment, and everything that has a
 * sensible default has one. The values that cannot have a default are required, and the
 * service refuses to start without them.
 *
 * That refusal is the point. `PUBLIC_HOSTNAME` in particular decides which name the TLS
 * certificate is issued for; starting with a guess would produce a certificate the tablet
 * rejects, and the failure would surface far from its cause.
 */

export interface MqttConfig {
    readonly host: string;
    readonly port: number;
    readonly username: string | undefined;
    readonly password: string | undefined;
    readonly baseTopic: string;
    readonly reconnectMaxMs: number;
}

export interface TlsConfig {
    /** Supplied certificate. When absent, a local CA and certificate are generated. */
    readonly certPath: string | undefined;
    readonly keyPath: string | undefined;
    /** Where generated material is stored and looked for. */
    readonly certsDir: string;
    /** Path the tablet fetches the CA certificate from during onboarding. */
    readonly caDownloadPath: string;
}

export interface Config {
    readonly publicHostname: string;
    readonly httpPort: number;
    readonly tls: TlsConfig;
    readonly dataDir: string;
    readonly snapshotDir: string;
    readonly snapshotMaxBytes: number;
    readonly snapshotRetentionDays: number;
    readonly motionCooldownMs: number;
    readonly deviceStaleAfterMs: number;
    readonly mqtt: MqttConfig;
    readonly pairingCode: string | undefined;
    readonly logLevel: LogLevel;
}

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export class ConfigError extends Error {
    readonly problems: readonly string[];

    constructor(problems: readonly string[]) {
        super(
            `Configuration is invalid, refusing to start:\n\n` +
                problems.map((p) => `  - ${p}`).join('\n') +
                `\n\nSee deploy/.env.example for every setting and what it does.\n`,
        );
        this.name = 'ConfigError';
        this.problems = problems;
    }
}

/** Hostnames only: no scheme, no port, no path. That is what a certificate is issued for. */
const HOSTNAME_PATTERN =
    /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

type Env = Record<string, string | undefined>;

class Collector {
    readonly problems: string[] = [];
    private readonly env: Env;

    // An explicit field rather than a parameter property: parameter properties are not
    // erasable syntax, and Node runs this TypeScript directly by stripping types.
    constructor(env: Env) {
        this.env = env;
    }

    required(key: string, why: string): string {
        const raw = this.env[key]?.trim();
        if (raw === undefined || raw === '') {
            this.problems.push(`${key} is required. ${why}`);
            return '';
        }
        return raw;
    }

    optional(key: string): string | undefined {
        const raw = this.env[key]?.trim();
        return raw === undefined || raw === '' ? undefined : raw;
    }

    string(key: string, fallback: string): string {
        return this.optional(key) ?? fallback;
    }

    integer(key: string, fallback: number, min: number, max: number): number {
        const raw = this.optional(key);
        if (raw === undefined) return fallback;
        if (!/^-?\d+$/.test(raw)) {
            this.problems.push(`${key} must be a whole number, got "${raw}".`);
            return fallback;
        }
        const value = Number.parseInt(raw, 10);
        if (value < min || value > max) {
            this.problems.push(`${key} must be between ${min} and ${max}, got ${value}.`);
            return fallback;
        }
        return value;
    }

    hostname(key: string, why: string): string {
        const raw = this.required(key, why);
        if (raw === '') return raw;
        if (raw.includes('://') || raw.includes('/') || raw.includes(':')) {
            this.problems.push(
                `${key} must be a bare hostname, not a URL. Got "${raw}". ` +
                    `A TLS certificate is issued for a name, not for a scheme or a port.`,
            );
            return raw;
        }
        if (!HOSTNAME_PATTERN.test(raw)) {
            this.problems.push(`${key} is not a valid hostname: "${raw}".`);
        }
        return raw;
    }

    logLevel(key: string, fallback: LogLevel): LogLevel {
        const raw = this.optional(key);
        if (raw === undefined) return fallback;
        if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
            this.problems.push(`${key} must be one of ${LOG_LEVELS.join(', ')}, got "${raw}".`);
            return fallback;
        }
        return raw as LogLevel;
    }
}

/**
 * Builds the configuration, or throws {@link ConfigError} listing every problem at once.
 *
 * Reporting all problems together is deliberate: fixing a `.env` one restart at a time is
 * needlessly slow when the file is right there.
 */
export function loadConfig(env: Env = process.env): Config {
    const c = new Collector(env);

    const publicHostname = c.hostname(
        'PUBLIC_HOSTNAME',
        'It is the name the tablet and the door device use to reach this server, and the ' +
            'name the TLS certificate is issued for. DNS must resolve it on the LAN. ' +
            'There is no safe default: a guessed name produces a certificate the tablet rejects.',
    );

    const mqttHost = c.required(
        'MQTT_HOST',
        'Home automation integration publishes through this broker. ' +
            'Use the bundled development broker with `docker compose --profile dev up`.',
    );

    const certPath = c.optional('TLS_CERT_PATH');
    const keyPath = c.optional('TLS_KEY_PATH');
    if ((certPath === undefined) !== (keyPath === undefined)) {
        c.problems.push(
            'TLS_CERT_PATH and TLS_KEY_PATH must be set together, or both left empty to ' +
                'generate a local CA and certificate on first start.',
        );
    }

    const dataDir = c.string('DATA_DIR', '/data');

    const config: Config = {
        publicHostname,
        httpPort: c.integer('HTTP_PORT', 8443, 1, 65535),
        tls: {
            certPath,
            keyPath,
            certsDir: c.string('TLS_CERTS_DIR', '/certs'),
            caDownloadPath: c.string('TLS_CA_DOWNLOAD_PATH', '/ca.crt'),
        },
        dataDir,
        snapshotDir: c.string('SNAPSHOT_DIR', `${dataDir}/snapshots`),
        snapshotMaxBytes: c.integer('SNAPSHOT_MAX_BYTES', 2 * 1024 * 1024, 1024, 64 * 1024 * 1024),
        snapshotRetentionDays: c.integer('SNAPSHOT_RETENTION_DAYS', 30, 1, 3650),
        motionCooldownMs: c.integer('MOTION_COOLDOWN_MS', 60_000, 0, 24 * 60 * 60 * 1000),
        deviceStaleAfterMs: c.integer('DEVICE_STALE_AFTER_MS', 30 * 60_000, 60_000, 30 * 24 * 60 * 60 * 1000),
        mqtt: {
            host: mqttHost,
            port: c.integer('MQTT_PORT', 1883, 1, 65535),
            username: c.optional('MQTT_USERNAME'),
            password: c.optional('MQTT_PASSWORD'),
            baseTopic: c.string('MQTT_BASE_TOPIC', 'doorbell'),
            reconnectMaxMs: c.integer('MQTT_RECONNECT_MAX_MS', 60_000, 1000, 60 * 60 * 1000),
        },
        pairingCode: c.optional('PAIRING_CODE'),
        logLevel: c.logLevel('LOG_LEVEL', 'info'),
    };

    if (c.problems.length > 0) throw new ConfigError(c.problems);
    return config;
}

/** Keys whose values must never be logged. */
export const SECRET_ENV_KEYS = ['MQTT_PASSWORD', 'PAIRING_CODE', 'TLS_KEY_PATH'] as const;
