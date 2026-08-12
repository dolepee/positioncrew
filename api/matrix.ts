import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runFrozenMatrix } from "../src/api/fixture-jobs.js";

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({
      schemaVersion: "positioncrew.api-error.v1",
      error: "METHOD_NOT_ALLOWED",
      details: ["Use GET."],
    });
    return;
  }
  try {
    response.status(200).json({
      schemaVersion: "positioncrew.provider-matrix-response.v1",
      results: await runFrozenMatrix(),
    });
  } catch (error) {
    response.status(500).json({
      schemaVersion: "positioncrew.api-error.v1",
      error: "PROVIDER_MATRIX_FAILED",
      details: [error instanceof Error ? error.message : "Unknown error"],
    });
  }
}
