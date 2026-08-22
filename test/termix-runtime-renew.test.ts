import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  parseRenewalEnvironment,
  readProtectedOwnerKey,
  renewRuntimeToken,
  runtimeTokenNeedsRenewal,
  tokenFingerprint,
} from "../src/cli/renew-termix-runtime-token.js";

const NOW = new Date("2026-08-22T12:00:00.000Z");
const OWNER_KEY = `0x${"0".repeat(63)}1` as const;
const OWNER = privateKeyToAccount(OWNER_KEY).address;

function jwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "positioncrew-renew-"));
  const ownerKeyFile = join(directory, "owner-key");
  const tokenPath = join(directory, "runtime-token");
  const expiryEnvironmentPath = join(directory, "runtime-expiry.env");
  const statePath = join(directory, "applied.sha256");
  writeFileSync(ownerKeyFile, `${OWNER_KEY}\n`, { mode: 0o600 });
  return {
    directory,
    ownerKeyFile,
    tokenPath,
    expiryEnvironmentPath,
    statePath,
    config: {
      agentId: "cmt4dzxvcli4tw70125nd5ra8",
      expectedOwner: OWNER,
      ownerKeyFile,
      tokenPath,
      expiryEnvironmentPath,
      statePath,
      runtimeInstance: "dedicated-lending",
      baseUrl: "https://platform-backend.prod.termix.live",
    },
  };
}

