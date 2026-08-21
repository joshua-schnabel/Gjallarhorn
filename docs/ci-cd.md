# CI/CD

Modelled on the pipeline in [muninn.io](https://github.com/joshua-schnabel/muninn.io),
adapted to a TypeScript/Node service. Same conventions, same shape, same reasons.

---

## What runs when

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | push to `main`/`dev`, every PR | Format, typecheck, tests, coverage, supply chain, image build, CVE scan, integration |
| `security.yml` | every branch push, every PR | ShellCheck, actionlint, Semgrep SAST |
| `auto-pr.yml` | push to any other branch | Opens a draft PR against `dev`, or deletes a badly named branch |
| `dependabot-auto-merge.yml` | Dependabot PRs | Retargets security updates onto `dev`, auto-merges patch/minor |

`security.yml` runs on **every** branch push, not only on PRs: it needs no build, so
feedback should not wait for a PR to exist.

---

## Pipeline shape

```text
check ─┬ test ── coverage (>= 80% lines)
       └ supply-chain
                  ▼
      build (per arch, native runner) → image.tar artifact
           ├ scan        (Trivy on the artifact, + SBOM)
           └ integration (the artifact, loaded and actually run)
```

**The image is built once per architecture into a tarball**, and every later job consumes
that same artifact. This is the central idea: the bytes that are scanned are the bytes
that are integration-tested. A pipeline that rebuilds between stages is testing something
other than what it scanned, and nothing in it would notice.

**Native runners per architecture**, no QEMU — `ubuntu-latest` for amd64 and
`ubuntu-24.04-arm` for arm64. `scan` is the exception: Trivy reads the tarball's layers,
so the host architecture is irrelevant there.

### What each gate proves

| Gate | What it would catch |
| --- | --- |
| **check** | Formatting drift, type errors, and syntax Node's type stripping cannot erase. Also asserts the Node major agrees across `package.json`, `Dockerfile` and the workflow. |
| **test** | Behaviour, via `node:test` and `fastify.inject()`. |
| **coverage** | Untested code, at 80% lines and 75% branches. Node's own coverage, so no extra dependency. |
| **supply-chain** | `npm ci` fails when the lock file and manifest disagree; `npm audit` blocks on high and critical. |
| **build** | That the image builds on **both** architectures. Not a formality: ADR-004 chose a native SQLite driver, so the arm64 leg is the check that a prebuilt binary resolves without a compiler. |
| **scan** | Fixable critical and high CVEs in the image. Produces a CycloneDX SBOM from the same tarball. |
| **integration** | That the packaged service actually works — see below. |

### The integration test

`scripts/integration-test.sh`, run against the built artifact on native hardware. It
covers what only appears once the service is packaged and started:

1. Refuses to start when misconfigured — exit `78`, naming the missing setting.
2. Generates a local CA and certificate on first start.
3. The TLS chain verifies from a client's point of view.
4. **The verification is not vacuous**: a wrong hostname and an unrelated CA are both
   rejected. A handshake that succeeds proves little on its own; one that succeeds for
   the right name and fails for the wrong one proves the chain is real.
5. The CA is identical across a restart — a new CA would silently invalidate every
   provisioned tablet.
6. The container runs as a non-root user.

It runs locally too, which is the point of it being a script rather than inline YAML:

```console
$ scripts/integration-test.sh                    # builds, then tests
$ scripts/integration-test.sh path/to/image.tar  # tests a prebuilt artifact
```

---

## What the first run found

The pipeline was red on its first execution, and all three failures were real. Recorded
because they are the kind of thing that gets re-discovered otherwise.

**Trivy: 7 fixable findings, 6 HIGH and 1 CRITICAL — all inside npm's own dependency
tree.** `tar`, `undici`, `brace-expansion`, `ip-address`, shipped as part of the Node base
image. The Debian packages themselves were clean.

The fix was not a suppression. Nothing at runtime uses npm — the entrypoint is `node` and
so is the health check — so the Dockerfile became two stages and npm no longer travels to
the runtime image. Findings went to zero, the image got smaller, and the attack surface
shrank. **A finding that can be removed rather than accepted is worth the ten minutes.**

**Semgrep: `rejectUnauthorized: false` in `scripts/verify-tls.mjs`.** A true match, and
intentional: nothing can verify a chain before the CA that anchors it has been fetched,
which is exactly the bootstrap a tablet performs. Suppressed with a targeted
`// nosemgrep: <rule-id>` and the reasoning inline — and it is safe to assert on precisely
because the next two checks require strict verification to succeed and to *fail* for a
wrong hostname and an unrelated CA.

This is what the SARIF-suppression step in `security.yml` exists for: the finding stays
suppressed in the blocking pass without lingering in the Security tab forever.

**Integration: `Permission denied`.** `scripts/integration-test.sh` was committed `100644`
— the executable bit does not survive a `chmod` on a Windows checkout. Fixed with
`git update-index --chmod=+x`. Worth knowing for every script added from this machine.

---

## Conventions

**Actions are pinned by commit SHA**, with the version in a trailing comment. A tag is
mutable; a SHA is not. Dependabot updates them and keeps the comment accurate.

**`persist-credentials: false` on every checkout.** The default writes the job's token
into `.git/config`, where anything running afterwards can read it — and what runs
afterwards is `npm`, which executes install scripts from the whole dependency tree. A
token that is not on disk is one a compromised package cannot take.

**Minimal permissions by default** (`contents: read`), escalated per job. `scan` and
`semgrep` get `security-events: write` because they upload SARIF; nothing else does.

**Concurrency cancels superseded PR runs, never push runs.**

**Blocking scans block on fixable findings only.** The base image carries unfixable CVEs
that no action here can clear, and a gate that fails on those is a gate that gets switched
off. The full scan still reports everything to the Security tab.

---

## Branch model

```text
feature/… fix/… chore/… docs/… test/…  ──auto-pr──▶  dev  ──manual PR──▶  main
```

`auto-pr.yml` opens a draft PR against `dev` for any branch with a valid prefix, and
**deletes branches that do not follow the convention**. Worth knowing before the first
push: the remote branch is removed, the local one is untouched, so nothing is lost — but
the push is undone.

`dependabot/**` and `release/**` are exempt.

Two repository settings this depends on:

- *Settings → Actions → General → Allow GitHub Actions to create and approve pull
  requests* — without it, `auto-pr.yml` warns rather than failing.
- *Settings → General → Pull Requests → Allow auto-merge* — required by
  `dependabot-auto-merge.yml`.

---

## Dependencies

`dependabot.yml` covers npm (`/server`), GitHub Actions, and the Dockerfile base image.
One grouped PR per ecosystem, weekly, targeting `dev`, with a three-day cooldown.

`dependabot-auto-merge.yml` auto-merges patch and minor only. Majors wait for review: a
green pipeline does not prove a major has no breaking behaviour the tests miss.

It also **retargets security updates onto `dev`**. Those ignore `target-branch` and always
open against the default branch; merged into `main`, they would be reverted by the next
`dev → main` release merge, silently.

Not covered by Dependabot: the Semgrep and actionlint images in `security.yml`, because
Dependabot does not update `container:` or `docker run` references. Semgrep is acceptable
pinned — its rules are fetched at scan time — but actionlint needs a manual bump.

---

## What is deliberately not here yet

**No release stages and no `release.yml`.** muninn's pipeline continues into `push`,
`publish`, a version gate and a release workflow. Those are not copied across, because
this project currently has:

- no versioning decision and no `CHANGELOG.md`,
- no registry credentials configured (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` are unset),
- a deployment model that builds the image locally from `server/`
  (see [`architecture/deployment.md`](architecture/deployment.md)).

A publish job added now would fail on every run and gate nothing, which is worse than not
having one — a red pipeline that is expected to be red stops being read.

**To turn it on later**, in this order:

1. Decide the versioning scheme and add `CHANGELOG.md`.
2. Add a `version-gate` job: SemVer valid, greater than the last tag, and the changelog
   and `package.json` agreeing before anything is built from them.
3. Set `DOCKERHUB_USERNAME` (repository variable) and `DOCKERHUB_TOKEN` (secret).
4. Add `push` (per arch, by digest) and `publish` (multi-arch manifest, tag), gated on
   `scan` **and** `integration` so nothing unscanned or untested can ship.
5. Add `release.yml`, fired by the tag `publish` creates.

One trap worth carrying over from muninn: the release tag must be the pipeline's
*output*, not a second entry point. Adding `tags: ["v*.*.*"]` to `on:` while `publish`
also creates the tag makes a push to `main` build and publish twice, with whichever run
finishes last winning the moving tag — with every gate green, because nothing compares
the two.

---

## Reproducing locally

```console
$ cd server && npm ci
$ npm run format:check && npm run typecheck && npm test && npm run coverage
$ cd .. && scripts/integration-test.sh
```

The lint tools the pipeline uses, the same way it uses them:

```console
$ docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
$ docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable --severity=warning scripts/*.sh
```
