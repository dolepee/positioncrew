# CapitalOps

CapitalOps protects or improves a BSC position by hiring an agent already proven on the same task.

The first working journey is **Rescue a lending position**: submit a bounded position snapshot and receive the smallest feasible repay or collateral top-up, exact token base units, projected health factor, execution preconditions, expiry, and explicit refusal when the data or constraints are unsafe.

## Gate 2A status

The protocol-independent job core currently provides:

- frozen v1 request and deliverable schemas for lending rescue, LP rebalancing, yield optimization, and bounded grids;
- fixed-point lending health and rescue calculations;
- stale, inconsistent, expired, inventory, gas, and action-budget refusal paths;
- a replaceable `CommerceAdapter` with exact funding and idempotent job transitions;
- canonical request, deliverable, and evaluation commitments;
- a deterministic lending-rescue evaluator using the disclosed v1 rubric;
- one complete buyer request -> useful result -> evaluated job flow.

Run the reproducible flow:

```bash
npm install
npm run verify:gate2a
```

The result is written to `artifacts/gate2a/lending-rescue-result.json`.

## Current boundary

The in-memory adapter is a test commerce rail, not an AACP settlement claim. AACP remains behind the adapter until Agent.family publishes its updated supported integration flow and one job reaches a terminal state end to end. No current code imports provisional AACP ABIs, role assumptions, or undocumented backend routes.
