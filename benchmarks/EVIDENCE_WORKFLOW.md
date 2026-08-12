# Agent Advantage evidence workflow

The workflow preserves the TermiX comparison boundary without fabricating human work or exposing candidate identity to the evaluator.

## 1. Prepare a session

```bash
npm run benchmark:session -- prepare lending-rescue
```

Valid slugs are `lending-rescue`, `lp-rebalance`, and `bounded-grid`. The command creates a session under ignored `artifacts/benchmarks/`, copies the frozen fixture and neutral output contract into a manual task packet, and commits the fixture, rubric, and protocol hashes. It intentionally withholds the rubric text from the manual operator because its full-credit anchors contain expected answers.

## 2. Capture the agent repeats

```bash
npm run benchmark:session -- agent <session-directory>
```

This runs the committed Provider twice and writes immutable candidate records with output, timing, direct cost, conformance result, and canonical hashes. The first run is precommitted as the blind quality candidate. The second proves repeatability and is excluded from the evaluator packet.

## 3. Capture the real manual baseline

Give the independent manual operator only `manual-task-packet.json`. They must not use PositionCrew, an AI assistant, a prior candidate output, or the hidden scoring rubric. When the output becomes immutable, complete `manual-metadata.template.json` with the actual operator, method, time, cost, timestamp, and attestation.

```bash
npm run benchmark:session -- manual <session-directory> <manual-output.json> <manual-metadata.json>
```

The command validates the manual output against the same service contract and commits it once. It refuses replacement or post-run edits.

## 4. Produce the blind packet

```bash
npm run benchmark:session -- blind <session-directory>
```

The command randomly labels the manual output and first agent output as `Candidate A` and `Candidate B`. It writes the evaluator packet and scorecard template under `public/`, while the salted source mapping remains under `private/`. The packet contains neither timing, cost, operator identity, nor source labels.

## 5. Validate and reveal

The evaluator completes the scorecard without access to the session directory or private mapping. After the scorecard is returned:

```bash
npm run benchmark:session -- reveal <session-directory> <completed-scorecard.json>
```

Reveal fails if any fixture, rubric, protocol, candidate, packet, mapping, label, score, or criterion changed. A positive result requires all of the following:

- the blind agent score is at least the manual score;
- both agent output hashes match;
- neither agent run has a critical conformance failure;
- the blind agent candidate has no critical rubric failure;
- median agent time is lower than manual time.

The resulting claim applies only to the frozen task. It is not live investment performance or proof of paid AACP settlement.

## 6. Assemble the three-task report

After all three reveals succeed, generate the complete Markdown and JSON report plus attached outputs, scorecards, opened mappings, and candidate records:

```bash
npm run benchmark:session -- report <output-directory> <lending-session> <lp-session> <grid-session>
```

The assembler refuses missing or duplicate categories and revalidates every completed evidence chain before writing the report.
