# PositionCrew

PositionCrew is a job-first BSC marketplace for bounded capital operations. A buyer chooses a task, sets hard limits, hires a provider, and receives either an immediately usable machine-readable action or an explicit refusal with the failed conditions.

The product covers all four Build the Era categories with equal depth:

- **Lending rescue:** compute the smallest feasible repay or collateral top-up for a target health factor.
- **LP rebalancing:** move a concentrated-liquidity range only when fee, gas, slippage, inventory, and break-even checks pass.
- **Yield optimisation:** recommend an allocation only when liquidity, uplift, concentration, and risk constraints are satisfied.
- **Bounded grid construction:** construct orders only inside explicit inventory, fee, volatility, and worst-case-loss limits.

## Product surfaces

The web application is the primary interface:

- **Marketplace:** searchable provider registry with price, availability, schema version, endpoint, category coverage, and conformance status.
- **Jobs:** provider selection, editable buyer constraints, create/fund/assign/submit/evaluate/complete lifecycle, human result, machine JSON, commitments, and browser-session history.
- **Evidence:** four-category conformance matrix, frozen benchmark hashes, Agent Advantage progress, and explicit claim boundaries.

The flagship cold-buyer journey is **Rescue a lending position**. It returns exact token base units, projected health factor, execution preconditions, expiry, deterministic evaluation, and a fail-closed refusal when evidence is stale or constraints make the action unsafe.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Vite serves the application on `http://127.0.0.1:4173`. The same Vercel functions used in production expose:

- `GET /api/providers` for the provider catalog;
- `GET /api/matrix` for all frozen conformance runs;
- `GET /api/jobs?service=LENDING_RESCUE` for a frozen job;
- `POST /api/jobs` for a caller-supplied request;
- `GET /api/rescue` for the flagship lending fixture.

## Reproduce the evidence

```bash
npm run benchmark:verify-lock
npm run verify:gate2a
npm run verify:all
npm run typecheck
npm test
npm run test:e2e
```

The lending result is written to `artifacts/gate2a/lending-rescue-result.json`; the four-category matrix is written to `artifacts/main-track/provider-matrix.json`.

Deterministic `100/100` results establish provider conformance against frozen fixtures. They do **not** establish agent advantage over a human baseline. The lending task, rubric, timing method, and blinding protocol are pre-registered in [`benchmarks/lending-rescue`](benchmarks/lending-rescue); independent comparisons remain pending and the UI says so.

## Architecture

- Frozen Zod schemas define requests and deliverables for each category.
- Provider implementations use fixed-point arithmetic and deterministic refusal paths.
- Canonical hashes bind request envelopes, deliverables, and evaluations.
- A replaceable `CommerceAdapter` owns exact funding and idempotent state transitions.
- Vercel functions expose the same typed core used by the CLI and tests.
- React provides the buyer marketplace and job workspace without duplicating decision logic in the browser.

## Claim boundary

The current commerce lifecycle is an in-memory conformance rail, not an AACP or mainnet settlement claim. AACP remains behind the adapter until Agent.family publishes its corrected supported integration guide and a third-party job reaches a terminal state end to end. No provisional ABI, undocumented backend route, external-provider track record, or incomplete blind benchmark is represented as production evidence.
