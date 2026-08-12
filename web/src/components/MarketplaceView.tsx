import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Code2,
  Database,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react";
import { TASKS } from "../task-config";
import { serviceLabel, shortHash } from "../presentation";
import type { FixtureJobResponse, ProviderListing, ServiceId } from "../types";

export function MarketplaceView({
  providers,
  matrix,
  selectedService,
  onSelect,
  onCreateJob,
}: {
  providers: ProviderListing[];
  matrix: Map<ServiceId, FixtureJobResponse>;
  selectedService: ServiceId;
  onSelect: (service: ServiceId) => void;
  onCreateJob: (service: ServiceId) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return providers;
    return providers.filter((provider) =>
      [provider.name, provider.category, provider.summary, provider.service]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [providers, query]);
  const selected = providers.find((provider) => provider.service === selectedService);
  const selectedResult = matrix.get(selectedService);
  const selectedTask = TASKS.find((task) => task.id === selectedService);
  const SelectedIcon = selectedTask?.icon;
  const catalogLoading = providers.length === 0;

  return (
    <main className="page-shell">
      <div className="page-title-row">
        <div>
          <span className="page-kicker">Provider registry</span>
          <h1>Capital operations marketplace</h1>
          <p>Callable providers with bounded inputs, machine deliverables, and reproducible receipts.</p>
        </div>
        <div className="registry-summary" aria-label="Registry status">
          <span><strong>{providers.length || "-"}</strong> providers</span>
          <span><strong>4/4</strong> categories</span>
          <span><strong>{matrix.size ? `${matrix.size}/4` : "-"}</strong> reachable</span>
        </div>
      </div>

      <div className="market-toolbar">
        <label className="search-control">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search providers</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search provider or category"
          />
        </label>
        <span className="scope-note"><ShieldCheck size={15} /> Deterministic fixture verification</span>
      </div>

      <div className="market-layout">
        <section className="registry-panel" aria-label="Available providers">
          <div className="registry-table-wrap">
            <table className="registry-table" aria-busy={catalogLoading}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Verification</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {catalogLoading && Array.from({ length: 4 }, (_, index) => (
                  <tr className="provider-loading-row" key={`provider-loading-${index}`}>
                    <td><span className="skeleton-provider"><i /><b /></span></td>
                    <td><span className="skeleton-line medium" /></td>
                    <td><span className="skeleton-line short" /></td>
                    <td><span className="skeleton-line short" /></td>
                    <td><span className="skeleton-line medium" /></td>
                  </tr>
                ))}
                {!catalogLoading && filtered.map((provider) => {
                  const task = TASKS.find((candidate) => candidate.id === provider.service);
                  const Icon = task?.icon;
                  const result = matrix.get(provider.service);
                  return (
                    <tr
                      key={provider.providerId}
                      className={provider.service === selectedService ? "selected" : ""}
                    >
                      <td>
                        <button
                          className="provider-row-button"
                          type="button"
                          aria-pressed={provider.service === selectedService}
                          onClick={() => onSelect(provider.service)}
                        >
                          <span className="provider-icon">{Icon && <Icon size={17} aria-hidden="true" />}</span>
                          <span><strong>{provider.name}</strong><small>{shortHash(provider.providerId, 18)}</small></span>
                        </button>
                      </td>
                      <td><span className="category-label">{provider.category}</span></td>
                      <td><strong className="mono-value">{provider.price.amount} {provider.price.token}</strong></td>
                      <td><span className="verification-label"><BadgeCheck size={14} /> {result?.result.evaluation.score ?? "-"}/100</span></td>
                      <td><span className={`availability-label ${result ? "ready" : "pending"}`}><i /> {result ? "Reachable" : "Checking"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!catalogLoading && filtered.length === 0 && <div className="empty-table">No provider matches “{query}”.</div>}
          </div>
        </section>

        <aside className="provider-detail" aria-label="Selected provider">
          {selected ? (
            <>
              <div className="provider-detail-title">
                <span className="provider-icon large">{SelectedIcon && <SelectedIcon size={21} aria-hidden="true" />}</span>
                <div><span>{selected.category}</span><h2>{selected.name}</h2></div>
              </div>
              <div className="provider-detail-meta">
                <strong>{selected.price.amount} {selected.price.token}<small>per completed job</small></strong>
                <span className={`availability-label ${selectedResult ? "ready" : "pending"}`}><i /> {selectedResult ? "Reachable" : "Checking"}</span>
              </div>
              <p className="provider-summary">{selected.summary}</p>
              <dl className="provider-facts">
                <div><dt><Server size={14} /> Endpoint</dt><dd><code>{selected.method} {selected.endpoint}</code></dd></div>
                <div><dt><Database size={14} /> Request</dt><dd><code>{selected.requestSchema}</code></dd></div>
                <div><dt><Code2 size={14} /> Deliverable</dt><dd><code>{selected.deliverableSchema}</code></dd></div>
                <div><dt><BadgeCheck size={14} /> Conformance</dt><dd>{selectedResult?.result.evaluation.score ?? "-"}/100 · {selectedResult?.result.job.state ?? "Checking"}</dd></div>
              </dl>
              <div className="provider-boundary">
                <strong>Current rail</strong>
                <span>Frozen BSC fixture · in-memory conformance · AACP adapter pending supported guide</span>
              </div>
              <button className="primary-action" type="button" onClick={() => onCreateJob(selected.service)}>
                Create {serviceLabel(selected.service).toLowerCase()} job
                <ArrowRight size={16} aria-hidden="true" />
              </button>
              <div className="provider-receipt-preview">
                <CheckCircle2 size={15} aria-hidden="true" />
                <span><strong>Latest fixture receipt</strong><small>{shortHash(selectedResult?.result.evaluation.evaluationHash)}</small></span>
              </div>
            </>
          ) : (
            <div className="provider-detail-loading" aria-label="Loading provider details">
              <span className="skeleton-detail-heading"><i /><b /></span>
              <span className="skeleton-line full" />
              <span className="skeleton-line full" />
              <span className="skeleton-line medium" />
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
