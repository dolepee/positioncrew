import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { EvidenceView } from "./components/EvidenceView";
import { JobWorkspace } from "./components/JobWorkspace";
import { MarketplaceView } from "./components/MarketplaceView";
import { ShellHeader, type AppView } from "./components/ShellHeader";
import type {
  AgentCaptureManifestResponse,
  BenchmarkRepeatabilityMatrixResponse,
  BenchmarkRepeatabilityResponse,
  Erc8183TestnetLedger,
  FixtureJobResponse,
  MatrixResponse,
  ProviderCatalogResponse,
  ProviderListing,
  ServiceId,
  SessionJob,
  SystemTelemetry,
} from "./types";

const SESSION_STORAGE_KEY = "positioncrew.session-jobs.v1";

function storedSessionJobs(): SessionJob[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((candidate): candidate is SessionJob =>
      typeof candidate === "object" &&
      candidate !== null &&
      "ranAt" in candidate &&
      "response" in candidate,
    ).slice(0, 20);
  } catch {
    return [];
  }
}

function viewFromHash(): AppView {
  const value = window.location.hash.replace("#", "");
  return value === "jobs" || value === "evidence" ? value : "marketplace";
}

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [view, setView] = useState<AppView>(viewFromHash);
  const [selectedService, setSelectedService] = useState<ServiceId>("LENDING_RESCUE");
  const [providers, setProviders] = useState<ProviderListing[]>([]);
  const [matrix, setMatrix] = useState<Map<ServiceId, FixtureJobResponse>>(new Map());
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [benchmarks, setBenchmarks] = useState<BenchmarkRepeatabilityResponse[]>([]);
  const [captureManifest, setCaptureManifest] = useState<AgentCaptureManifestResponse | null>(null);
  const [commerceLedger, setCommerceLedger] = useState<Erc8183TestnetLedger | null>(null);
  const [sessionJobs, setSessionJobs] = useState<SessionJob[]>(storedSessionJobs);
  const [activeJob, setActiveJob] = useState<SessionJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providers.find((candidate) => candidate.service === selectedService);
  const fixture = matrix.get(selectedService);

  async function loadRegistry() {
    setError(null);
    try {
      const [catalog, matrixPayload, telemetryPayload, repeatabilityPayload, capturePayload, commercePayload] = await Promise.all([
        fetch("/api/providers", { headers: { Accept: "application/json" } }).then((response) => jsonResponse<ProviderCatalogResponse>(response)),
        fetch("/api/matrix", { headers: { Accept: "application/json" } }).then((response) => jsonResponse<MatrixResponse>(response)),
        fetch("/api/status", { headers: { Accept: "application/json" } })
          .then((response) => jsonResponse<SystemTelemetry>(response))
          .catch(() => null),
        fetch("/api/benchmarks/repeatability", { headers: { Accept: "application/json" } })
          .then((response) => jsonResponse<BenchmarkRepeatabilityMatrixResponse>(response))
          .catch(() => null),
        fetch("/api/benchmarks/captures", { headers: { Accept: "application/json" } })
          .then((response) => jsonResponse<AgentCaptureManifestResponse>(response))
          .catch(() => null),
        fetch("/api/commerce/erc8183", { headers: { Accept: "application/json" } })
          .then((response) => jsonResponse<Erc8183TestnetLedger>(response))
          .catch(() => null),
      ]);
      setProviders(catalog.providers);
      setMatrix(new Map(matrixPayload.results.map((item) => [item.result.request.service, item])));
      setTelemetry(telemetryPayload);
      setBenchmarks(repeatabilityPayload?.records ?? []);
      setCaptureManifest(capturePayload);
      setCommerceLedger(commercePayload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Provider registry unavailable");
    }
  }

  useEffect(() => {
    void loadRegistry();
    function onHashChange() { setView(viewFromHash()); }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionJobs));
  }, [sessionJobs]);

  function navigate(next: AppView) {
    if (window.location.hash !== `#${next}`) window.location.hash = next;
    setView(next);
  }

  function createJob(service: ServiceId) {
    setSelectedService(service);
    setActiveJob(null);
    navigate("jobs");
  }

  async function runJob(request: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    const startedAt = performance.now();
    try {
      const endpoint = providers.find((candidate) => candidate.service === request.service)?.endpoint ?? "/api/jobs";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "FROZEN_FIXTURE", request }),
      });
      const payload = await jsonResponse<FixtureJobResponse>(response);
      const sessionJob: SessionJob = {
        response: payload,
        responseTimeMs: Math.max(1, Math.round(performance.now() - startedAt)),
        ranAt: new Date().toISOString(),
      };
      setActiveJob(sessionJob);
      setSessionJobs((jobs) => [sessionJob, ...jobs].slice(0, 20));
    } catch (jobError) {
      setError(jobError instanceof Error ? jobError.message : "Provider job failed");
    } finally {
      setLoading(false);
    }
  }

  function selectSessionJob(job: SessionJob) {
    setSelectedService(job.response.result.request.service);
    setActiveJob(job);
    navigate("jobs");
  }

  const content = useMemo(() => {
    if (view === "jobs") {
      return (
        <JobWorkspace
          provider={provider}
          selectedService={selectedService}
          fixture={fixture}
          activeJob={activeJob}
          sessionJobs={sessionJobs}
          loading={loading}
          onRun={runJob}
          onSelectJob={selectSessionJob}
          onSelectService={(service) => {
            setSelectedService(service);
            setActiveJob(null);
          }}
          telemetry={telemetry}
          onClearJobs={() => {
            setSessionJobs([]);
            setActiveJob(null);
          }}
        />
      );
    }
    if (view === "evidence") return <EvidenceView providers={providers} matrix={matrix} telemetry={telemetry} benchmarks={benchmarks} captureManifest={captureManifest} commerceLedger={commerceLedger} />;
    return (
      <MarketplaceView
        providers={providers}
        matrix={matrix}
        selectedService={selectedService}
        onSelect={setSelectedService}
        onCreateJob={createJob}
        telemetry={telemetry}
      />
    );
  }, [view, provider, fixture, activeJob, sessionJobs, loading, providers, matrix, selectedService, telemetry, benchmarks, captureManifest, commerceLedger]);

  return (
    <div className="app-shell">
      <ShellHeader
        view={view}
        onNavigate={navigate}
        apiOnline={providers.length === 4 && matrix.size === 4}
        jobCount={sessionJobs.length}
      />
      {error && (
        <div className="global-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={loadRegistry}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {content}
    </div>
  );
}
