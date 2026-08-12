import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PROVIDER_CATALOG } from "../src/marketplace/catalog.js";

export default function handler(request: VercelRequest, response: VercelResponse) {
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
  response.status(200).json({
    schemaVersion: "positioncrew.provider-catalog-response.v1",
    generatedAt: new Date().toISOString(),
    commerceAdapter: "PENDING_SUPPORTED_AACP_GUIDE",
    providers: PROVIDER_CATALOG,
  });
}
