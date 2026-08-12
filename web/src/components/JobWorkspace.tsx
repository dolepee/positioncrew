import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Code2,
  Download,
  ExternalLink,
  FileJson2,
  LoaderCircle,
  Play,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  Trash2,
  WalletCards,
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
  SystemTelemetry,
  VenusAccountProbe,
} from "../types";

type ResultView = "summary" | "json" | "receipt";

interface JobDraft {
  targetHealth: string;
  maxAction: string;
  stressDrop: string;
  maxSlippage: string;
  allowRepay: boolean;
  allowCollateral: boolean;
  lpCurrentTick: string;
  lpMinimumBenefit: string;
  lpGas: string;
  lpSwapCost: string;
  lpHorizon: string;
  lpMaximumGas: string;
  yieldCapital: string;
  yieldCandidateApy: string;
  yieldMinimumLiquidity: string;
  yieldMinimumBenefit: string;
  yieldHorizon: string;
  yieldRisk: "LOW" | "MEDIUM" | "HIGH";
  gridMidPrice: string;
  gridLowerPrice: string;
  gridUpperPrice: string;
  gridCapital: string;
  gridLevels: string;
  gridMaximumInventory: string;
  gridMaximumLoss: string;
  gridMinimumProfit: string;
  gridMaximumVolatility: string;
  gridExpectedCycles: string;
}

const EMPTY_DRAFT: JobDraft = {
  targetHealth: "1.25",
  maxAction: "250",
  stressDrop: "1000",
  maxSlippage: "30",
  allowRepay: true,
  allowCollateral: true,
  lpCurrentTick: "150",
  lpMinimumBenefit: "5",
  lpGas: "0.05",
  lpSwapCost: "0.95",
  lpHorizon: "24",
  lpMaximumGas: "0.10",
  yieldCapital: "1000",
  yieldCandidateApy: "900",
  yieldMinimumLiquidity: "1000000",
  yieldMinimumBenefit: "5",
  yieldHorizon: "90",
  yieldRisk: "MEDIUM",
  gridMidPrice: "10",
  gridLowerPrice: "9",
  gridUpperPrice: "11",
  gridCapital: "1000",
  gridLevels: "5",
  gridMaximumInventory: "600",
  gridMaximumLoss: "150",
  gridMinimumProfit: "100",
  gridMaximumVolatility: "1000",
  gridExpectedCycles: "10",
};

type JobRequest = FixtureJobResponse["result"]["request"];

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function draftFromRequest(request: JobRequest | undefined): JobDraft {
  if (!request) return EMPTY_DRAFT;
  const next = { ...EMPTY_DRAFT };
  if (request.service === "LENDING_RESCUE") {
    const actions = Array.isArray(request.allowedActions) ? request.allowedActions : [];
    return {
      ...next,
      targetHealth: String(request.targetHealthFactor ?? next.targetHealth),
      maxAction: String(request.maxActionUsd ?? next.maxAction),
      stressDrop: String(request.stressPriceDropBps ?? next.stressDrop),
      maxSlippage: String(request.maxSlippageBps ?? next.maxSlippage),
      allowRepay: actions.includes("REPAY_DEBT"),
      allowCollateral: actions.includes("ADD_COLLATERAL"),
    };
  }
  if (request.service === "LP_REBALANCE") {
    const market = objectValue(request.marketState);
    const constraints = objectValue(request.constraints);
    return {
      ...next,
      lpCurrentTick: String(market.currentTick ?? next.lpCurrentTick),
      lpMinimumBenefit: String(constraints.minimumNetBenefitUsd ?? next.lpMinimumBenefit),
      lpGas: String(constraints.estimatedGasUsd ?? next.lpGas),
      lpSwapCost: String(constraints.estimatedSwapCostUsd ?? next.lpSwapCost),
      lpHorizon: String(constraints.evaluationHorizonHours ?? next.lpHorizon),
      lpMaximumGas: String(request.maxGasUsd ?? next.lpMaximumGas),
    };
  }
  if (request.service === "YIELD_OPTIMIZATION") {
    const constraints = objectValue(request.constraints);
    const opportunities = Array.isArray(request.opportunities) ? request.opportunities : [];
    const candidate = objectValue(opportunities[0]);
    const risk = constraints.maximumRiskTier;
    return {
      ...next,
      yieldCapital: String(request.capitalUsd ?? next.yieldCapital),
      yieldCandidateApy: String(candidate.grossApyBps ?? next.yieldCandidateApy),
      yieldMinimumLiquidity: String(constraints.minimumLiquidityUsd ?? next.yieldMinimumLiquidity),
      yieldMinimumBenefit: String(constraints.minimumNetBenefitUsd ?? next.yieldMinimumBenefit),
      yieldHorizon: String(constraints.evaluationHorizonDays ?? next.yieldHorizon),
      yieldRisk: risk === "LOW" || risk === "HIGH" ? risk : "MEDIUM",
    };
  }
  const market = objectValue(request.marketState);
  const constraints = objectValue(request.constraints);
  return {
    ...next,
    gridMidPrice: String(market.midPrice ?? next.gridMidPrice),
    gridLowerPrice: String(constraints.lowerPrice ?? next.gridLowerPrice),
    gridUpperPrice: String(constraints.upperPrice ?? next.gridUpperPrice),
    gridCapital: String(constraints.capitalUsd ?? next.gridCapital),
    gridLevels: String(constraints.levelCount ?? next.gridLevels),
    gridMaximumInventory: String(constraints.maximumInventoryUsd ?? next.gridMaximumInventory),
    gridMaximumLoss: String(constraints.maximumLossUsd ?? next.gridMaximumLoss),
    gridMinimumProfit: String(constraints.minimumExpectedNetProfitUsd ?? next.gridMinimumProfit),
    gridMaximumVolatility: String(constraints.maximumVolatilityBps ?? next.gridMaximumVolatility),
    gridExpectedCycles: String(constraints.expectedCompletedCycles ?? next.gridExpectedCycles),
  };
}

