import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  TERMIX_RUNTIME_DEFAULT_POLL_SECONDS,
  TERMIX_RUNTIME_MIN_POLL_SECONDS,
  TermixRuntimeClient,
  TermixRuntimeHttpError,
  TermixRuntimeTokenError,
  TermixRuntimeStateSchema,
  assertRuntimeTokenFresh,
  buildTermixRuntimeDecision,
  createTermixRuntimeState,
  hasProcessedRuntimeMessage,
  recordTermixRuntimeDecision,
  recordTermixRuntimePoll,
  runtimePollSince,
  type PositionCrewService,
  type TermixRuntimeTransport,
  type TermixRuntimeState,
} from "../commerce/aacp-runtime.js";
import { ServiceTypeSchema } from "../contracts/common.js";

interface RuntimeEnvironment {
  agentId: string;
  service: PositionCrewService;
  token: string;
  tokenExpiresAt: string | undefined;
  baseUrl: string;
  origin: string;
  statePath: string;
  pollSeconds: number;
  once: boolean;
}

export const TERMIX_RUNTIME_CREDENTIAL_EXIT_CODE = 78;

export function runtimeExitCode(error: unknown): number {
  return error instanceof TermixRuntimeTokenError
    ? TERMIX_RUNTIME_CREDENTIAL_EXIT_CODE
    : 1;
}

export function parseRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
): RuntimeEnvironment {
  if (env.WALLET_KEY || env.PRIVATE_KEY) {
    throw new Error("Refusing to start: the runtime host must not receive an owner private key");
  }
  const agentId = env.TERMIX_A2A_AGENT_ID?.trim();
  const token = env.TERMIX_A2A_RUNTIME_TOKEN?.trim();
  const service = ServiceTypeSchema.safeParse(env.POSITIONCREW_SERVICE?.trim());
  if (!agentId) throw new Error("TERMIX_A2A_AGENT_ID is required");
  if (!token) throw new Error("TERMIX_A2A_RUNTIME_TOKEN is required");
  if (!service.success) {
    throw new Error(
      "POSITIONCREW_SERVICE must be LENDING_RESCUE, LP_REBALANCE, YIELD_OPTIMIZATION, or BOUNDED_GRID",
    );
  }
  const pollSeconds = Number(env.TERMIX_A2A_POLL_SECONDS ?? TERMIX_RUNTIME_DEFAULT_POLL_SECONDS);
  if (!Number.isInteger(pollSeconds) || pollSeconds < TERMIX_RUNTIME_MIN_POLL_SECONDS) {
    throw new Error(`TERMIX_A2A_POLL_SECONDS must be an integer >= ${TERMIX_RUNTIME_MIN_POLL_SECONDS}`);
  }
  return {
    agentId,
    service: service.data,
    token,
    tokenExpiresAt: env.TERMIX_A2A_RUNTIME_TOKEN_EXPIRES_AT?.trim() || undefined,
    baseUrl: env.TERMIX_AACP_BASE_URL?.trim() || "https://platform-backend.prod.termix.live",
    origin: env.POSITIONCREW_ORIGIN?.trim() || "https://positioncrew.dolepee.com",
    statePath: resolve(
      env.TERMIX_A2A_STATE_PATH?.trim() ||
        `.state/termix-runtime-${service.data.toLowerCase()}.json`,
    ),
    pollSeconds,
    once: argv.includes("--once"),
  };
}

async function loadState(config: RuntimeEnvironment): Promise<TermixRuntimeState> {
  try {
    const state = TermixRuntimeStateSchema.parse(
      JSON.parse(await readFile(config.statePath, "utf8")) as unknown,
    );
    if (state.agentId !== config.agentId || state.service !== config.service) {
      throw new Error("Runtime state belongs to another agent or service");
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return createTermixRuntimeState(config.agentId, config.service);
  }
}

async function storeState(path: string, state: TermixRuntimeState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function log(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

export async function runRuntimeCycle(
  config: RuntimeEnvironment,
  state: TermixRuntimeState,
  client: TermixRuntimeTransport = new TermixRuntimeClient(config.token, config.baseUrl),
  now = new Date(),
): Promise<TermixRuntimeState> {
  assertRuntimeTokenFresh(config.token, {
    now,
    ...(config.tokenExpiresAt ? { explicitExpiry: config.tokenExpiresAt } : {}),
  });
  const messages = (await client.poll(runtimePollSince(state), 25)).sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.messageId.localeCompare(right.messageId),
  );
  let next = recordTermixRuntimePoll(state, now);
  for (const message of messages) {
    if (hasProcessedRuntimeMessage(next, message.messageId)) continue;
    const decision = buildTermixRuntimeDecision(message, config.service, config.origin);
    if (decision.disposition === "REPLY") {
      await client.signal(message.conversationId).catch(() => undefined);
      await client.reply(message.conversationId, decision.text, decision.clientMessageId);
      log({
        event: "termix.runtime.reply",
        agentId: config.agentId,
        service: config.service,
        messageId: message.messageId,
        conversationKind: message.conversationKind,
      });
    } else if (decision.disposition === "OPERATOR_REQUIRED") {
      log({
        event: "termix.runtime.operator-required",
        agentId: config.agentId,
        service: config.service,
        messageId: message.messageId,
        conversationId: message.conversationId,
        conversationKind: message.conversationKind,
        orderId: message.orderId ?? null,
        disputeId: message.disputeId ?? null,
        reason: decision.reason,
      });
    }
    next = recordTermixRuntimeDecision(next, message, decision, now);
    await storeState(config.statePath, next);
  }
  return next;
}

async function main(): Promise<void> {
  const config = parseRuntimeEnvironment();
  const expiresAt = assertRuntimeTokenFresh(config.token, {
    ...(config.tokenExpiresAt ? { explicitExpiry: config.tokenExpiresAt } : {}),
  });
  let state = await loadState(config);
  await storeState(config.statePath, state);
  log({
    event: "termix.runtime.started",
    agentId: config.agentId,
    service: config.service,
    statePath: config.statePath,
    expiresAt: expiresAt.toISOString(),
    signingMaterialPresent: false,
  });
  while (true) {
    try {
      state = await runRuntimeCycle(config, state);
    } catch (error) {
      if (
        error instanceof TermixRuntimeHttpError &&
        error.status >= 500
      ) {
        log({ event: "termix.runtime.transient-error", status: error.status });
      } else {
        throw error;
      }
    }
    if (config.once) return;
    await sleep(config.pollSeconds * 1_000);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        at: new Date().toISOString(),
        event: "termix.runtime.stopped",
        error: error instanceof Error ? error.message : "Unknown runtime error",
      })}\n`,
    );
    process.exitCode = runtimeExitCode(error);
  });
}
