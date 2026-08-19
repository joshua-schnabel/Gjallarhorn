# WP-01: Repository skeleton and planning

| | |
| --- | --- |
| **Status** | done |
| **Phase** | 0 |
| **Depends on** | — |
| **Blocks** | everything |

## Goal

Establish the monorepo structure, capture what is already known about the hardware, and
produce a work plan that the maintainer and the agent can work through together. Without
this, every later package would re-derive the same context.

## Tasks

- [x] Create the monorepo directory layout from the project brief section 28
- [x] Write `.gitignore` covering ESP-IDF, Node.js, secrets and runtime data
- [x] Write `.editorconfig`
- [x] Record verified hardware facts and open parameters in `docs/hardware.md`
- [x] Write the roadmap with status table, dependency graph and phase sketch
- [x] Write the Phase 0 work-package documents
- [x] Write the top-level `README.md`
- [x] Create the initial commit

## Deliverables

- `.gitignore`, `.editorconfig`
- `README.md`
- `docs/hardware.md`
- `docs/planning/roadmap.md`
- `docs/planning/work-packages/WP-01` .. `WP-10`
- Empty tracked directories: `firmware/`, `server/`, `client/`, `deploy/`,
  `docs/architecture/`, `docs/adr/`, `docs/api/`, `docs/testing/`

## Acceptance

- Every path referenced by the roadmap and the work packages either exists, or is marked
  explicitly as produced by a named later work package. No dead links.
- All twelve deliverables from the project brief section 35 are mapped to exactly one
  work package in the roadmap coverage table.
- The dependency graph is acyclic and every package has at least one checkable
  acceptance criterion.
- `docs/hardware.md` separates verified fact, assumption and open question.
- All repository content is in English.

## Resolved

- Default branch is **`main`**; development happens on **`dev`**; changes reach `main` by
  merge request.
- No remote yet. The maintainer will create one on request, so merge requests stay local
  until then.
