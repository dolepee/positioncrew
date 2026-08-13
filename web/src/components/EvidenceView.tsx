import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Clock3,
  Coins,
  ExternalLink,
  FileCheck2,
  LockKeyhole,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { shortHash } from "../presentation";
import type {
  AacpProductionReadiness,
  AgentCaptureManifestResponse,
  AgentAdvantagePublicationStatus,
  BenchmarkRepeatabilityResponse,
  FixtureJobResponse,
  Erc8183TestnetLedger,
  MarketplaceInvocationEvidence,
  ProviderListing,
  ProductionTrackRecord,
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
  marketplaceProvenance,
  commerceLedger,
  aacpReadiness,
  advantagePublication,
  productionTrackRecord,
}: {
  providers: ProviderListing[];
  matrix: Map<ServiceId, FixtureJobResponse>;
  telemetry: SystemTelemetry | null;
  benchmarks: BenchmarkRepeatabilityResponse[];
  captureManifest: AgentCaptureManifestResponse | null;
  marketplaceProvenance: MarketplaceInvocationEvidence | null;
  commerceLedger: Erc8183TestnetLedger | null;
  aacpReadiness: AacpProductionReadiness | null;
  advantagePublication: AgentAdvantagePublicationStatus | null;
  productionTrackRecord: ProductionTrackRecord | null;
}) {
  const publishedAdvantage = advantagePublication?.status === "PUBLISHED"
    ? advantagePublication
    : null;
  const deliveryByService = new Map(
    (marketplaceProvenance?.summaries ?? []).map((summary) => [summary.service, summary]),
  );
  const definitions: Array<{ service: TermixBenchmarkService; task: string; category: string }> = [
    { service: "LENDING_RESCUE", task: "Lending position rescue", category: "Security / DeFi" },
    { service: "LP_REBALANCE", task: "LP range rebalancing", category: "Liquidity" },
    { service: "BOUNDED_GRID", task: "Bounded grid construction", category: "Trading" },
  ];
  const benchmarkRows = definitions.map((definition) => {
    const record = benchmarks.find((candidate) => candidate.service === definition.service);
    const delivery = deliveryByService.get(definition.service);
    const lock = matrix.get(definition.service)?.benchmarkLock;
    return {
      ...definition,
      record,
      delivery,
      lock,
      status: delivery?.successCount === 2 ? "DELIVERED" : record ? "REPEATABLE" : lock ? "LOCKED" : "PENDING",
      tone: delivery?.successCount === 2 || record ? "captured" : lock ? "locked" : "planned",
      detail: delivery?.successCount === 2
        ? `2/2 public marketplace jobs · ${delivery.medianElapsedMilliseconds} ms median; manual baseline pending`
        : record
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
  const flagshipCommerceJobs = commerceLedger?.jobs.filter(
    (job) => job.runType === "FUNDED_CATEGORY_RECEIPT",
  ) ?? [];
  const productionStatusLabel = productionTrackRecord?.status === "OPERATIONAL"
    ? "All observed passed"
    : productionTrackRecord?.status === "DEGRADED"
      ? `${productionTrackRecord.summary.unsuccessfulRuns} unsuccessful`
      : productionTrackRecord?.status === "COLLECTING"
        ? "Collecting"
        : productionTrackRecord?.status === "SOURCE_UNAVAILABLE"
          ? "Source unavailable"
          : "Loading";
  const productionStatusTone = productionTrackRecord?.status === "OPERATIONAL"
    ? "good"
    : productionTrackRecord?.status === "DEGRADED" || productionTrackRecord?.status === "SOURCE_UNAVAILABLE"
      ? "warn"
      : "neutral";
  const aacpStatus = aacpReadiness?.state === "PROVIDERS_ONLINE"
    ? { label: "Providers online", tone: "good" }
    : aacpReadiness?.state === "LISTINGS_PUBLISHED_RUNTIME_PENDING"
      ? { label: "Runtime pending", tone: "warn" }
      : aacpReadiness?.state === "ONBOARDING_PENDING"
        ? { label: "Onboarding", tone: "neutral" }
        : aacpReadiness?.state === "MARKETPLACE_DISCOVERY_DEGRADED"
          ? { label: "Discovery degraded", tone: "warn" }
        : aacpReadiness?.state === "PROTOCOL_DEGRADED"
          ? { label: "Protocol degraded", tone: "warn" }
          : aacpReadiness?.state === "SOURCE_UNAVAILABLE"
            ? { label: "Source unavailable", tone: "warn" }
            : { label: "Loading", tone: "neutral" };
  const aacpProviderStatus = (status: AacpProductionReadiness["marketplace"]["providers"][number]["status"]) => ({
    HANDLE_AVAILABLE: "Ready to mint",
    HANDLE_UNRESOLVED: "Name reserved",
    AGENT_INDEXED: "Agent indexed",
    LISTED_OFFLINE: "Listing published",
    ONLINE_AND_LISTED: "Online",
    DISCOVERY_UNAVAILABLE: "Discovery unavailable",
    LISTING_DISCOVERY_UNAVAILABLE: "Listing check unavailable",
    UPSTREAM_UNAVAILABLE: "Unavailable",
  })[status];
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
          <span><Coins size={16} /><strong>{commerceLedger?.summary.fundedCompletedJobs ?? "-"}</strong> funded test jobs</span>
          <span><Radio size={16} /><strong>{aacpReadiness?.marketplace.publishedListingCount ?? "-"}/4</strong> AACP listings</span>
          <span><LockKeyhole size={16} /><strong>{lockedCount}/3</strong> benchmarks locked</span>
          <span><FileCheck2 size={16} /><strong>{marketplaceProvenance?.aggregate.successCount ?? "-"}/6</strong> marketplace deliveries</span>
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
      </section>

      <section className="evidence-section aacp-section" aria-labelledby="aacp-title">
        <div className="section-bar">
          <div><span className="section-kicker">TermiX production rail</span><h2 id="aacp-title">AACP deployment and provider onboarding</h2></div>
          <span className={`state-label ${aacpStatus.tone}`}><Radio size={13} /> {aacpStatus.label}</span>
        </div>
        {aacpReadiness ? (
          <>
            <div className="aacp-facts">
              <div><strong>{aacpReadiness.protocol.contractCount ? `${aacpReadiness.protocol.deployedCount}/${aacpReadiness.protocol.contractCount}` : "-"}</strong><span>production contracts</span><small>Bytecode checked independently on chain 56</small></div>
              <div><strong>{aacpReadiness.protocol.currencies.map((currency) => currency.symbol).join(" + ") || "-"}</strong><span>settlement currencies</span><small>{aacpReadiness.protocol.protocolFeeBps === null ? "Fee unavailable" : `${aacpReadiness.protocol.protocolFeeBps / 100}% protocol fee`}</small></div>
              <div><strong>{aacpReadiness.marketplace.publishedListingCount}/{aacpReadiness.marketplace.requiredProviderCount}</strong><span>public listings</span><small>Four exact production handles reserved</small></div>
              <div><strong>{aacpReadiness.marketplace.onlineProviderCount}/{aacpReadiness.marketplace.requiredProviderCount}</strong><span>online providers</span><small>A2A presence must remain live through judging</small></div>
            </div>
            <div className="aacp-provider-grid" aria-label="TermiX production provider onboarding state">
              {aacpReadiness.marketplace.providers.map((provider) => (
                <div key={provider.service}>
                  <span>{providers.find((candidate) => candidate.service === provider.service)?.category ?? provider.service}</span>
                  <strong>{provider.handle}</strong>
                  <small>{provider.agentTokenId ? `ERC-8004 #${provider.agentTokenId}` : provider.status === "HANDLE_AVAILABLE" ? "Handle unclaimed" : "Identity not yet resolved"}</small>
                  <span className={`state-label ${provider.status === "ONLINE_AND_LISTED" ? "good" : provider.status.includes("UNAVAILABLE") ? "warn" : "neutral"}`}>{aacpProviderStatus(provider.status)}</span>
                </div>
              ))}
            </div>
            <div className="aacp-runtime-band">
              <div><strong>Signer excluded</strong><span>Runtime host accepts only a scoped agent token</span></div>
              <div><strong>{aacpReadiness.integration.orderGuard.guardedActions.length} actions guarded</strong><span>ABI calldata and mined transaction must match</span></div>
              <div><strong>{aacpReadiness.integration.runtime.tokenLifetimeHours} hours</strong><span>Manual token rotation; no hidden auto-renewal</span></div>
              <div><strong>{aacpReadiness.integration.runtime.automaticConversationKinds.length} + {aacpReadiness.integration.runtime.operatorRequiredConversationKinds.length} surfaces</strong><span>Pre-sale automated; orders and disputes gated</span></div>
            </div>
            <div className="operations-boundary">
              <ShieldCheck size={16} aria-hidden="true" />
              <span><strong>Production protocol, honest onboarding state.</strong>{aacpReadiness.boundaries[0]} {aacpReadiness.boundaries[1]}</span>
              <span className="delivery-links"><a href="/api/commerce/aacp" target="_blank" rel="noreferrer">Readiness record <ExternalLink size={12} /></a><a href={aacpReadiness.source.docsUrl} target="_blank" rel="noreferrer">TermiX guide <ExternalLink size={12} /></a></span>
            </div>
          </>
        ) : <div className="infrastructure-loading">The TermiX production readiness record is loading.</div>}
      </section>

      <section className="evidence-section delivery-evidence-section" aria-labelledby="delivery-title">
        <div className="section-bar">
          <div><span className="section-kicker">TermiX delivery proof</span><h2 id="delivery-title">Hired through the public marketplace</h2></div>
          <span className={`state-label ${marketplaceProvenance?.aggregate.allAttemptsSucceeded ? "good" : "neutral"}`}><FileCheck2 size={13} /> {marketplaceProvenance ? `${marketplaceProvenance.aggregate.successCount}/6 retained` : "Loading"}</span>
        </div>
        {marketplaceProvenance ? (
          <>
            <div className="delivery-facts">
              <div><strong>{marketplaceProvenance.aggregate.successCount}/6</strong><span>public Provider jobs</span><small>Two sequential calls per flagship task</small></div>
              <div><strong>0</strong><span>retries or replacements</span><small>Every planned attempt remains in sequence</small></div>
              <div><strong>3/3</strong><span>exact output pairs</span><small>Matched precommitted output and evaluation hashes</small></div>
              <div><strong>$0</strong><span>judge-trial cost</span><small>No wallet · in-memory conformance rail</small></div>
            </div>
            <div className="delivery-task-list" aria-label="Marketplace delivery records by task">
              {definitions.map((definition) => {
                const summary = deliveryByService.get(definition.service);
                const records = marketplaceProvenance.records.filter((record) => record.service === definition.service);
                const receiptUrl = records[0]?.observation?.receiptUrl;
                const outputHash = records[0]?.observation?.outputHash;
                return (
                  <div key={definition.service}>
                    <span><strong>{definition.task}</strong><small>{definition.category}</small></span>
                    <span><strong>{summary?.successCount ?? 0}/2</strong><small>completed</small></span>
                    <span><strong>{summary?.medianElapsedMilliseconds ?? "-"} ms</strong><small>end-to-end median</small></span>
                    <span><code>{shortHash(outputHash, 16)}</code><small>output commitment</small></span>
                    {receiptUrl ? <a href={receiptUrl} target="_blank" rel="noreferrer">Receipt <ExternalLink size={12} /></a> : <span>-</span>}
                  </div>
                );
              })}
            </div>
            <div className="operations-boundary">
              <ShieldCheck size={16} aria-hidden="true" />
              <span><strong>Precommitted delivery overlay.</strong>The protocol was public before these six calls. It proves the exact frozen agent outputs were returned through PositionCrew&apos;s production Provider endpoints; it does not claim paid AACP settlement or live investment performance.</span>
              <span className="delivery-links"><a href="/api/benchmarks/marketplace-provenance" target="_blank" rel="noreferrer">Raw record <ExternalLink size={12} /></a><a href={marketplaceProvenance.source.protocolUrl} target="_blank" rel="noreferrer">Protocol <ExternalLink size={12} /></a></span>
            </div>
          </>
        ) : <div className="infrastructure-loading">The immutable marketplace delivery record is loading.</div>}
      </section>

      <section className="evidence-section operations-section" aria-labelledby="operations-title">
        <div className="section-bar">
          <div><span className="section-kicker">Observed reliability</span><h2 id="operations-title">Production verification record</h2></div>
          <span className={`state-label ${productionStatusTone}`}><Radio size={13} /> {productionStatusLabel}</span>
        </div>
        {productionTrackRecord ? (
          <>
            <div className="operations-facts">
              <div><strong>{productionTrackRecord.summary.successfulRuns}/{productionTrackRecord.summary.completedRuns}</strong><span>successful scheduled runs</span><small>{productionTrackRecord.summary.pendingRuns} pending · failures remain visible</small></div>
              <div><strong>{productionTrackRecord.summary.rollingPassRatePct === null ? "-" : `${productionTrackRecord.summary.rollingPassRatePct}%`}</strong><span>observed pass rate</span><small>Latest 100 scheduled runs after the fixed epoch</small></div>
              <div><strong>{productionTrackRecord.epoch.workflow.cadenceMinutes} min</strong><span>verification cadence</span><small>Push and manually triggered runs excluded</small></div>
              <div><strong>{productionTrackRecord.epoch.verification.expectedCheckCountAtEpoch}</strong><span>checks per run at epoch</span><small>Providers, receipts, BSC state, and claim boundaries</small></div>
            </div>
            {productionTrackRecord.runs.length > 0 ? (
              <div className="operations-runs" aria-label="Recent scheduled verification runs">
                {productionTrackRecord.runs.slice(0, 3).map((run) => {
                  const successful = run.status === "completed" && run.conclusion === "success";
                  return (
                    <a key={run.runId} href={run.url} target="_blank" rel="noreferrer">
                      <span className={`operations-run-state ${successful ? "passed" : run.status === "completed" ? "failed" : "pending"}`}><i />{run.status === "completed" ? run.conclusion ?? "unknown" : run.status}</span>
                      <strong>Run #{run.runId}</strong>
                      <code>{run.headSha.slice(0, 7)}</code>
                      <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="infrastructure-loading">
                {productionTrackRecord.status === "SOURCE_UNAVAILABLE"
                  ? "The public workflow source is temporarily unavailable; no pass rate is inferred."
                  : `The fixed monitoring epoch began ${new Date(productionTrackRecord.epoch.startedAt).toLocaleString()}; the first scheduled sample is pending.`}
              </div>
            )}
            <div className="operations-boundary">
              <ShieldCheck size={16} aria-hidden="true" />
              <span><strong>Non-cherry-picked operating evidence.</strong>Every observed scheduled run after the fixed epoch is counted. This measures production verification, not demand, financial performance, mainnet execution, or Agent Advantage.</span>
              <a href={productionTrackRecord.source.workflowUrl} target="_blank" rel="noreferrer">All workflow runs <ExternalLink size={12} /></a>
            </div>
          </>
        ) : <div className="infrastructure-loading">The public scheduled verification record is loading.</div>}
      </section>

      <section className="evidence-section commerce-evidence-section" aria-labelledby="commerce-title">
        <div className="section-bar">
          <div><span className="section-kicker">Onchain commerce</span><h2 id="commerce-title">Funded provider receipts</h2></div>
          <span className={`state-label ${commerceLedger ? "good" : "neutral"}`}><Coins size={13} /> {commerceLedger ? "6/6 completed" : "Loading"}</span>
        </div>
        {commerceLedger ? (
          <>
            <div className="commerce-facts">
              <div><strong>{commerceLedger.summary.totalEscrowDisplay}</strong><span>testnet escrow released</span><small>Six funded jobs · platform fee {commerceLedger.protocol.platformFeeBps} bps</small></div>
              <div><strong>{commerceLedger.summary.mandatoryCategoriesCovered}/4</strong><span>mandatory categories</span><small>One flagship receipt per provider</small></div>
              <div><strong>{commerceLedger.summary.completedLifecycles}</strong><span>completed lifecycles</span><small>Six funded · one zero-price path probe</small></div>
              <div><strong>{commerceLedger.protocol.disputeWindowSeconds / 60} min</strong><span>optimistic challenge</span><small>Policy quorum {commerceLedger.protocol.voteQuorum} · all approved</small></div>
            </div>
            <div className="history-table-wrap">
              <table className="history-table commerce-ledger-table">
                <thead><tr><th scope="col">Service</th><th scope="col">Job</th><th scope="col">Agent</th><th scope="col">Escrow</th><th scope="col">State</th><th scope="col">Manifest</th><th scope="col">Settlement</th></tr></thead>
                <tbody>
                  {flagshipCommerceJobs.map((job) => (
                    <tr key={job.jobId}>
                      <td><strong>{providers.find((provider) => provider.service === job.service)?.name ?? job.service}</strong><small>{job.service}</small></td>
                      <td><code>#{job.jobId}</code></td>
                      <td><a className="receipt-table-link" href={`https://testnet.bscscan.com/token/0x8004A818BFB912233c491871b3d84c89A494BD9e?a=${job.providerAgentId}`} target="_blank" rel="noreferrer">#{job.providerAgentId}<ExternalLink size={12} /></a></td>
                      <td>0.1 U</td>
                      <td><span className="state-label good"><Check size={12} /> {job.status}</span></td>
                      <td><a className="receipt-table-link" href={job.manifestUrl} target="_blank" rel="noreferrer"><code>{shortHash(job.manifestHash)}</code><ExternalLink size={12} /></a></td>
                      <td><a className="receipt-table-link" href={`${commerceLedger.network.explorer}/tx/${job.transactions.settle}`} target="_blank" rel="noreferrer"><code>{shortHash(job.transactions.settle)}</code><ExternalLink size={12} /></a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="commerce-boundary">
              <ShieldCheck size={16} aria-hidden="true" />
              <span><strong>Verified integration, disclosed operator.</strong> Separate client and provider wallets completed real BSC testnet escrow. These jobs are not external purchases, revenue, or the pending blind Agent Advantage result.</span>
              <a href="/api/commerce/erc8183" target="_blank" rel="noreferrer">Full ledger <ExternalLink size={12} /></a>
            </div>
          </>
        ) : <div className="infrastructure-loading">Commerce evidence is temporarily unavailable. Provider conformance remains independently reproducible.</div>}
      </section>

      <section className="evidence-section" aria-labelledby="coverage-title">
        <div className="section-bar">
          <div><span className="section-kicker">Main-track coverage</span><h2 id="coverage-title">Provider conformance matrix</h2></div>
          <span className="state-label good"><Check size={13} /> Equal category depth</span>
        </div>
        <div className="history-table-wrap">
          <table className="history-table evidence-table">
            <thead><tr><th scope="col">Provider</th><th scope="col">Category</th><th scope="col">State</th><th scope="col">Score</th><th scope="col">Request commitment</th><th scope="col">Conformance receipt</th></tr></thead>
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
            <span className={`state-label ${publishedAdvantage ? "good" : "warn"}`}>{publishedAdvantage ? <Check size={13} /> : <Clock3 size={13} />} {publishedAdvantage ? "Published" : "In progress"}</span>
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
            <div><strong>{publishedAdvantage ? 3 : 0}</strong><span>blind scorecards</span><small>{publishedAdvantage ? `${publishedAdvantage.agentBlindQualityScore}/300 agent quality · independently scored` : "manual baseline and evaluator pending"}</small></div>
          </div>
          <a className="benchmark-data-link" href="/api/benchmarks/captures" target="_blank" rel="noreferrer">Open source-bound capture manifest <ExternalLink size={13} /></a>
          <a className="benchmark-data-link" href="/api/benchmarks/marketplace-provenance" target="_blank" rel="noreferrer">Open public marketplace delivery record <ExternalLink size={13} /></a>
          {publishedAdvantage && <a className="benchmark-data-link" href={publishedAdvantage.reportUrl} target="_blank" rel="noreferrer">Open independently scored report <ExternalLink size={13} /></a>}
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
            <div>
              <dt>Marketplace delivery protocol</dt>
              <dd>{marketplaceProvenance ? `${shortHash(marketplaceProvenance.protocolHash, 18)} · source ${marketplaceProvenance.source.protocolCommitSha.slice(0, 7)}` : "Loading"}</dd>
            </div>
          </dl>
          {publishedAdvantage ? (
            <div className="claim-warning published">
              <BadgeCheck size={16} aria-hidden="true" />
              <span><strong>Independent result published.</strong>{publishedAdvantage.supportedAdvantageCount}/3 frozen tasks support the pre-registered advantage rule. <a href={publishedAdvantage.reportUrl} target="_blank" rel="noreferrer">Inspect report and evidence.</a></span>
            </div>
          ) : (
            <div className="claim-warning">
              <AlertTriangle size={16} aria-hidden="true" />
              <span><strong>No advantage result is claimed.</strong>The locks and repeats prove pre-registration and deterministic conformance; manual runs and independent scoring remain pending.</span>
            </div>
          )}
        </section>
      </div>

      <section className="claim-register" aria-label="Claim boundaries">
        <div><BadgeCheck size={17} /><span><strong>Provider identity</strong>Four separate ERC-8004 records bind the first-party providers to their production endpoints.</span></div>
        <div><ShieldCheck size={17} /><span><strong>Conformance</strong>Four receipts reproduce, and six precommitted no-retry jobs delivered the flagship outputs through the public marketplace.</span></div>
        <div><Coins size={17} /><span><strong>Settlement</strong>Six disclosed operator-controlled ERC-8183 testnet escrows completed. TermiX production contracts are independently verified; provider onboarding is visible and no paid AACP order is claimed.</span></div>
        <div>{publishedAdvantage ? <BadgeCheck size={17} /> : <Clock3 size={17} />}<span><strong>Track record</strong>{publishedAdvantage ? `${publishedAdvantage.supportedAdvantageCount}/3 frozen tasks support the independently scored advantage rule; scope remains limited to the published report.` : "Three tasks are pre-registered; blind agent-versus-manual results have not been completed or published."}</span></div>
      </section>
    </main>
  );
}
