# Deployment

How the server side runs. Deliverable 11 of the project brief.

Files live in [`../../deploy/`](../../deploy/).

---

## 1. What runs

```text
Proxmox host (x86; arm64 also supported)
└── docker compose
    ├── backend        API + web UI + signaling relay + MQTT publisher + TLS
    │   ├── volume: data    SQLite database and snapshots
    │   └── volume: certs   local CA and server certificate
    └── mosquitto      development profile only
```

**One service in production.** The broker is an existing service on the network
([ADR-002](../adr/ADR-002-mqtt-architecture.md)); the bundled Mosquitto exists so that
development does not require one, and it never starts without `--profile dev`.

Verified:

```console
$ docker compose config --services
backend

$ docker compose --profile dev config --services
backend
mosquitto
```

---

## 2. Ports

| Port | Protocol | Who must reach it | From where |
| --- | --- | --- | --- |
| 8443 | TCP / HTTPS | Door device, tablet | LAN only |
| 1883 | TCP / MQTT | Backend → broker | Outbound, to the existing broker |
| 1883 | TCP / MQTT | Development only | Host, `--profile dev` |

**That is the whole list.** No UDP range, no TURN, no media ports.

This is worth stating because it is the operational payoff of
[ADR-001](../adr/ADR-001-webrtc-architecture.md): WebRTC runs directly between the door
device and the tablet, so no media passes through this stack. Had Janus been chosen, this
table would also carry a media port range of roughly twenty thousand UDP ports, or a
requirement for host networking that behaves differently under Docker Desktop than on the
Proxmox host — which would have made development and production diverge.

Nothing here should be exposed to the internet. The system is LAN-only.

---

## 3. Certificates and the hostname

The backend terminates TLS itself. There is no reverse proxy.

**`PUBLIC_HOSTNAME` is required and the backend refuses to start without it.** The
certificate is issued for exactly that name, DNS must resolve it on the LAN, and clients
must use it. There is no sensible default, and generating a certificate for a guessed name
would move the failure onto the tablet, far from its cause.

Two paths, both configuration rather than separate code:

| | |
| --- | --- |
| **Local CA (default)** | Leave `TLS_CERT_PATH` and `TLS_KEY_PATH` empty. The backend generates a CA and a server certificate on first start, stores them in the `certs` volume, and serves the CA certificate at `TLS_CA_DOWNLOAD_PATH` (default `/ca.crt`). |
| **Own certificate** | Set both paths. Use this for your own CA or for Let's Encrypt where the server is publicly reachable. |

The CA private key in the `certs` volume **can sign for any name**. It is the most
sensitive thing in this deployment. It never leaves the volume, and it is never committed.

### Provisioning the tablet

One-time, and all three steps fail *silently* if skipped
([ADR-003](../adr/ADR-003-client-platform.md)):

1. Install the CA certificate from `https://<PUBLIC_HOSTNAME>:8443/ca.crt`.
2. Grant the full-screen-intent permission — Android 14 does not give it by default.
3. Exempt the app from battery optimisation, so the foreground service keeps its
   connection.

The app must detect and explain each rather than simply not working.

---

## 4. First start

```console
$ cd deploy
$ cp .env.example .env
$ $EDITOR .env            # PUBLIC_HOSTNAME and MQTT_* are required
$ docker compose up -d
$ docker compose logs -f backend
```

Development, with a local broker:

```console
$ docker compose --profile dev up -d
```

---

## 5. Data and persistence

| Volume | Contents |
| --- | --- |
| `data` | SQLite database and snapshot files |
| `certs` | Local CA and server certificate |

Named volumes, so both survive `docker compose down`. **MVP acceptance criterion 13 says a
server restart must not lose stored images or events**, and that is verified by test rather
than assumed:

```console
$ docker compose down          # not -v, which would delete the volumes
$ docker compose up -d
# events and snapshots must still be present
```

`docker compose down -v` **deletes everything**, including the CA. Recreating the CA means
re-provisioning every tablet.

Backups are the `data` volume plus the `certs` volume. Snapshot retention is bounded by
`SNAPSHOT_RETENTION_DAYS`, because storage is finite and long-term recording is out of
scope.

---

## 6. Multi-architecture

The Proxmox host is x86, but arm64 must be supported. Build both:

```console
$ docker buildx build --platform linux/amd64,linux/arm64 -t doorbell-backend ../server
```

**Verified rather than assumed** — the native SQLite module is the risk, and it was tested
under emulation:

| Image, `linux/arm64` | Install | Native module loads and queries |
| --- | --- | --- |
| `node:24-bookworm-slim` | 6 s, prebuilt | yes |
| `node:24-alpine` | 6 s, prebuilt | yes |

Both work with no compiler in the image. This corrected an earlier assumption in
[ADR-004](../adr/ADR-004-backend-stack.md) that musl lacked arm64 prebuilds.

The rule that survives: **a multi-architecture image must be verified to run, not merely
to build.** A native module that silently compiles is a slow build; one that silently
fails on arm64 is a broken deployment found late.

---

## 7. Secrets

Nothing sensitive is committed. `.env` is git-ignored; `.env.example` carries names and
descriptions only.

| Secret | Lives in | Must never be in |
| --- | --- | --- |
| MQTT username and password | `.env` on the host | The device, the app, git |
| Device token | Device NVS and the database | git |
| CA private key | `certs` volume | Anywhere else |
| Pairing code | `.env`, rotated after use | git |

The door device holds exactly one secret, its own token, because it is the component an
attacker can physically reach.

---

## 8. Operations

**Restart policy** is `unless-stopped`, with a health check on `/api/v1/health`. The check
disables TLS verification for that one command, because the certificate is issued for
`PUBLIC_HOSTNAME` and the check connects to `127.0.0.1`.

**Logs** are structured JSON, rotated at 10 MB with three files kept, so an unattended
service cannot fill the disk.

**The backend is in the critical event path** ([ADR-002](../adr/ADR-002-mqtt-architecture.md)).
That risk was accepted, and the restart policy plus health check is the mitigation. The
device queues events locally and retries, so a backend restart delays events rather than
losing them.

---

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Backend exits immediately | `PUBLIC_HOSTNAME` unset. It is meant to fail loudly. |
| Tablet shows a certificate warning | CA certificate not installed, or the client is using an IP or a name the certificate was not issued for |
| App installs but never rings | Full-screen-intent permission not granted, or the app is battery-optimised and its service was killed |
| Ring reaches Home Assistant but not the tablet | WebSocket down. The app must show its connection state — check there first. |
| No MQTT messages | Check `bridge/availability`. If it reads `offline`, the backend is not connected to the broker. |
| Device state stuck at `unreachable` | `DEVICE_STALE_AFTER_MS` shorter than the real quiet period, or the device is genuinely not reporting |
| Live video never starts | Device already outside its wake window. It cannot be called once powered off — this is by design, not a fault. |

The last row is the one most likely to be mistaken for a bug. See
[`../architecture.md`](../architecture.md) section 7.

---

## 10. Not deployed

- **No Janus.** ADR-001 rejected it; there is no media server and no `JANUS_URL`.
- **No TURN or STUN.** LAN-only, host candidates suffice.
- **No reverse proxy.** The backend terminates TLS.
- **No production Mosquitto.** The broker belongs to the existing home automation.
