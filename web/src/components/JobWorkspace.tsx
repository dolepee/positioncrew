import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Code2,
  FileJson2,
  LoaderCircle,
  Play,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import {
  actionDetails,
  conditionsFor,
  formatTimestamp,
  metricsFor,
  resultHeadline,
  serviceLabel,
  shortHash,
  statusTone,
} from "../presentation";
import { TASKS } from "../task-config";
import type {
  FixtureJobResponse,
  ProviderListing,
  ServiceId,
  SessionJob,
} from "../types";

type ResultView = "summary" | "json" | "receipt";

function LendingPositionBar({ response }: { response: FixtureJobResponse | null }) {
  const position = response?.result.deliverable.position;
  return (
    <div className="position-bar" aria-label="Lending position health">
      <div className="position-bar-track" aria-hidden="true">
        <span className="zone-danger" />
        <span className="zone-buffer" />
        <span className="zone-safe" />
        <i className="marker stressed" />
        <i className="marker current" />
        <i className="marker target" />
      </div>
      <div className="position-bar-labels">
        <span><i className="dot stressed" /> Stress {position?.stressedHealthFactor ?? "0.939"}</span>
        <span><i className="dot current" /> Current {position?.currentHealthFactor ?? "1.043"}</span>
        <span><i className="dot target" /> Target {position?.targetHealthFactor ?? "1.250"}</span>
      </div>
    </div>
  );
}

function SummaryResult({ response }: { response: FixtureJobResponse }) {
  const deliverable = response.result.deliverable;
  const metrics = metricsFor(deliverable);
  const details = actionDetails(deliverable);
  const conditions = conditionsFor(deliverable);
  return (
    <div className="result-summary-view">
      <div className="decision-header">
        <div>
          <span className={`state-label ${statusTone(deliverable.status)}`}>
            <CheckCircle2 size={13} /> {deliverable.status.replaceAll("_", " ")}
          </span>
          <h2>{resultHeadline(deliverable)}</h2>
          <p>{deliverable.summary}</p>
        </div>
        <span className="expires-label"><Clock3 size={13} /> Expires {formatTimestamp(deliverable.expiresAt)} UTC</span>
      </div>
      <div className="decision-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className={metric.tone ?? ""}>
            <span>{metric.label}</span><strong>{metric.value}</strong>
          </div>
        ))}
      </div>
      <div className="decision-detail-grid">
        <section>
          <h3>Action specification</h3>
          <dl className="spec-list">
            {details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
          </dl>
        </section>
        <section>
          <h3>Execution guards</h3>
          <ul className="guard-list">
            {conditions.map((condition) => <li key={condition}><Check size={14} /><span>{condition}</span></li>)}
          </ul>
        </section>
      </div>
      {deliverable.service === "LENDING_RESCUE" && deliverable.alternatives?.[0] && (
        <div className="alternative-action">
          <span><strong>Alternative</strong>Add {deliverable.alternatives[0].amount} {deliverable.alternatives[0].asset.symbol} (${deliverable.alternatives[0].amountUsd})</span>
          <span>Projected HF <strong>{deliverable.alternatives[0].projectedHealthFactor}</strong></span>
        </div>
      )}
    </div>
  );
}

