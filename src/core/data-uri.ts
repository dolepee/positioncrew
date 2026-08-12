import { Buffer } from "node:buffer";

export function jsonDataUri(value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  return `data:application/json;base64,${payload}`;
}
