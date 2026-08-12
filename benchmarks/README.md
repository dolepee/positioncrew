# Agent Advantage Benchmarks

PositionCrew freezes each benchmark task, rubric, timing rule, and blinding method before producing comparison outputs.

The three locked TermiX comparison tasks are:

- lending rescue: `benchmarks/lending-rescue`;
- LP rebalancing: `benchmarks/lp-rebalance`;
- bounded grid construction: `benchmarks/bounded-grid`.

Each directory binds one frozen fixture, one 100-point rubric, and one timing and blinding protocol. Run `npm run benchmark:verify-locks` to reproduce all nine commitments. These commitments prove only that inputs and scoring were frozen before comparison. They do not prove agent advantage; that claim requires one real manual run, two immutable agent runs, blind independent scoring, timing, cost, and the actual candidate outputs.

The private candidate-to-source mapping must stay outside this repository until scoring is final. The public report may reveal it afterward with the signed scorecard.
