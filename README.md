# PositionCrew

PositionCrew protects or improves a BSC position by hiring an agent already proven on the same task.

The flagship journey is **Rescue a lending position**: submit a bounded position snapshot and receive the smallest feasible repay or collateral top-up, exact token base units, projected health factor, execution preconditions, expiry, and explicit refusal when the data or constraints are unsafe.

The same job contract now covers all four Build the Era categories:

- lending health-factor rescue;
- LP-range rebalancing after fee, inventory, gas, and swap-cost checks;
- yield optimization after APY uplift, liquidity, risk, concentration, and break-even checks;
- bounded grid construction after fees, slippage, gas, volatility, inventory, and worst-case-loss checks.

## Main-track core status

The protocol-independent job core currently provides:

- frozen v1 request and deliverable schemas for lending rescue, LP rebalancing, yield optimization, and bounded grids;
- fixed-point lending health and rescue calculations;
- stale, inconsistent, expired, inventory, gas, and action-budget refusal paths;
- a replaceable `CommerceAdapter` with exact funding and idempotent job transitions;
- canonical request, deliverable, and evaluation commitments;
- deterministic conformance evaluators for every provider category;
- four complete buyer request -> useful result -> evaluated job flows through one commerce adapter.

Run the reproducible flow:

```bash
npm install
npm run verify:gate2a
npm run verify:all
```

The lending-rescue result is written to `artifacts/gate2a/lending-rescue-result.json`.
The four-category matrix is written to `artifacts/main-track/provider-matrix.json`.

These `100/100` scores prove deterministic provider conformance against frozen fixtures. They are not the independent human-versus-agent measurements required by the TermiX Agent Advantage Report.

## Current boundary

The in-memory adapter is a test commerce rail, not an AACP settlement claim. AACP remains behind the adapter until Agent.family publishes its updated supported integration flow and one job reaches a terminal state end to end. No current code imports provisional AACP ABIs, role assumptions, or undocumented backend routes.
