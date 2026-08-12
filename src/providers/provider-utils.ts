import type { z } from "zod";
import type { SourceObservationSchema } from "../contracts/common.js";

type SourceObservation = z.infer<typeof SourceObservationSchema>;

export interface TimestampedObservation {
  sourceId: string;
  observedAt: string;
}

export interface EvidenceState {
  status:
    | "OK"
    | "REFUSED_EXPIRED"
    | "REFUSED_STALE_DATA"
    | "REFUSED_INCONSISTENT_DATA";
  expiresAt: string;
  reasons: string[];
}

export function validateEvidence(params: {
  sources: SourceObservation[];
  observations: TimestampedObservation[];
  requestedAt: string;
  deadline: string;
  maxDataAgeSeconds: number;
  now: Date;
}): EvidenceState {
  const { sources, observations, deadline, maxDataAgeSeconds, now } = params;
  const nowMs = now.getTime();
  const sourceMap = new Map(sources.map((source) => [source.sourceId, source]));
  const sourceExpiry = Math.min(
    ...sources.map(
      (source) => Date.parse(source.observedAt) + maxDataAgeSeconds * 1_000,
    ),
  );
  const expiresAt = new Date(Math.min(Date.parse(deadline), sourceExpiry)).toISOString();

  if (nowMs >= Date.parse(deadline)) {
    return {
      status: "REFUSED_EXPIRED",
      expiresAt,
      reasons: ["The request deadline has passed."],
    };
  }

  const inconsistent: string[] = [];
  for (const observation of observations) {
    const source = sourceMap.get(observation.sourceId);
    if (!source) {
      inconsistent.push(`Missing source ${observation.sourceId}.`);
      continue;
    }
    if (
      observation.observedAt !== source.observedAt ||
      Date.parse(observation.observedAt) > nowMs
    ) {
      inconsistent.push(`Timestamp mismatch for source ${observation.sourceId}.`);
    }
  }
  for (const source of sources) {
    if (Date.parse(source.observedAt) > nowMs) {
      inconsistent.push(`Source ${source.sourceId} is future-dated.`);
    }
  }
  if (inconsistent.length > 0) {
    return {
      status: "REFUSED_INCONSISTENT_DATA",
      expiresAt,
      reasons: inconsistent,
    };
  }

  const stale = sources.filter(
    (source) => nowMs - Date.parse(source.observedAt) > maxDataAgeSeconds * 1_000,
  );
  if (stale.length > 0) {
    return {
      status: "REFUSED_STALE_DATA",
      expiresAt,
      reasons: stale.map(
        (source) => `Source ${source.sourceId} exceeded the freshness limit.`,
      ),
    };
  }

  return { status: "OK", expiresAt, reasons: [] };
}

export function clampNonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}
