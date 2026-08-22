import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { isAbsolute, dirname } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveRuntimeTokenExpiry } from "../commerce/aacp-runtime.js";

const execFileAsync = promisify(execFile);

export const TERMIX_RENEWAL_WINDOW_MS = 3 * 60 * 60 * 1_000;
export const TERMIX_MIN_ISSUED_LIFETIME_MS = 8 * 60 * 60 * 1_000;

export interface RenewalEnvironment {
  agentId: string;
  expectedOwner: `0x${string}`;
  ownerKeyFile: string;
  tokenPath: string;
  statePath: string;
  runtimeInstance: string;
  baseUrl: string;
}

interface RenewalDependencies {
  fetchImpl?: typeof fetch;
  now?: Date;
  restart?: (unit: string) => Promise<void>;
}

function requireAbsolutePath(value: string | undefined, name: string): string {
  const path = value?.trim();
  if (!path || !isAbsolute(path)) throw new Error(`${name} must be an absolute path`);
  return path;
}

export function parseRenewalEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): RenewalEnvironment {
  const runtimeInstance = argv[0]?.trim();
  const agentId = env.TERMIX_A2A_AGENT_ID?.trim();
  const owner = env.TERMIX_A2A_OWNER_ADDRESS?.trim();
  if (!runtimeInstance || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(runtimeInstance)) {
    throw new Error("A safe runtime instance argument is required");
  }
  if (!agentId || !/^[a-z0-9]{20,40}$/.test(agentId)) {
    throw new Error("TERMIX_A2A_AGENT_ID is invalid");
  }
  if (!owner) throw new Error("TERMIX_A2A_OWNER_ADDRESS is required");
  return {
    agentId,
    expectedOwner: getAddress(owner),
    ownerKeyFile: requireAbsolutePath(
      env.TERMIX_A2A_OWNER_KEY_FILE ||
        (env.CREDENTIALS_DIRECTORY
          ? `${env.CREDENTIALS_DIRECTORY}/owner-key`
          : undefined),
      "TERMIX_A2A_OWNER_KEY_FILE",
    ),
    tokenPath: requireAbsolutePath(
      env.TERMIX_A2A_RUNTIME_TOKEN_PATH,
      "TERMIX_A2A_RUNTIME_TOKEN_PATH",
    ),
    statePath: requireAbsolutePath(
      env.TERMIX_A2A_RENEW_STATE_PATH,
      "TERMIX_A2A_RENEW_STATE_PATH",
    ),
    runtimeInstance,
    baseUrl:
      env.TERMIX_AACP_BASE_URL?.trim().replace(/\/$/, "") ||
      "https://platform-backend.prod.termix.live",
  };
}

export function readProtectedOwnerKey(path: string): Hex {
  const stats = lstatSync(path);
  if (!stats.isFile()) throw new Error("Owner-key credential must be a regular file");
  if ((stats.mode & 0o077) !== 0) {
    throw new Error("Owner-key credential must not be accessible by group or others");
  }
  if (stats.size < 64 || stats.size > 68) throw new Error("Owner-key credential size is invalid");
  const key = readFileSync(path, "utf8").trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) throw new Error("Owner-key credential is malformed");
  return key as Hex;
}

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function runtimeTokenNeedsRenewal(
  token: string | undefined,
  now = new Date(),
): boolean {
  if (!token) return true;
  const expiry = resolveRuntimeTokenExpiry(token);
  return !expiry || expiry.getTime() <= now.getTime() + TERMIX_RENEWAL_WINDOW_MS;
}

async function writePrivateAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function issueRuntimeToken(
  config: RenewalEnvironment,
  ownerKey: Hex,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<{ token: string; expiresAt: Date }> {
  const account = privateKeyToAccount(ownerKey);
  if (getAddress(account.address) !== config.expectedOwner) {
    throw new Error(`Owner-key credential resolves to unexpected address ${account.address}`);
  }
  const timestamp = now.getTime();
  const signature = await account.signMessage({
    message: `AACP:a2a-runtime-token:${config.agentId}:${timestamp}`,
  });
  const response = await fetchImpl(
    `${config.baseUrl}/api/v1/a2a/runtime/token/${config.agentId}`,
    {
      method: "POST",
      headers: {
        "x-wallet-address": account.address,
        "x-wallet-signature": signature,
        "x-wallet-timestamp": String(timestamp),
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`TermiX runtime-token issuance failed with HTTP ${response.status}`);
  }
  if (payload.agentId !== config.agentId || typeof payload.token !== "string") {
    throw new Error("TermiX runtime-token response does not match the requested agent");
  }
  const expiresAt = resolveRuntimeTokenExpiry(payload.token);
  if (!expiresAt || expiresAt.getTime() < now.getTime() + TERMIX_MIN_ISSUED_LIFETIME_MS) {
    throw new Error("TermiX issued a token without sufficient verified lifetime");
  }
  return { token: payload.token, expiresAt };
}

async function defaultRestart(unit: string): Promise<void> {
  await execFileAsync("/bin/systemctl", ["restart", unit], {
    timeout: 30_000,
    maxBuffer: 64 * 1_024,
  });
}

export async function renewRuntimeToken(
  config: RenewalEnvironment,
  dependencies: RenewalDependencies = {},
): Promise<{ rotated: boolean; restarted: boolean; expiresAt: string }> {
  const now = dependencies.now ?? new Date();
  const ownerKey = readProtectedOwnerKey(config.ownerKeyFile);
  const account = privateKeyToAccount(ownerKey);
  if (getAddress(account.address) !== config.expectedOwner) {
    throw new Error(`Owner-key credential resolves to unexpected address ${account.address}`);
  }

  let token: string | undefined;
  try {
    token = (await readFile(config.tokenPath, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let rotated = false;
  if (runtimeTokenNeedsRenewal(token, now)) {
    const issued = await issueRuntimeToken(
      config,
      ownerKey,
      now,
      dependencies.fetchImpl ?? fetch,
    );
    token = issued.token;
    await writePrivateAtomic(config.tokenPath, `${token}\n`);
    rotated = true;
  }
  if (!token) throw new Error("No runtime token is available after renewal");

  const fingerprint = tokenFingerprint(token);
  let appliedFingerprint: string | undefined;
  try {
    appliedFingerprint = (await readFile(config.statePath, "utf8")).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const restarted = appliedFingerprint !== fingerprint;
  if (restarted) {
    const unit = `positioncrew-runtime@${config.runtimeInstance}.service`;
    await (dependencies.restart ?? defaultRestart)(unit);
    await writePrivateAtomic(config.statePath, `${fingerprint}\n`);
  }
  const expiresAt = resolveRuntimeTokenExpiry(token);
  if (!expiresAt) throw new Error("Installed runtime token expiry is unknown");
  return { rotated, restarted, expiresAt: expiresAt.toISOString() };
}

function log(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

async function main(): Promise<void> {
  const config = parseRenewalEnvironment();
  const result = await renewRuntimeToken(config);
  log({
    event: "termix.runtime-token.renewal-complete",
    agentId: config.agentId,
    runtimeInstance: config.runtimeInstance,
    ...result,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        at: new Date().toISOString(),
        event: "termix.runtime-token.renewal-failed",
        error: error instanceof Error ? error.message : "Unknown renewal error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
