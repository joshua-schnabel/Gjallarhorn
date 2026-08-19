# WP-10: Deployment topology

| | |
| --- | --- |
| **Status** | todo |
| **Phase** | 0 |
| **Depends on** | WP-08 |
| **Blocks** | Phase 2, Phase 5 |

## Goal

Define how the server side is deployed and operated: the Docker Compose target
architecture, the network and port map, volumes, and secret handling. This is
deliverable 11 of the project brief.

## Tasks

### Compose architecture
- [ ] Define the services: backend, plus Janus if ADR-001 selected it, plus an optional
      Mosquitto for development only — the production broker belongs to the existing home
      automation and is external
- [ ] Define volumes so that data survives a container restart: the SQLite database and
      the snapshot directory. This is MVP acceptance criterion 13 and must be verified,
      not assumed.
- [ ] Health checks per service, and restart policies
- [ ] Resource limits where they matter
- [ ] Keep it to what is actually needed. No orchestration, no reverse proxy, no extra
      services unless something concrete requires them (AGENTS.md section 4).

### Networking
- [ ] Port map: which service listens on what, and which ports must be reachable from
      the door device, from the tablet, and from nowhere else
- [ ] If Janus is used: the UDP port range for media, and what that means for the host
      firewall and for Docker's networking mode. This is where naive port mapping tends
      to break WebRTC, so it needs deliberate handling.
- [ ] ICE and STUN configuration for LAN-only operation, and whether TURN is needed at
      all locally
- [ ] Restrict administrative and monitoring interfaces to the internal network
      (project brief section 27)

### TLS and secure context
- [ ] Resolve how the client gets a secure context, which WP-06 will have established as
      a hard requirement for microphone access. Options include a locally trusted
      certificate or a reverse proxy terminating TLS.
- [ ] Support plain HTTP for local development without making it the deployed default

### Secrets and configuration
- [ ] Environment variable and secret file scheme; nothing sensitive in the repository
- [ ] Provide `.env.example` with every required variable documented and no real values
- [ ] Map the configuration values from the project brief section 26 onto the components
      that actually need them
- [ ] Document how the device token and MQTT credentials are provisioned

### Documentation
- [ ] Startup instructions, reproducible from a clean checkout
- [ ] Network and port overview
- [ ] Troubleshooting notes for the failure modes seen during the spikes

## Deliverables

- `deploy/docker-compose.yml` and supporting files
- `deploy/.env.example`
- `docs/architecture/deployment.md`

## Acceptance

- `docker compose up` starts the whole server side from a clean checkout, using only
  documented commands. This is MVP acceptance criterion 15.
- Data survives `docker compose down` followed by `up` — verified by test, including
  both events and snapshot files.
- No credential, token or key is committed. `.env.example` contains names and
  descriptions only.
- The port overview states, for each port, who needs to reach it and from where.
- If Janus is included, media actually flows through the containerised setup — a compose
  file that starts cleanly but drops RTP is not acceptance.
- Administrative interfaces are not exposed beyond the internal network.

## Constraints now fixed

From [`../constraints.md`](../constraints.md):

- Host is **Proxmox on x86**; **ARM must also be supported**. Build multi-architecture
  images and verify the ARM one actually runs, rather than assuming it.
- The broker is an **existing Mosquitto**, external to this compose stack. A Mosquitto
  container is for development only.
- **A trusted certificate is a base requirement**, not an optional improvement. Default is
  a locally generated CA plus server certificate, with the CA certificate served for
  installation on the tablet. Let's Encrypt where the server is publicly reachable, or a
  supplied certificate from the maintainer's own CA.
- One container serves both the API and the PWA.

## Additional task from the certificate decision

- [ ] **Give the backend a stable hostname on the LAN.** Certificates for bare IP
      addresses are awkward and Let's Encrypt will not issue them at all. A local DNS
      entry or mDNS name is therefore a deployment prerequisite, not a nicety - the PWA
      cannot have a trusted origin without one.
- [ ] Document the one-time CA installation on the tablet, including where the CA
      certificate is served from.
- [ ] Decide certificate lifetime and renewal for the local CA path. A certificate that
      silently expires takes the service worker and the doorbell UI with it.

## Open questions

- Should the client be served by the backend container or its own? **Resolved**: the
  backend serves it, per ADR-004.
- Does anything need to survive a Proxmox host migration, or is a volume backup enough?
- If the deployment is ever made publicly reachable for Let's Encrypt or remote access,
  what is exposed and what stays internal? The brief excludes remote access from the MVP,
  so this stays a question rather than a task.
