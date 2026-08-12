import { ZodError } from "zod";
import { PositionCrewRequestSchema } from "../src/contracts/index.js";
import {
  runFixtureRequest,
  runFrozenFixture,
} from "../src/api/fixture-jobs.js";
import type { ApiRequest, ApiResponse } from "./http.js";

const services = new Set([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "YIELD_OPTIMIZATION",
  "BOUNDED_GRID",
]);

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (request.method === "GET") {
      const rawService = Array.isArray(request.query.service)
        ? request.query.service[0]
        : request.query.service;
      if (!rawService || !services.has(rawService)) {
        response.status(400).json({
          schemaVersion: "positioncrew.api-error.v1",
          error: "INVALID_SERVICE",
          details: ["service must name one of the four PositionCrew providers"],
        });
        return;
      }
      response.status(200).json(
        await runFrozenFixture(
          rawService as "LENDING_RESCUE" | "LP_REBALANCE" | "YIELD_OPTIMIZATION" | "BOUNDED_GRID",
        ),
      );
      return;
    }
    if (request.method === "POST") {
      if (
        typeof request.body !== "object" ||
        request.body === null ||
        !("request" in request.body)
      ) {
        response.status(422).json({
          schemaVersion: "positioncrew.api-error.v1",
          error: "INVALID_JOB_REQUEST",
          details: ["body.request is required"],
        });
        return;
      }
      const parsed = PositionCrewRequestSchema.parse(request.body.request);
      response.status(200).json(await runFixtureRequest(parsed));
      return;
    }
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({
      schemaVersion: "positioncrew.api-error.v1",
      error: "METHOD_NOT_ALLOWED",
      details: ["Use GET or POST."],
    });
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(422).json({
        schemaVersion: "positioncrew.api-error.v1",
        error: "INVALID_JOB_REQUEST",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    response.status(500).json({
      schemaVersion: "positioncrew.api-error.v1",
      error: "JOB_FAILED",
      details: [error instanceof Error ? error.message : "Unknown error"],
    });
  }
}