function applyDraft(request: JobRequest, draft: JobDraft): JobRequest {
  const next = structuredClone(request);
  if (next.service === "LENDING_RESCUE") {
    next.targetHealthFactor = draft.targetHealth;
    next.maxActionUsd = draft.maxAction;
    next.stressPriceDropBps = Number(draft.stressDrop);
    next.maxSlippageBps = Number(draft.maxSlippage);
    next.allowedActions = [
      ...(draft.allowRepay ? ["REPAY_DEBT"] : []),
      ...(draft.allowCollateral ? ["ADD_COLLATERAL"] : []),
    ];
  } else if (next.service === "LP_REBALANCE") {
    const market = objectValue(next.marketState);
    const constraints = objectValue(next.constraints);
    market.currentTick = Number(draft.lpCurrentTick);
    constraints.minimumNetBenefitUsd = draft.lpMinimumBenefit;
    constraints.estimatedGasUsd = draft.lpGas;
    constraints.estimatedSwapCostUsd = draft.lpSwapCost;
    constraints.evaluationHorizonHours = Number(draft.lpHorizon);
    next.maxGasUsd = draft.lpMaximumGas;
  } else if (next.service === "YIELD_OPTIMIZATION") {
    const constraints = objectValue(next.constraints);
    const opportunities = Array.isArray(next.opportunities) ? next.opportunities : [];
    const candidate = objectValue(opportunities[0]);
    next.capitalUsd = draft.yieldCapital;
    candidate.amountUsd = draft.yieldCapital;
    candidate.grossApyBps = Number(draft.yieldCandidateApy);
    constraints.minimumLiquidityUsd = draft.yieldMinimumLiquidity;
    constraints.minimumNetBenefitUsd = draft.yieldMinimumBenefit;
    constraints.evaluationHorizonDays = Number(draft.yieldHorizon);
    constraints.maximumRiskTier = draft.yieldRisk;
  } else {
    const market = objectValue(next.marketState);
    const constraints = objectValue(next.constraints);
    market.midPrice = draft.gridMidPrice;
    constraints.lowerPrice = draft.gridLowerPrice;
    constraints.upperPrice = draft.gridUpperPrice;
    constraints.capitalUsd = draft.gridCapital;
    constraints.levelCount = Number(draft.gridLevels);
    constraints.maximumInventoryUsd = draft.gridMaximumInventory;
    constraints.maximumLossUsd = draft.gridMaximumLoss;
    constraints.minimumExpectedNetProfitUsd = draft.gridMinimumProfit;
    constraints.maximumVolatilityBps = Number(draft.gridMaximumVolatility);
    constraints.expectedCompletedCycles = Number(draft.gridExpectedCycles);
    next.maxActionUsd = draft.gridCapital;
  }
  return next;
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  min: string;
  max: string;
  step: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        disabled={disabled}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

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
  function downloadReceipt() {
    const body = JSON.stringify(response, null, 2);
    const href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = `${job.jobId}.receipt.json`;
    link.click();
    URL.revokeObjectURL(href);
  }
  return (
    <div className="receipt-view">
      <div className="receipt-actions">
        <span><ShieldCheck size={14} /> {response.receipt.mode.replaceAll("_", " ")}</span>
        <div>
          {response.receipt.path && <a href={response.receipt.path} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Public receipt</a>}
          <button type="button" onClick={downloadReceipt}><Download size={14} /> Download</button>
        </div>
      </div>
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

function WalletRiskProbe({ telemetry }: { telemetry: SystemTelemetry | null }) {
  const [account, setAccount] = useState("");
  const [probe, setProbe] = useState<VenusAccountProbe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function inspect() {
    setLoading(true);
    setError(null);
    setProbe(null);
    try {
      const response = await fetch(`/api/wallets/${account.trim()}/venus`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { details?: unknown } | null;
        throw new Error(Array.isArray(body?.details) ? String(body.details[0]) : `Wallet probe failed (${response.status})`);
      }
      setProbe(await response.json() as VenusAccountProbe);
    } catch (probeError) {
      setError(probeError instanceof Error ? probeError.message : "Wallet probe failed");
    } finally {
      setLoading(false);
    }
  }

  const tone = probe?.state === "LIQUID" ? "good" : probe?.state === "SHORTFALL" ? "warn" : "neutral";
  return (
    <section className="wallet-risk-probe" aria-labelledby="wallet-probe-title">
      <div className="wallet-probe-heading">
        <div><span className="section-kicker">Live BSC read</span><h3 id="wallet-probe-title">Venus account probe</h3></div>
        <span>{telemetry ? `Block ${Number(telemetry.mainnet.blockNumber).toLocaleString("en-US")}` : "RPC syncing"}</span>
      </div>
      <div className="wallet-probe-control">
        <label>
          <span className="sr-only">Venus account address</span>
          <WalletCards size={16} aria-hidden="true" />
          <input
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="0x account address"
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          />
        </label>
        <button type="button" onClick={inspect} disabled={loading || account.trim().length !== 42}>
          {loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
          {loading ? "Reading" : "Inspect"}
        </button>
      </div>
      {error && <div className="wallet-probe-error" role="alert"><AlertTriangle size={14} /> {error}</div>}
      {probe && (
        <div className="wallet-probe-result" aria-live="polite">
          <div className="wallet-probe-state">
            <span className={`state-label ${tone}`}>{probe.state.replaceAll("_", " ")}</span>
            <a href={probe.source.explorerUrl} target="_blank" rel="noreferrer">Block {Number(probe.source.blockNumber).toLocaleString("en-US")} <ExternalLink size={12} /></a>
          </div>
          <dl>
            <div><dt>Liquidity</dt><dd>${probe.liquidityUsd}</dd></div>
            <div><dt>Shortfall</dt><dd>${probe.shortfallUsd}</dd></div>
            <div><dt>Markets</dt><dd>{probe.enteredMarkets.length}</dd></div>
            <div><dt>Gas balance</dt><dd>{probe.nativeBalanceBnb} BNB</dd></div>
          </dl>
          <p>{probe.boundary}</p>
        </div>
      )}
    </section>
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
  selectedService,
  fixture,
  activeJob,
  sessionJobs,
  loading,
  onRun,
  onSelectJob,
  onSelectService,
  telemetry,
  onClearJobs,
}: {
  provider: ProviderListing | undefined;
  selectedService: ServiceId;
  fixture: FixtureJobResponse | undefined;
  activeJob: SessionJob | null;
  sessionJobs: SessionJob[];
  loading: boolean;
  onRun: (request: Record<string, unknown>) => Promise<void>;
  onSelectJob: (job: SessionJob) => void;
  onSelectService: (service: ServiceId) => void;
  telemetry: SystemTelemetry | null;
  onClearJobs: () => void;
}) {
  const service = selectedService;
  const task = TASKS.find((candidate) => candidate.id === service) ?? TASKS[0];
  const [draft, setDraft] = useState<JobDraft>(EMPTY_DRAFT);
  const [resultView, setResultView] = useState<ResultView>("summary");
  const shownResponse = activeJob?.response ?? null;
  const inputRequest = fixture?.result.request;

  useEffect(() => {
    setResultView("summary");
    setDraft(draftFromRequest(inputRequest));
  }, [service, inputRequest]);

  const draftRequest = useMemo(
    () => inputRequest ? applyDraft(inputRequest, draft) : null,
    [inputRequest, draft],
  );
  const customRequest = useMemo(
    () => Boolean(inputRequest && draftRequest && JSON.stringify(inputRequest) !== JSON.stringify(draftRequest)),
    [inputRequest, draftRequest],
  );

  function updateDraft<K extends keyof JobDraft>(key: K, value: JobDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submitJob() {
    if (!inputRequest || !draftRequest) return;
    const next = structuredClone(draftRequest) as Record<string, unknown>;
    if (customRequest) next.requestId = `${String(inputRequest.requestId)}-custom`;
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
            <div className="composer-mode-actions">
              <span className={`mode-label ${customRequest ? "custom" : ""}`}>{customRequest ? "Custom bounds" : "Frozen fixture"}</span>
              {customRequest && (
                <button type="button" onClick={() => setDraft(draftFromRequest(inputRequest))} disabled={loading} title="Reset to frozen fixture">
                  <RefreshCw size={13} aria-hidden="true" /> Reset
                </button>
              )}
            </div>
          </div>
          <p className="composer-summary">{provider?.summary ?? task.description}</p>
          {service === "LENDING_RESCUE" ? (
            <>
              <WalletRiskProbe telemetry={telemetry} />
              <LendingPositionBar response={fixture ?? null} />
              <div className="form-grid">
                <NumberField label="Target health factor" value={draft.targetHealth} onChange={(value) => updateDraft("targetHealth", value)} disabled={!fixture || loading} min="1.01" max="3" step="0.01" />
                <NumberField label="Maximum action (USD)" value={draft.maxAction} onChange={(value) => updateDraft("maxAction", value)} disabled={!fixture || loading} min="1" max="10000" step="1" />
                <NumberField label="Stress price drop (bps)" value={draft.stressDrop} onChange={(value) => updateDraft("stressDrop", value)} disabled={!fixture || loading} min="0" max="5000" step="100" />
                <NumberField label="Maximum slippage (bps)" value={draft.maxSlippage} onChange={(value) => updateDraft("maxSlippage", value)} disabled={!fixture || loading} min="0" max="2000" step="1" />
              </div>
              <fieldset className="action-options">
                <legend>Allowed actions</legend>
                <label><input disabled={!fixture || loading} type="checkbox" checked={draft.allowRepay} onChange={(event) => updateDraft("allowRepay", event.target.checked)} /> Repay debt</label>
                <label><input disabled={!fixture || loading} type="checkbox" checked={draft.allowCollateral} onChange={(event) => updateDraft("allowCollateral", event.target.checked)} /> Add collateral</label>
              </fieldset>
            </>
          ) : service === "LP_REBALANCE" ? (
            <>
              <div className="request-context"><span>PancakeSwap V3</span><strong>Current range -120 to 120</strong><small>$10,000 position</small></div>
              <div className="form-grid">
                <NumberField label="Current tick" value={draft.lpCurrentTick} onChange={(value) => updateDraft("lpCurrentTick", value)} disabled={!fixture || loading} min="-887272" max="887272" step="1" />
                <NumberField label="Minimum net benefit (USD)" value={draft.lpMinimumBenefit} onChange={(value) => updateDraft("lpMinimumBenefit", value)} disabled={!fixture || loading} min="0" max="100000" step="0.01" />
                <NumberField label="Estimated gas (USD)" value={draft.lpGas} onChange={(value) => updateDraft("lpGas", value)} disabled={!fixture || loading} min="0" max="10000" step="0.01" />
                <NumberField label="Estimated swap cost (USD)" value={draft.lpSwapCost} onChange={(value) => updateDraft("lpSwapCost", value)} disabled={!fixture || loading} min="0" max="10000" step="0.01" />
                <NumberField label="Evaluation horizon (hours)" value={draft.lpHorizon} onChange={(value) => updateDraft("lpHorizon", value)} disabled={!fixture || loading} min="1" max="720" step="1" />
                <NumberField label="Maximum gas (USD)" value={draft.lpMaximumGas} onChange={(value) => updateDraft("lpMaximumGas", value)} disabled={!fixture || loading} min="0" max="10000" step="0.01" />
              </div>
            </>
          ) : service === "YIELD_OPTIMIZATION" ? (
            <>
              <div className="request-context"><span>Venus to Beefy</span><strong>Current APY 4.00%</strong><small>Allowlisted BSC venues</small></div>
              <div className="form-grid">
                <NumberField label="Capital (USD)" value={draft.yieldCapital} onChange={(value) => updateDraft("yieldCapital", value)} disabled={!fixture || loading} min="1" max="10000000" step="1" />
                <NumberField label="Candidate APY (bps)" value={draft.yieldCandidateApy} onChange={(value) => updateDraft("yieldCandidateApy", value)} disabled={!fixture || loading} min="0" max="1000000" step="1" />
                <NumberField label="Minimum liquidity (USD)" value={draft.yieldMinimumLiquidity} onChange={(value) => updateDraft("yieldMinimumLiquidity", value)} disabled={!fixture || loading} min="0" max="10000000000" step="1" />
                <NumberField label="Minimum net benefit (USD)" value={draft.yieldMinimumBenefit} onChange={(value) => updateDraft("yieldMinimumBenefit", value)} disabled={!fixture || loading} min="0" max="1000000" step="0.01" />
                <NumberField label="Evaluation horizon (days)" value={draft.yieldHorizon} onChange={(value) => updateDraft("yieldHorizon", value)} disabled={!fixture || loading} min="1" max="365" step="1" />
                <label><span>Maximum risk tier</span><select disabled={!fixture || loading} value={draft.yieldRisk} onChange={(event) => updateDraft("yieldRisk", event.target.value as JobDraft["yieldRisk"])}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
              </div>
            </>
          ) : (
            <>
              <div className="request-context"><span>WBNB / USDT</span><strong>PancakeSwap execution policy</strong><small>Both sides required</small></div>
              <div className="form-grid dense">
                <NumberField label="Mid price" value={draft.gridMidPrice} onChange={(value) => updateDraft("gridMidPrice", value)} disabled={!fixture || loading} min="0.000001" max="10000000" step="0.01" />
                <NumberField label="Lower price" value={draft.gridLowerPrice} onChange={(value) => updateDraft("gridLowerPrice", value)} disabled={!fixture || loading} min="0.000001" max="10000000" step="0.01" />
                <NumberField label="Upper price" value={draft.gridUpperPrice} onChange={(value) => updateDraft("gridUpperPrice", value)} disabled={!fixture || loading} min="0.000001" max="10000000" step="0.01" />
                <NumberField label="Capital (USD)" value={draft.gridCapital} onChange={(value) => updateDraft("gridCapital", value)} disabled={!fixture || loading} min="1" max="10000000" step="1" />
                <NumberField label="Grid levels" value={draft.gridLevels} onChange={(value) => updateDraft("gridLevels", value)} disabled={!fixture || loading} min="2" max="100" step="1" />
                <NumberField label="Maximum inventory (USD)" value={draft.gridMaximumInventory} onChange={(value) => updateDraft("gridMaximumInventory", value)} disabled={!fixture || loading} min="1" max="10000000" step="1" />
                <NumberField label="Maximum loss (USD)" value={draft.gridMaximumLoss} onChange={(value) => updateDraft("gridMaximumLoss", value)} disabled={!fixture || loading} min="0.01" max="10000000" step="0.01" />
                <NumberField label="Minimum expected profit (USD)" value={draft.gridMinimumProfit} onChange={(value) => updateDraft("gridMinimumProfit", value)} disabled={!fixture || loading} min="0" max="10000000" step="0.01" />
                <NumberField label="Maximum volatility (bps)" value={draft.gridMaximumVolatility} onChange={(value) => updateDraft("gridMaximumVolatility", value)} disabled={!fixture || loading} min="1" max="100000" step="1" />
                <NumberField label="Expected completed cycles" value={draft.gridExpectedCycles} onChange={(value) => updateDraft("gridExpectedCycles", value)} disabled={!fixture || loading} min="1" max="1000" step="1" />
              </div>
            </>
          )}
          <div className="request-boundary" id="request-boundary">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{customRequest ? "Custom parameters are evaluated but are not covered by the locked benchmark hash." : "Exact frozen input matches the committed fixture."}</span>
          </div>
          <div className="composer-footer">
            <span><strong>5 TEST_USDC</strong><small>In-memory conformance rail</small></span>
            <button className="primary-action" type="button" onClick={submitJob} aria-describedby="request-boundary" disabled={loading || !fixture || (service === "LENDING_RESCUE" && !draft.allowRepay && !draft.allowCollateral)}>
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
          <div><span className="section-kicker">Persistent local record</span><h2 id="session-jobs-title">Job history</h2></div>
          <div className="history-actions"><span>{sessionJobs.length} jobs</span>{sessionJobs.length > 0 && <button type="button" onClick={onClearJobs} title="Clear local job history"><Trash2 size={14} /> Clear</button>}</div>
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
