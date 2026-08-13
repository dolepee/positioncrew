# Agent Advantage Benchmarks

PositionCrew freezes each benchmark task, rubric, timing rule, and blinding method before producing comparison outputs.

The three locked TermiX comparison tasks are:

- lending rescue: `benchmarks/lending-rescue`;
- LP rebalancing: `benchmarks/lp-rebalance`;
- bounded grid construction: `benchmarks/bounded-grid`.

Each directory binds one frozen fixture, one 100-point rubric, and one timing and blinding protocol. Run `npm run benchmark:verify-locks` to reproduce all nine commitments. These commitments prove only that inputs and scoring were frozen before comparison. They do not prove agent advantage; that claim requires one real manual run, two immutable agent runs, blind independent scoring, timing, cost, and the actual candidate outputs.

The v2 protocols keep the two agent runs for repeatability but place only the first precommitted run into the blind quality packet. Showing two identical agent outputs beside one manual output would reveal the agent source and break blinding.

The private candidate-to-source mapping must stay outside this repository until scoring is final. The public report may reveal it afterward with the completed evaluator scorecard. See [`EVIDENCE_WORKFLOW.md`](EVIDENCE_WORKFLOW.md) for the executable capture and validation flow.

The six precommitted agent candidates are bound to source revision `3b28703c67bf51f916623ccc61bdbe5d19ef4c60` in [`agent-capture-commitments-2026-08-12.json`](agent-capture-commitments-2026-08-12.json). Run `npm run benchmark:verify-captures` to verify its manifest hash, three benchmark locks, distinct candidate commitments, and matching repeat output hashes. Candidate contents, timing, and cost remain private until blind scoring is complete.

[`marketplace-invocation-protocol.v1.json`](marketplace-invocation-protocol.v1.json) precommits a separate delivery-provenance overlay: exactly two sequential, no-retry calls per flagship task through the public marketplace endpoints. Run `npm run benchmark:verify-marketplace-protocol` to check that it binds the original candidate, fixture, rubric, protocol, output, and evaluation commitments. After this protocol is publicly committed and the exact production revision is live, `npm run benchmark:capture-marketplace` writes the one-shot evidence file exclusively; `npm run benchmark:verify-marketplace` recomputes its record order, summaries, and commitments. This overlay does not change the Agent Advantage decision rule or imply paid settlement.
