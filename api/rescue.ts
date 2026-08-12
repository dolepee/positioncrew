import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZodError } from "zod";
import {
  runFrozenFixture,
  runFixtureRequest,
  runSuppliedLendingRequest,
} from "../src/api/fixture-jobs.js";

function sendError(
  response: VercelResponse,
  status: number,
  code: string,
  details: unknown,
) {
  response.status(status).json({
    schemaVersion: "positioncrew.api-error.v1",
    error: code,
    details,
  });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  try {
    if (request.method === "GET") {
      response.status(200).json(await runFrozenFixture("LENDING_RESCUE"));
      return;
    }
    if (request.method === "POST") {
      if (
        typeof request.body === "object" &&
        request.body !== null &&
        "mode" in request.body &&
        request.body.mode === "FROZEN_FIXTURE" &&
        "request" in request.body
      ) {
        response.status(200).json(await runFixtureRequest(request.body.request));
      } else {
        response.status(200).json(await runSuppliedLendingRequest(request.body));
      }
      return;
    }
    response.setHeader("Allow", "GET, POST");
    sendError(response, 405, "METHOD_NOT_ALLOWED", ["Use GET or POST."]);
  } catch (error) {
    if (error instanceof ZodError) {
      sendError(
        response,
        422,
        "INVALID_RESCUE_REQUEST",
        error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
      return;
    }
    sendError(response, 500, "RESCUE_JOB_FAILED", [
      error instanceof Error ? error.message : "Unknown error",
    ]);
  }
}
