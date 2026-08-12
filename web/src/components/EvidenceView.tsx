import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock3,
  ExternalLink,
  FileCheck2,
  LockKeyhole,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { shortHash } from "../presentation";
import type {
  AgentCaptureManifestResponse,
  BenchmarkRepeatabilityResponse,
  FixtureJobResponse,
  ProviderListing,
  ServiceId,
  SystemTelemetry,
  TermixBenchmarkService,
} from "../types";

export function EvidenceView({
  providers,
  matrix,
  telemetry,
  benchmarks,
  captureManifest,
}: {
  providers: ProviderListing[];
  matrix: Map<ServiceId, FixtureJobResponse>;
  telemetry: SystemTelemetry | null;
  benchmarks: BenchmarkRepeatabilityResponse[];
  captureManifest: AgentCaptureManifestResponse | null;
}) {
  const definitions: Array<{ service: TermixBenchmarkService; task: string; category: string }> = [
    { service: "LENDING_RESCUE", task: "Lending position rescue", category: "Security / DeFi" },
    { service: "LP_REBALANCE", task: "LP range rebalancing", category: "Liquidity" },
    { service: "BOUNDED_GRID", task: "Bounded grid construction", category: "Trading" },
  ];
  const benchmarkRows = definitions.map((definition) => {
    const record = benchmarks.find((candidate) => candidate.service === definition.service);
    const lock = matrix.get(definition.service)?.benchmarkLock;
    return {
      ...definition,
      record,
      lock,
      status: record ? "REPEATABLE" : lock ? "LOCKED" : "PENDING",
      tone: record ? "captured" : lock ? "locked" : "planned",
      detail: record
        ? `${record.runs.length} reproducible provider runs; manual baseline pending`
        : lock
          ? "Fixture, rubric, and blind protocol committed"
          : "Benchmark lock pending",
    };
  });
  const lockedCount = benchmarkRows.filter((row) => row.lock).length;
  const repeatCount = benchmarks.reduce((total, record) => total + record.runs.length, 0);
  const committedCandidateCount = captureManifest?.benchmarks.reduce(
    (total, benchmark) => total + benchmark.candidates.length,
    0,
  ) ?? 0;
  return (
    <main className="page-shell evidence-page">
      <div className="page-title-row">
        <div>
          <span className="page-kicker">Verification</span>
          <h1>Evidence register</h1>
          <p>Conformance receipts and Agent Advantage evidence are reported as separate claims.</p>
        </div>
        <div className="evidence-summary">
          <span><Radio size={16} /><strong>{telemetry ? `#${Number(telemetry.mainnet.blockNumber).toLocaleString("en-US")}` : "-"}</strong> live BSC block</span>
          <span><BadgeCheck size={16} /><strong>{providers.length}/4</strong> BSC identities</span>
          <span><BadgeCheck size={16} /><strong>{matrix.size}/4</strong> public receipts</span>
          <span><LockKeyhole size={16} /><strong>{lockedCount}/3</strong> benchmarks locked</span>
        </div>
      </div>

      <section className="evidence-section infrastructure-section" aria-labelledby="infrastructure-title">
        <div className="section-bar">
          <div><span className="section-kicker">Live sources</span><h2 id="infrastructure-title">Onchain infrastructure register</h2></div>
          <span className={`state-label ${telemetry ? "good" : "neutral"}`}><Radio size={13} /> {telemetry ? "Block pinned" : "Synchronising"}</span>
        </div>
        {telemetry ? (
          <div className="infrastructure-grid">
            <a href={telemetry.mainnet.explorerUrl} target="_blank" rel="noreferrer">
              <span>BNB Smart Chain</span><strong>#{Number(telemetry.mainnet.blockNumber).toLocaleString("en-US")}</strong><small>{telemetry.mainnet.gasPriceGwei} Gwei · {telemetry.mainnet.rpcLatencyMs} ms</small><ExternalLink size={14} />
            </a>
            <a href={telemetry.market.explorerUrl} target="_blank" rel="noreferrer">
              <span>PancakeSwap V3</span><strong>${telemetry.market.spotPriceUsd}</strong><small>{telemetry.market.pair} · tick {telemetry.market.tick}</small><ExternalLink size={14} />
            </a>
            <a href={telemetry.venus.explorerUrl} target="_blank" rel="noreferrer">
              <span>Venus vUSDT</span><strong>{telemetry.venus.supplyAprPct}% APR</strong><small>${Number(telemetry.venus.availableLiquidityUsd).toLocaleString("en-US")} available</small><ExternalLink size={14} />
            </a>
            <a href={providers[0]?.identity.explorerUrl ?? telemetry.testnet.explorerUrl} target="_blank" rel="noreferrer">
              <span>ERC-8004 / BSC Testnet</span><strong>{providers.length}/4</strong><small>provider identities · endpoints bound</small><ExternalLink size={14} />
            </a>
          </div>
        ) : <div className="infrastructure-loading">Live BSC telemetry is temporarily unavailable. Deterministic receipts remain reproducible.</div>}
        {telemetry && (
          <div className="aacp-contract-strip" aria-label="Verified AACP contracts">
            {telemetry.aacp.contracts.map((contract) => (
              <a key={contract.address} href={contract.explorerUrl} target="_blank" rel="noreferrer"><i className={contract.deployed ? "deployed" : "missing"} />{contract.name}<code>{shortHash(contract.address, 10)}</code></a>
            ))}
          </div>
        )}
      </section>

      <section className="evidence-section" aria-labelledby="coverage-title">
        <div className="section-bar">
          <div><span className="section-kicker">Main-track coverage</span><h2 id="coverage-title">Provider conformance matrix</h2></div>
          <span className="state-label good"><Check size={13} /> Equal category depth</span>
        </div>
        <div className="history-table-wrap">
          <table className="history-table evidence-table">
            <thead><tr><th scope="col">Provider</th><th scope="col">Category</th><th scope="col">State</th><th scope="col">Score</th><th scope="col">Request commitment</th><th scope="col">Evaluation receipt</th></tr></thead>
            <tbody>
              {providers.map((provider) => {
                const result = matrix.get(provider.service);
                return (
                  <tr key={provider.providerId}>
                    <td><strong>{provider.name}</strong><small>{provider.providerId}</small><a className="receipt-table-link" href={provider.identity.explorerUrl} target="_blank" rel="noreferrer">ERC-8004 #{provider.identity.agentId}<ExternalLink size={12} /></a></td>
                    <td>{provider.category}</td>
                    <td><span className={`state-label ${result ? "good" : "neutral"}`}>{result?.result.job.state ?? "CHECKING"}</span></td>
                    <td>{result?.result.evaluation.score ?? "-"}/100</td>
                    <td><code>{shortHash(result?.result.job.envelopeHash)}</code></td>
                    <td>{result?.receipt.path ? <a className="receipt-table-link" href={result.receipt.path} target="_blank" rel="noreferrer"><code>{shortHash(result.result.evaluation.evaluationHash)}</code><ExternalLink size={12} /></a> : <code>-</code>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="evidence-columns">
        <section className="evidence-section benchmark-section" aria-labelledby="advantage-title">
          <div className="section-bar">
            <div><span className="section-kicker">TermiX evidence</span><h2 id="advantage-title">Agent Advantage programme</h2></div>
            <span className="state-label warn"><Clock3 size={13} /> In progress</span>
          </div>
          <div className="benchmark-table">
            {benchmarkRows.map((row) => (
              <div key={row.task}>
                <span className={`benchmark-status ${row.tone}`}>{row.status === "LOCKED" || row.status === "REPEATABLE" ? <LockKeyhole size={13} /> : <Clock3 size={13} />}{row.status}</span>
                <span><strong>{row.task}</strong><small>{row.category}</small></span>
                <span>{row.detail}</span>
              </div>
            ))}
          </div>
          <div className="method-grid">
            <div><strong>{committedCandidateCount || repeatCount}</strong><span>source-committed agent runs</span><small>{captureManifest ? `3 matching pairs · source ${captureManifest.source.commitSha.slice(0, 7)}` : "capture manifest loading"}</small></div>
            <div><strong>{lockedCount}</strong><span>frozen task rubrics</span><small>300 total quality points · safety-critical gates</small></div>
            <div><strong>0</strong><span>blind scorecards</span><small>manual baseline and evaluator pending</small></div>
          </div>
          <a className="benchmark-data-link" href="/api/benchmarks/captures" target="_blank" rel="noreferrer">Open source-bound capture manifest <ExternalLink size={13} /></a>
        </section>

        <section className="evidence-section lock-section" aria-labelledby="lock-title">
          <div className="section-bar">
            <div><span className="section-kicker">Pre-registration</span><h2 id="lock-title">Three benchmark locks</h2></div>
            <FileCheck2 size={18} aria-hidden="true" />
          </div>
          <dl className="lock-facts">
            {benchmarkRows.map((row) => (
              <div key={row.service}>
                <dt>{row.task}</dt>
                <dd>{row.lock ? `fixture ${shortHash(row.lock.fixtureHash, 13)} · rubric ${shortHash(row.lock.rubricHash, 13)} · protocol ${shortHash(row.lock.protocolHash, 13)}` : "Pending"}</dd>
              </div>
            ))}
            <div>
              <dt>Agent capture manifest</dt>
              <dd>{captureManifest ? `${shortHash(captureManifest.manifestHash, 18)} · source ${captureManifest.source.commitSha.slice(0, 7)}` : "Loading"}</dd>
            </div>
          </dl>
          <div className="claim-warning">
            <AlertTriangle size={16} aria-hidden="true" />
            <span><strong>No advantage result is claimed.</strong>The locks and repeats prove pre-registration and deterministic conformance; manual runs and independent scoring remain pending.</span>
          </div>
        </section>
      </div>

      <section className="claim-register" aria-label="Claim boundaries">
        <div><BadgeCheck size={17} /><span><strong>Provider identity</strong>Four separate ERC-8004 records bind the first-party providers to their production endpoints.</span></div>
        <div><ShieldCheck size={17} /><span><strong>Conformance</strong>Four frozen provider jobs reproduce through public content-addressed receipts.</span></div>
        <div><AlertTriangle size={17} /><span><strong>Settlement</strong>AACP contracts are verified on BSC testnet; backend proof completion is not represented as available.</span></div>
        <div><Clock3 size={17} /><span><strong>Track record</strong>Three tasks are pre-registered; blind agent-versus-manual results have not been completed or published.</span></div>
      </section>
    </main>
  );
}
