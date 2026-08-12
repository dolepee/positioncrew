# PositionCrew

PositionCrew is a job-first BSC marketplace for bounded capital operations. A buyer chooses a task, sets hard limits, hires a provider, and receives either an immediately usable machine-readable action or an explicit refusal with the failed conditions.

Public application: [positioncrew.dolepee.com](https://positioncrew.dolepee.com)

The product covers all four Build the Era categories with equal depth:

- **Lending rescue:** compute the smallest feasible repay or collateral top-up for a target health factor.
- **LP rebalancing:** move a concentrated-liquidity range only when fee, gas, slippage, inventory, and break-even checks pass.
- **Yield optimisation:** recommend an allocation only when liquidity, uplift, concentration, and risk constraints are satisfied.
- **Bounded grid construction:** construct orders only inside explicit inventory, fee, volatility, and worst-case-loss limits.

## Product surfaces

The web application is the primary interface:

- **Marketplace:** searchable provider registry with distinct provider endpoints, health routes, price, schema version, category coverage, and conformance status. The system panel reads the latest BSC block, PancakeSwap V3 WBNB/USDT pool, Venus vUSDT market, and documented AACP testnet contracts directly from chain.
- **Jobs:** provider selection, editable buyer constraints, a block-pinned Venus account probe, create/fund/assign/submit/evaluate/complete conformance lifecycle, human result, machine JSON, downloadable receipts, and persistent local history.
- **Evidence:** live infrastructure register, public content-addressed receipts for all four categories, frozen benchmark hashes, Agent Advantage progress, and explicit claim boundaries.

The flagship cold-buyer journey is **Rescue a lending position**. It returns exact token base units, projected health factor, execution preconditions, expiry, deterministic evaluation, and a fail-closed refusal when evidence is stale or constraints make the action unsafe.

## Run locally

Requires Node.js 22 LTS.

```bash
npm install
npm run dev
```

The local Cloudflare-compatible worker serves the application on `http://127.0.0.1:4175`. The same worker routes used in production expose:

- `GET /api/providers` for the provider catalog;
- `GET /.well-known/positioncrew.json` for the marketplace discovery manifest;
- `GET /openapi.json` for the four-provider OpenAPI 3.1 contract;
- `GET /api/providers/:provider/manifest` for a self-contained provider transport and claim boundary;
- `GET /api/schemas/:schemaVersion` for exact request or deliverable JSON Schema;
- `GET /api/status` for block-pinned BSC, PancakeSwap, Venus, and AACP telemetry;
- `GET /api/benchmarks/repeatability` for the three locked TermiX tasks and six reproducible provider repeats;
- `GET /api/benchmarks/captures` for the source-bound, hash-only manifest of the six precommitted agent candidates;
- `GET /api/benchmarks/:task/repeatability` for lending-rescue, lp-rebalance, or bounded-grid evidence;
- `GET /api/matrix` for all frozen conformance runs;
- `GET /api/providers/:provider/health` for a provider-specific liveness and conformance probe;
- `GET|POST /api/providers/:provider/jobs` for the provider-specific job route;
- `GET /api/receipts/:evaluationHash` for a public reproducible fixture receipt;
- `GET /api/wallets/:address/venus` for a block-pinned Venus account-liquidity observation;
- `GET /api/jobs?service=LENDING_RESCUE` for a frozen job;
- `POST /api/jobs` for a caller-supplied request;
- `GET /api/rescue` for the flagship lending fixture.

## Reproduce the evidence

```bash
npm run benchmark:verify-lock
npm run benchmark:session -- prepare lending-rescue
npm run verify:gate2a
npm run verify:all
npm run typecheck
npm test
npm run test:e2e
```

The lending result is written to `artifacts/gate2a/lending-rescue-result.json`; the four-category matrix is written to `artifacts/main-track/provider-matrix.json`.

Deterministic `100/100` results establish provider conformance against frozen fixtures. They do **not** establish agent advantage over a human baseline. Lending rescue, LP rebalancing, and bounded-grid task packets, rubrics, timing rules, and blinding protocols are pre-registered under [`benchmarks`](benchmarks); independent comparisons remain pending and the UI says so.

The executable [Agent Advantage evidence workflow](benchmarks/EVIDENCE_WORKFLOW.md) captures immutable agent and manual candidates, withholds answer-bearing rubric text from the manual operator, keeps duplicate agent repeats out of the blind packet, validates the independent scorecard, and reveals the committed source mapping only after scoring.

Offline role-specific handoff tools reduce procedural errors without weakening the blind: the manual tool auto-times and hashes one answer-free task bundle, while the evaluator tool exposes only anonymized candidates and the frozen rubric. Both are generated from the committed session and make no network requests.

## Architecture

- Frozen Zod schemas define requests and deliverables for each category.
- Provider implementations use fixed-point arithmetic and deterministic refusal paths.
- Canonical hashes bind request envelopes, deliverables, and evaluations.
- A replaceable `CommerceAdapter` owns exact funding and idempotent state transitions.
- A Cloudflare-compatible worker exposes the same typed core used by the CLI and tests, plus direct BSC JSON-RPC reads through `viem`.
- React provides the buyer marketplace and job workspace without duplicating decision logic in the browser.

## Claim boundary

The current commerce lifecycle is an in-memory conformance rail, not an AACP or mainnet settlement claim. The documented AACP BSC testnet contracts are verified by bytecode on every live telemetry refresh, but the documented backend host remains unreachable and terminal proof completion is therefore gated. No provisional ABI, undocumented backend route, external-provider track record, or incomplete blind benchmark is represented as production evidence.