describe("TermiX runtime-token renewal", () => {
  it("parses only fixed absolute credential paths and a safe instance", () => {
    const parsed = parseRenewalEnvironment(
      {
        TERMIX_A2A_AGENT_ID: "cmt4dzxvcli4tw70125nd5ra8",
        TERMIX_A2A_OWNER_ADDRESS: OWNER,
        TERMIX_A2A_OWNER_KEY_FILE: "/run/credentials/owner-key",
        TERMIX_A2A_RUNTIME_TOKEN_PATH: "/etc/runtime.token",
        TERMIX_A2A_RUNTIME_EXPIRY_ENV_PATH: "/etc/runtime-expiry.env",
        TERMIX_A2A_RENEW_STATE_PATH: "/var/lib/applied.sha256",
      },
      ["dedicated-lending"],
    );
    expect(parsed.runtimeInstance).toBe("dedicated-lending");
    expect(parsed.expiryEnvironmentPath).toBe("/etc/runtime-expiry.env");
    expect(() => parseRenewalEnvironment({}, ["../unsafe"])).toThrow();
  });

  it("rejects owner credentials exposed to group or others", () => {
    const { ownerKeyFile } = fixture();
    expect(readProtectedOwnerKey(ownerKeyFile)).toBe(OWNER_KEY);
    chmodSync(ownerKeyFile, 0o644);
    expect(() => readProtectedOwnerKey(ownerKeyFile)).toThrow("group or others");
  });

  it("makes missing renewal prerequisites observable systemd failures", () => {
    const unit = readFileSync(
      new URL("../deploy/systemd/positioncrew-runtime-renew@.service", import.meta.url),
      "utf8",
    );
    expect(unit).toContain(
      "AssertFileNotEmpty=/etc/positioncrew-runtime/credentials/%i.owner-key",
    );
    expect(unit).toContain(
      "AssertFileNotEmpty=/opt/positioncrew-runtime-renew/renew-termix-runtime-token.mjs",
    );
    expect(unit).not.toContain("ConditionFileNotEmpty=");
    expect(unit).not.toContain("LoadCredential=");
    expect(unit).toContain("test ! -L \"$p\"");
    expect(unit).toContain("/usr/bin/stat -c %%u");
    expect(unit).toContain("-r--------|-rw-------");
    expect(unit).toContain(
      "TERMIX_A2A_OWNER_KEY_FILE=/etc/positioncrew-runtime/credentials/%i.owner-key",
    );
  });

  it("rotates near expiry, atomically installs, restarts once, and records application", async () => {
    const { config, tokenPath, expiryEnvironmentPath, statePath } = fixture();
    writeFileSync(tokenPath, jwt(Math.floor(NOW.getTime() / 1_000) + 60), { mode: 0o600 });
    const issuedToken = jwt(Math.floor(NOW.getTime() / 1_000) + 12 * 60 * 60);
    const restart = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ agentId: config.agentId, token: issuedToken }),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const result = await renewRuntimeToken(config, { now: NOW, fetchImpl, restart });

    expect(result).toEqual({
      rotated: true,
      restarted: true,
      expiresAt: "2026-08-23T00:00:00.000Z",
    });
    expect(readFileSync(tokenPath, "utf8").trim()).toBe(issuedToken);
    expect(readFileSync(expiryEnvironmentPath, "utf8")).toBe(
      "TERMIX_A2A_RUNTIME_TOKEN_EXPIRES_AT=2026-08-23T00:00:00.000Z\n" +
        `POSITIONCREW_RUNTIME_TOKEN_SHA256=${tokenFingerprint(issuedToken)}\n`,
    );
    expect(readFileSync(statePath, "utf8").trim()).toBe(tokenFingerprint(issuedToken));
    expect(restart).toHaveBeenCalledWith(
      "positioncrew-runtime@dedicated-lending.service",
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-wallet-address")).toBe(OWNER);
    expect(headers.get("x-wallet-signature")).toMatch(/^0x[0-9a-f]+$/);
    expect(headers.get("x-wallet-timestamp")).toBe(String(NOW.getTime()));
  });

  it("does not issue or restart when the fresh installed token is already applied", async () => {
    const { config, tokenPath, statePath } = fixture();
    const token = jwt(Math.floor(NOW.getTime() / 1_000) + 10 * 60 * 60);
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    writeFileSync(statePath, `${tokenFingerprint(token)}\n`, { mode: 0o600 });
    const fetchImpl = vi.fn();
    const restart = vi.fn();

    await expect(
      renewRuntimeToken(config, {
        now: NOW,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        restart,
      }),
    ).resolves.toEqual({
      rotated: false,
      restarted: false,
      expiresAt: "2026-08-22T22:00:00.000Z",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(runtimeTokenNeedsRenewal(token, NOW)).toBe(false);
  });

  it("uses signed issuance lifetime metadata for opaque replacement tokens", async () => {
    const { config, tokenPath, expiryEnvironmentPath } = fixture();
    writeFileSync(tokenPath, "opaque-expiring-token", { mode: 0o600 });
    const restart = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () =>
      Response.json({
        agentId: config.agentId,
        token: "opaque-replacement-token",
        expiresIn: "12h",
      }),
    ) as unknown as typeof fetch;

    await expect(
      renewRuntimeToken(config, { now: NOW, fetchImpl, restart }),
    ).resolves.toEqual({
      rotated: true,
      restarted: true,
      expiresAt: "2026-08-23T00:00:00.000Z",
    });
    expect(readFileSync(expiryEnvironmentPath, "utf8")).toBe(
      "TERMIX_A2A_RUNTIME_TOKEN_EXPIRES_AT=2026-08-23T00:00:00.000Z\n" +
        `POSITIONCREW_RUNTIME_TOKEN_SHA256=${tokenFingerprint("opaque-replacement-token")}\n`,
    );
  });

  it("ignores expiry metadata belonging to an out-of-band replaced token", async () => {
    const { config, tokenPath, expiryEnvironmentPath } = fixture();
    const replacement = jwt(Math.floor(NOW.getTime() / 1_000) + 60);
    writeFileSync(tokenPath, replacement, { mode: 0o600 });
    writeFileSync(
      expiryEnvironmentPath,
      "TERMIX_A2A_RUNTIME_TOKEN_EXPIRES_AT=2026-08-23T00:00:00.000Z\n" +
        `POSITIONCREW_RUNTIME_TOKEN_SHA256=${tokenFingerprint("previous-token")}\n`,
      { mode: 0o600 },
    );
    const issuedToken = jwt(Math.floor(NOW.getTime() / 1_000) + 12 * 60 * 60);
    const fetchImpl = vi.fn(async () =>
      Response.json({ agentId: config.agentId, token: issuedToken }),
    ) as unknown as typeof fetch;

    await expect(
      renewRuntimeToken(config, { now: NOW, fetchImpl, restart: vi.fn() }),
    ).resolves.toMatchObject({ rotated: true, expiresAt: "2026-08-23T00:00:00.000Z" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses a token response for another agent without replacing the credential", async () => {
    const { config, tokenPath } = fixture();
    const original = jwt(Math.floor(NOW.getTime() / 1_000) + 60);
    writeFileSync(tokenPath, original, { mode: 0o600 });
    const fetchImpl = vi.fn(async () =>
      Response.json({ agentId: "another-agent", token: jwt(2_000_000_000) }),
    ) as unknown as typeof fetch;

    await expect(renewRuntimeToken(config, { now: NOW, fetchImpl })).rejects.toThrow(
      "does not match the requested agent",
    );
    expect(readFileSync(tokenPath, "utf8")).toBe(original);
  });

  it("refuses a malformed replacement without overwriting the credential", async () => {
    const { config, tokenPath } = fixture();
    const original = jwt(Math.floor(NOW.getTime() / 1_000) + 60);
    writeFileSync(tokenPath, original, { mode: 0o600 });
    const fetchImpl = vi.fn(async () =>
      Response.json({
        agentId: config.agentId,
        token: "malformed token with spaces",
        expiresIn: "12h",
      }),
    ) as unknown as typeof fetch;

    await expect(renewRuntimeToken(config, { now: NOW, fetchImpl })).rejects.toThrow(
      "malformed runtime token",
    );
    expect(readFileSync(tokenPath, "utf8")).toBe(original);
  });
});
