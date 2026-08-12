import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock3,
  FileCheck2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { shortHash } from "../presentation";
import type { FixtureJobResponse, ProviderListing, ServiceId } from "../types";

const benchmarkRows = [
  { task: "Lending position rescue", category: "Security / DeFi", status: "LOCKED", detail: "Rubric and blind protocol committed" },
  { task: "Yield allocation", category: "Yield", status: "PLANNED", detail: "Inputs frozen after live source adapter" },
  { task: "Bounded grid construction", category: "Trading", status: "PLANNED", detail: "Manual baseline and evaluator required" },
];

export function EvidenceView({
  providers,
  matrix,
}: {
  providers: ProviderListing[];
  matrix: Map<ServiceId, FixtureJobResponse>;
}) {
  const lending = matrix.get("LENDING_RESCUE");
  return (
    <main className="page-shell evidence-page">
      <div className="page-title-row">
        <div>
          <span className="page-kicker">Verification</span>
          <h1>Evidence register</h1>
          <p>Conformance receipts and Agent Advantage evidence are reported as separate claims.</p>
        </div>
        <div className="evidence-summary">
          <span><BadgeCheck size={16} /><strong>{matrix.size}/4</strong> provider fixtures pass</span>
          <span><LockKeyhole size={16} /><strong>{lending?.benchmarkLock ? "1" : "0"}</strong> benchmark locked</span>
          <span><Clock3 size={16} /><strong>0</strong> blind comparisons complete</span>
        </div>
      </div>

      <section className="evidence-section" aria-labelledby="coverage-title">
        <div className="section-bar">
          <div><span className="section-kicker">Main-track coverage</span><h2 id="coverage-title">Provider conformance matrix</h2></div>
          <span className="state-label good"><Check size={13} /> Equal category depth</span>
        </div>
        <div className="history-table-wrap">
          <table className="history-table evidence-table">
            <thead><tr><th>Provider</th><th>Category</th><th>State</th><th>Score</th><th>Request commitment</th><th>Evaluation receipt</th></tr></thead>
            <tbody>
              {providers.map((provider) => {
                const result = matrix.get(provider.service);
                return (
                  <tr key={provider.providerId}>
                    <td><strong>{provider.name}</strong><small>{provider.providerId}</small></td>
                    <td>{provider.category}</td>
                    <td><span className={`state-label ${result ? "good" : "neutral"}`}>{result?.result.job.state ?? "CHECKING"}</span></td>
                    <td>{result?.result.evaluation.score ?? "-"}/100</td>
                    <td><code>{shortHash(result?.result.job.envelopeHash)}</code></td>
                    <td><code>{shortHash(result?.result.evaluation.evaluationHash)}</code></td>
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
                <span className={`benchmark-status ${row.status.toLowerCase()}`}>{row.status === "LOCKED" ? <LockKeyhole size={13} /> : <Clock3 size={13} />}{row.status}</span>
                <span><strong>{row.task}</strong><small>{row.category}</small></span>
                <span>{row.detail}</span>
              </div>
            ))}
          </div>
          <div className="method-grid">
            <div><strong>3</strong><span>candidate outputs</span><small>1 manual · 2 agent</small></div>
            <div><strong>100</strong><span>quality points</span><small>3 critical safety gates</small></div>
            <div><strong>Blind</strong><span>human evaluator</span><small>identity, time, and cost hidden</small></div>
          </div>
        </section>

        <section className="evidence-section lock-section" aria-labelledby="lock-title">
          <div className="section-bar">
            <div><span className="section-kicker">Pre-registration</span><h2 id="lock-title">Lending benchmark lock</h2></div>
            <FileCheck2 size={18} aria-hidden="true" />
          </div>
          <dl className="lock-facts">
            <div><dt>Task</dt><dd>venus-stressed-position-20260812-001</dd></div>
            <div><dt>Fixture</dt><dd>{lending?.benchmarkLock?.fixtureHash ?? "Pending"}</dd></div>
            <div><dt>Rubric</dt><dd>{lending?.benchmarkLock?.rubricHash ?? "Pending"}</dd></div>
            <div><dt>Protocol</dt><dd>{lending?.benchmarkLock?.protocolHash ?? "Pending"}</dd></div>
          </dl>
          <div className="claim-warning">
            <AlertTriangle size={16} aria-hidden="true" />
            <span><strong>No advantage result is claimed.</strong>The lock proves inputs and scoring were fixed before outputs; independent scoring remains pending.</span>
          </div>
        </section>
      </div>

      <section className="claim-register" aria-label="Claim boundaries">
        <div><ShieldCheck size={17} /><span><strong>Conformance</strong>Four frozen provider jobs reproduce and pass deterministic checks.</span></div>
        <div><AlertTriangle size={17} /><span><strong>Settlement</strong>The current rail is in-memory; it is not represented as AACP or mainnet settlement.</span></div>
        <div><Clock3 size={17} /><span><strong>Track record</strong>Blind agent-versus-manual results have not been completed or published.</span></div>
      </section>
    </main>
  );
}
