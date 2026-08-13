# PositionCrew

PositionCrew is a job-first BSC marketplace for bounded capital operations. A buyer chooses a task, sets hard limits, hires a provider, and receives either an immediately usable machine-readable action or an explicit refusal with the failed conditions.

Public application: [positioncrew.dolepee.com](https://positioncrew.dolepee.com)

[![Production smoke](https://github.com/dolepee/positioncrew/actions/workflows/production-smoke.yml/badge.svg)](https://github.com/dolepee/positioncrew/actions/workflows/production-smoke.yml)

The product covers all four Build the Era categories with equal depth:

- **Lending rescue:** compute the smallest feasible repay or collateral top-up for a target health factor.
- **LP rebalancing:** move a concentrated-liquidity range only when fee, gas, slippage, inventory, and break-even checks pass.
- **Yield optimisation:** recommend an allocation only when liquidity, uplift, concentration, and risk constraints are satisfied.
- **Bounded grid construction:** construct orders only inside explicit inventory, fee, volatility, and worst-case-loss limits.

## Product surfaces

The web application is the primary interface:

- **Marketplace:** searchable provider registry with distinct provider endpoints, ERC-8004 identity, health routes, price, schema version, category coverage, and conformance status. The system panel reads the latest BSC block, PancakeSwap V3 WBNB/USDT pool, Venus vUSDT market, and documented AACP testnet contracts directly from chain.
- **Jobs:** provider selection, editable buyer constraints, block-pinned Venus account, Venus stablecoin yield, PancakeSwap market, and PancakeSwap position request builders, create/fund/assign/submit/evaluate/complete conformance lifecycle, human result, machine JSON, downloadable receipts, and persistent local history. For a Venus Classic account with collateral and debt, the builder reconstructs balances, effective risk factors, oracle prices, and wallet inventory at one BSC block, reconciles the result to the Comptroller, and lets the buyer send that unsigned request to the lending provider. The yield builder compares the listed Venus Core Pool USDC, USDT, DAI, and FDUSD markets at one block using measured base supply rates, available cash, oracle prices, token metadata, gas, and measured block time; incentive rewards are deliberately excluded. The LP builder reconciles a USDT/WBNB V3 NFT with its official position manager and pool, reconstructs its token inventory and value, simulates collectible fees without moving funds, and measures volatility and an exact onchain swap window at one block. The bounded-grid builder verifies WBNB/USDT token ordering and reads spot price, current active virtual liquidity, reserve balances, adaptive onchain volatility observations, and gas at one BSC block before enabling an interactive grid request. Protocol observations are locked in the UI while buyer constraints remain editable. Other interactive providers retain a clearly labeled current-clock scenario; a separate locked mode reproduces the historical public fixture receipt and labels it non-executable.
- **Evidence:** live infrastructure register, funded ERC-8183 testnet receipts, public content-addressed deliverables for all four categories, frozen benchmark hashes, Agent Advantage progress, and explicit claim boundaries.

The flagship cold-buyer journey is **Rescue a lending position**. It returns exact token base units, projected health factor, execution preconditions, expiry, deterministic evaluation, and a fail-closed refusal when evidence is stale or constraints make the action unsafe.

## BSC provider identity

Each first-party provider has a separate ERC-8004 identity on BSC Testnet. The identity URI binds the public provider manifest and health endpoint; the scheduled production monitor resolves `ownerOf` and `tokenURI` from the registry before it accepts a provider as operational.

| Provider | ERC-8004 agent | Registration |
| --- | ---: | --- |
| Lending Rescue | `1810` | [transaction](https://testnet.bscscan.com/tx/0x828b810e1dc5f3e30859afbeb5a74deb728ed60c5d7cce09e9b44ed4be07aaaf) |
| LP Range Operator | `1811` | [transaction](https://testnet.bscscan.com/tx/0x7e94ae42091364cd110db183bb32055db3238008e8804dffc426dae76e393168) |
| Yield Allocator | `1812` | [transaction](https://testnet.bscscan.com/tx/0xfeb0d02eaa3a57c237d22a4d574497493e28e96b19dbbb363a127d23206a29da) |
| Bounded Grid Builder | `1813` | [transaction](https://testnet.bscscan.com/tx/0x8466e273149a1178e15db544964de83767450450ec334abb61e9cd24df95bbb4) |

The registry is [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.bscscan.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e). Public receipts and metadata are recorded in [`evidence/bsc-identities.testnet.json`](evidence/bsc-identities.testnet.json). [`scripts/register-bsc-identities.py`](scripts/register-bsc-identities.py) reproduces the official BNB Agent SDK registration path with the pinned [`bnbagent` dependency](scripts/requirements-bsc-identity.txt), while keeping the encrypted signing wallet outside Git.

## BSC commerce receipts

PositionCrew has completed seven ERC-8183/APEX lifecycles on BSC Testnet: one zero-price path probe and six funded jobs releasing `0.6 U` from a dedicated client wallet to a separate provider wallet. The four flagship jobs cover every required category and bind each public deliverable manifest to the onchain job.

| Service | Job | Provider identity | Escrow | Settlement |
| --- | ---: | ---: | ---: | --- |
| Lending Rescue | `490` | `1810` | `0.1 U` | [transaction](https://testnet.bscscan.com/tx/0x731cb1f760ffb0c870458dc3db68d22d97d8b9c10f1bc192f9e3cc1ee018a76f) |
| LP Range Operator | `491` | `1811` | `0.1 U` | [transaction](https://testnet.bscscan.com/tx/0x267b9b8293947e2f462857d87283f1db2ee8d2e60adc0dd0d4406a11b54dd78a) |
| Yield Allocator | `492` | `1812` | `0.1 U` | [transaction](https://testnet.bscscan.com/tx/0x0fac752328aa325382ea28f92f939b8c0f76750631f5460ed0706100f0b51d58) |
| Bounded Grid Builder | `493` | `1813` | `0.1 U` | [transaction](https://testnet.bscscan.com/tx/0xb9215bfa352d2626b49e5455fbb63a81cc018a1dcfb734eac6b75e192caba1e9) |

The machine-readable [`evidence/erc8183-jobs.testnet.json`](evidence/erc8183-jobs.testnet.json) ledger records every transaction, policy parameter, manifest hash, completion block, and claim boundary. These are disclosed same-operator integration tests using separate wallets. They are not external purchases, revenue, or the pending blind Agent Advantage result.

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
- `GET /api/commerce/erc8183` for the complete seven-job BSC Testnet ledger;
- `GET /api/commerce/erc8183/jobs/:jobId/deliverable` for a canonical onchain-bound deliverable manifest;
- `GET /api/matrix` for all frozen conformance runs;
- `GET /api/providers/:provider/health` for a provider-specific liveness and conformance probe;
- `GET|POST /api/providers/:provider/jobs` for the provider-specific job route (`POST` defaults to caller-supplied observations; `mode: FROZEN_FIXTURE` is required for the locked receipt);
- `GET /api/receipts/:evaluationHash` for a public reproducible fixture receipt;
- `GET /api/wallets/:address/venus` for a block-pinned Venus Classic position reconstruction and, when both collateral and debt exist, an embedded bounded rescue request;
- `GET /api/positions/pancake/:tokenId` for a block-pinned PancakeSwap V3 USDT/WBNB position reconstruction and embedded unsigned LP-rebalance request;
- `GET /api/markets/pancake/wbnb-usdt/grid` for a block-pinned PancakeSwap market reconstruction and embedded unsigned bounded-grid request;
- `GET /api/markets/venus/stable-yields` for four block-pinned Venus stablecoin base-rate markets and an embedded unsigned yield-allocation request;
- `GET /api/jobs?service=LENDING_RESCUE` for a frozen job;
- `POST /api/jobs` for a caller-supplied request;
- `GET /api/rescue` for the flagship lending fixture.

## Reproduce the evidence

```bash
npm run benchmark:verify-lock
npm run benchmark:verify-captures
npm run benchmark:session -- prepare lending-rescue
npm run benchmark:verify-report -- <completed-report-directory>
npm run verify:gate2a
npm run verify:all
npm run typecheck
npm test
npm run test:e2e
npm run verify:production
```

The lending result is written to `artifacts/gate2a/lending-rescue-result.json`; the four-category matrix is written to `artifacts/main-track/provider-matrix.json`.

Deterministic `100/100` results establish provider conformance against frozen fixtures. They do **not** establish agent advantage over a human baseline. Lending rescue, LP rebalancing, and bounded-grid task packets, rubrics, timing rules, and blinding protocols are pre-registered under [`benchmarks`](benchmarks); independent comparisons remain pending and the UI says so.

The executable [Agent Advantage evidence workflow](benchmarks/EVIDENCE_WORKFLOW.md) captures immutable agent and manual candidates, withholds answer-bearing rubric text from the manual operator, keeps duplicate agent repeats out of the blind packet, enforces one manual operator and a different blind evaluator across all three tasks, recomputes every completed result from source evidence, and reveals the committed source mapping only after scoring. The final verifier binds every JSON attachment into task and report commitments.

Offline role-specific handoff tools reduce procedural errors without weakening the blind: the manual tool auto-times and hashes one answer-free task bundle, while the evaluator tool exposes only anonymized candidates and the frozen rubric. Both are generated from the committed session and make no network requests.

## Architecture

- Frozen Zod schemas define requests and deliverables for each category.
- Provider implementations use fixed-point arithmetic and deterministic refusal paths.
- Canonical hashes bind request envelopes, deliverables, and evaluations.
- A replaceable `CommerceAdapter` owns exact funding and idempotent state transitions.
- A Cloudflare-compatible worker exposes the same typed core used by the CLI and tests, plus direct BSC JSON-RPC reads through `viem`.
- ERC-8004 identities bind each live provider endpoint on BSC Testnet; production checks fail if ownership, registration, or endpoint binding changes.
- ERC-8183/APEX jobs bind funded escrow, a provider, a canonical deliverable hash, an approved policy, and terminal settlement; the production monitor re-verifies all seven jobs directly from BSC Testnet. It also posts one current-clock scenario and one locked-receipt request to every Provider, rejecting expired scenario output, public evidence leakage, or any locked evaluation-hash drift.
- React provides the buyer marketplace and job workspace without duplicating decision logic in the browser.

## Claim boundary

The browser workspace remains an in-memory conformance rail and does not submit a buyer's wallet transaction. The Venus and PancakeSwap builders read block-pinned public state, but their embedded requests and provider outputs remain unsigned and must be revalidated before execution. Venus APYs are variable base rates derived from per-block rates and measured block time; they exclude incentives and do not remove stablecoin depeg risk. Pancake active liquidity is a current virtual-liquidity estimate from `slot0` and the pool's active `liquidity`, not a fill guarantee across future ticks; the grid's cycle count is an explicit assumption. LP collectible fees come from a read-only `collect` simulation, and the displayed 24-hour volume and fee values are extrapolated run rates from an exact recent swap window rather than guaranteed future activity. Other interactive jobs validate caller-supplied scenario observations against the current request clock. Locked jobs reproduce historical fixtures and public receipts but are not presented as current instructions. Separately, the public ERC-8183 ledger proves seven operator-controlled BSC Testnet lifecycles, including six funded completions; it does not prove external demand or revenue. TermiX AACP integration remains gated on the corrected Agent.family builder guide and is not represented as complete. No provisional ABI, undocumented backend route, external-provider track record, or incomplete blind benchmark is represented as production evidence.
