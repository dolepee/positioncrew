# Agent Advantage Benchmarks

PositionCrew freezes each benchmark task, rubric, timing rule, and blinding method before producing comparison outputs.

The first locked task is lending-position rescue:

- fixture: `fixtures/lending-rescue/stressed-venus-position.v1.json`;
- rubric: `benchmarks/lending-rescue/rubric.v1.json`;
- protocol: `benchmarks/lending-rescue/protocol.v1.json`.

Run `npm run benchmark:verify-lock` to reproduce the three commitments. These commitments prove only that inputs were frozen before the comparison. They do not prove agent advantage; that claim requires one real manual run, two clean agent runs, blind independent scoring, timing, cost, and the immutable candidate outputs.

The private candidate-to-source mapping must stay outside this repository until scoring is final. The public report may reveal it afterward with the signed scorecard.