function ReceiptView({ response }: { response: FixtureJobResponse }) {
  const { job, evaluation } = response.result;
  return (
    <div className="receipt-view">
      <dl className="receipt-facts">
        <div><dt>Job ID</dt><dd>{job.jobId}</dd></div>
        <div><dt>Provider</dt><dd>{job.providerId}</dd></div>
        <div><dt>Evaluator</dt><dd>{job.evaluatorId}</dd></div>
        <div><dt>Envelope</dt><dd>{job.envelopeHash}</dd></div>
        <div><dt>Deliverable</dt><dd>{job.deliverable.deliverableHash}</dd></div>
        <div><dt>Evaluation</dt><dd>{evaluation.evaluationHash}</dd></div>
      </dl>
      <ol className="vertical-timeline">
        {job.history.map((entry) => (
          <li key={`${entry.state}-${entry.reference}`}>
            <span><Check size={12} /></span>
            <div><strong>{entry.state}</strong><small>{formatTimestamp(entry.at)} UTC</small></div>
            <code>{shortHash(entry.reference)}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MachineJson({ response }: { response: FixtureJobResponse }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(response.result.deliverable, null, 2);
  async function copyJson() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="json-view">
      <div className="json-toolbar">
        <span><FileJson2 size={14} /> application/json</span>
        <button type="button" onClick={copyJson} title="Copy machine deliverable">
          <Clipboard size={14} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{json}</pre>
    </div>
  );
}

export function JobWorkspace({
  provider,
  fixture,
  activeJob,
  sessionJobs,
  loading,
  onRun,
  onSelectJob,
  onSelectService,
}: {
  provider: ProviderListing | undefined;
  fixture: FixtureJobResponse | undefined;
  activeJob: SessionJob | null;
  sessionJobs: SessionJob[];
  loading: boolean;
  onRun: (request: Record<string, unknown>) => Promise<void>;
  onSelectJob: (job: SessionJob) => void;
  onSelectService: (service: ServiceId) => void;
}) {
  const service = provider?.service ?? "LENDING_RESCUE";
  const task = TASKS.find((candidate) => candidate.id === service) ?? TASKS[0];
  const [targetHealth, setTargetHealth] = useState("1.25");
  const [maxAction, setMaxAction] = useState("250");
  const [stressDrop, setStressDrop] = useState("1000");
  const [maxSlippage, setMaxSlippage] = useState("30");
  const [allowRepay, setAllowRepay] = useState(true);
  const [allowCollateral, setAllowCollateral] = useState(true);
  const [resultView, setResultView] = useState<ResultView>("summary");
  const shownResponse = activeJob?.response ?? null;
  const inputRequest = fixture?.result.request;

  useEffect(() => {
    setResultView("summary");
    if (inputRequest?.service === "LENDING_RESCUE") {
      setTargetHealth(String(inputRequest.targetHealthFactor ?? "1.25"));
      setMaxAction(String(inputRequest.maxActionUsd ?? "250"));
      setStressDrop(String(inputRequest.stressPriceDropBps ?? "1000"));
      setMaxSlippage(String(inputRequest.maxSlippageBps ?? "30"));
      const actions = Array.isArray(inputRequest.allowedActions) ? inputRequest.allowedActions : [];
      setAllowRepay(actions.includes("REPAY_DEBT"));
      setAllowCollateral(actions.includes("ADD_COLLATERAL"));
    }
  }, [service, inputRequest]);

  const customLending = useMemo(() => {
    if (service !== "LENDING_RESCUE" || !inputRequest) return false;
    return targetHealth !== String(inputRequest.targetHealthFactor) ||
      maxAction !== String(inputRequest.maxActionUsd) ||
      stressDrop !== String(inputRequest.stressPriceDropBps) ||
      maxSlippage !== String(inputRequest.maxSlippageBps) ||
      !allowRepay || !allowCollateral;
  }, [service, inputRequest, targetHealth, maxAction, stressDrop, maxSlippage, allowRepay, allowCollateral]);

  async function submitJob() {
    if (!inputRequest) return;
    const next = structuredClone(inputRequest) as Record<string, unknown>;
    if (service === "LENDING_RESCUE") {
      next.targetHealthFactor = targetHealth;
      next.maxActionUsd = maxAction;
      next.stressPriceDropBps = Number(stressDrop);
      next.maxSlippageBps = Number(maxSlippage);
      next.allowedActions = [
        ...(allowRepay ? ["REPAY_DEBT"] : []),
        ...(allowCollateral ? ["ADD_COLLATERAL"] : []),
      ];
      if (customLending) next.requestId = `${String(inputRequest.requestId)}-custom`;
    }
    await onRun(next);
  }

  return (
    <main className="page-shell jobs-page">
      <div className="page-title-row compact">
        <div>
          <span className="page-kicker">Bounded job workspace</span>
          <h1>Define the job. Inspect the action.</h1>
          <p>The provider returns a machine-readable decision, execution guards, and a reproducible receipt.</p>
        </div>
        <label className="provider-select">
          <span>Provider</span>
          <select value={service} onChange={(event) => onSelectService(event.target.value as ServiceId)}>
            {TASKS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.shortTitle}</option>)}
          </select>
        </label>
      </div>

      <div className="job-layout">
        <section className="job-composer" aria-labelledby="composer-title" aria-busy={loading}>
          <div className="section-bar">
            <div><span className="section-kicker">Request</span><h2 id="composer-title">{provider?.name ?? task.title}</h2></div>
            <span className="mode-label">Frozen fixture</span>
          </div>
          <p className="composer-summary">{provider?.summary ?? task.description}</p>
          {service === "LENDING_RESCUE" ? (
            <>
              <LendingPositionBar response={fixture ?? null} />
              <div className="form-grid">
                <label><span>Target health factor</span><input disabled={!fixture || loading} type="number" min="1.01" max="3" step="0.01" value={targetHealth} onChange={(event) => setTargetHealth(event.target.value)} /></label>
                <label><span>Maximum action (USD)</span><input disabled={!fixture || loading} type="number" min="1" max="10000" step="1" value={maxAction} onChange={(event) => setMaxAction(event.target.value)} /></label>
                <label><span>Stress price drop (bps)</span><input disabled={!fixture || loading} type="number" min="0" max="5000" step="100" value={stressDrop} onChange={(event) => setStressDrop(event.target.value)} /></label>
                <label><span>Maximum slippage (bps)</span><input disabled={!fixture || loading} type="number" min="0" max="2000" step="1" value={maxSlippage} onChange={(event) => setMaxSlippage(event.target.value)} /></label>
              </div>
              <fieldset className="action-options">
                <legend>Allowed actions</legend>
                <label><input disabled={!fixture || loading} type="checkbox" checked={allowRepay} onChange={(event) => setAllowRepay(event.target.checked)} /> Repay debt</label>
                <label><input disabled={!fixture || loading} type="checkbox" checked={allowCollateral} onChange={(event) => setAllowCollateral(event.target.checked)} /> Add collateral</label>
              </fieldset>
            </>
          ) : (
            <dl className="fixture-fields">
              {task.inputs.map((input) => <div key={input.label}><dt>{input.label}</dt><dd>{input.value}</dd></div>)}
            </dl>
          )}
          <div className="request-boundary" id="request-boundary">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{customLending ? "Custom fixture parameters are not covered by the locked benchmark hash." : "Exact frozen input matches the committed fixture."}</span>
          </div>
          <div className="composer-footer">
            <span><strong>5 TEST_USDC</strong><small>In-memory conformance rail</small></span>
            <button className="primary-action" type="button" onClick={submitJob} aria-describedby="request-boundary" disabled={loading || !fixture || (service === "LENDING_RESCUE" && !allowRepay && !allowCollateral)}>
              {loading ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              {loading ? "Running job" : `Run ${serviceLabel(service).toLowerCase()}`}
              {!loading && <ArrowRight size={15} />}
            </button>
          </div>
        </section>

        <section className="job-result" aria-label="Provider result" aria-live="polite">
          <div className="result-nav">
            <div>
              <button className={resultView === "summary" ? "active" : ""} type="button" onClick={() => setResultView("summary")}><ShieldCheck size={14} /> Result</button>
              <button className={resultView === "json" ? "active" : ""} type="button" onClick={() => setResultView("json")}><Code2 size={14} /> JSON</button>
              <button className={resultView === "receipt" ? "active" : ""} type="button" onClick={() => setResultView("receipt")}><ReceiptText size={14} /> Receipt</button>
            </div>
            {activeJob && <span>{activeJob.responseTimeMs} ms API</span>}
          </div>
          {shownResponse ? (
            resultView === "summary" ? <SummaryResult response={shownResponse} /> :
              resultView === "json" ? <MachineJson response={shownResponse} /> :
                <ReceiptView response={shownResponse} />
          ) : (
            <div className="empty-result-state">
              <span className="empty-result-icon"><ShieldCheck size={28} strokeWidth={1.6} /></span>
              <span className="empty-result-kicker">READY FOR REQUEST</span>
              <h2>Your bounded action will appear here.</h2>
              <p>One provider call produces the decision, guardrails, machine JSON, and receipt.</p>
              <div className="empty-result-flow" aria-hidden="true">
                <span><b>01</b> Request</span><ArrowRight size={14} /><span><b>02</b> Evaluate</span><ArrowRight size={14} /><span><b>03</b> Receipt</span>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="session-jobs" aria-labelledby="session-jobs-title">
        <div className="section-bar">
          <div><span className="section-kicker">Current browser session</span><h2 id="session-jobs-title">Job history</h2></div>
          <span>{sessionJobs.length} jobs</span>
        </div>
        <div className="history-table-wrap">
          <table className="history-table">
            <thead><tr><th>Time</th><th>Service</th><th>Decision</th><th>State</th><th>Score</th><th>Job ID</th></tr></thead>
            <tbody>
              {sessionJobs.map((job) => (
                <tr key={`${job.response.result.job.jobId}-${job.ranAt}`}>
                  <td>{new Date(job.ranAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                  <td><button type="button" onClick={() => onSelectJob(job)}>{serviceLabel(job.response.result.request.service)}</button></td>
                  <td>{resultHeadline(job.response.result.deliverable)}</td>
                  <td><span className={`state-label ${statusTone(job.response.result.job.state)}`}>{job.response.result.job.state}</span></td>
                  <td>{job.response.result.evaluation.score}/100</td>
                  <td><code>{shortHash(job.response.result.job.jobId, 14)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
          {sessionJobs.length === 0 && <div className="empty-table">No jobs have run in this browser session.</div>}
        </div>
      </section>
    </main>
  );
}
