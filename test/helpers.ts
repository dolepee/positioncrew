import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LendingRescueRequestSchema,
  type LendingRescueRequest,
} from "../src/contracts/lending-rescue.js";

const fixturePath = fileURLToPath(
  new URL("../fixtures/lending-rescue/stressed-venus-position.v1.json", import.meta.url),
);

export function lendingFixture(): LendingRescueRequest {
  return LendingRescueRequestSchema.parse(
    JSON.parse(readFileSync(fixturePath, "utf8")),
  );
}

export const FIXTURE_NOW = new Date("2026-08-12T16:00:30.000Z");
