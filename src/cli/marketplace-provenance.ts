import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  captureMarketplaceInvocationEvidence,
  loadMarketplaceInvocationProtocol,
  verifyMarketplaceInvocationEvidence,
  writeMarketplaceInvocationEvidenceExclusive,
} from "../benchmark/marketplace-provenance.js";

const command = process.argv[2];
const root = resolve(process.cwd());

if (command === "verify-protocol") {
  const protocol = loadMarketplaceInvocationProtocol(root);
  console.log(JSON.stringify({ protocolHash: protocol.protocolHash, taskCount: protocol.tasks.length }, null, 2));
} else if (command === "capture") {
  const worktree = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (worktree.length > 0) {
    throw new Error(
      "Marketplace evidence capture requires a clean committed worktree; commit the protocol before invoking production.",
    );
  }
  const protocolCommitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const evidence = await captureMarketplaceInvocationEvidence({ root, protocolCommitSha });
  const path = writeMarketplaceInvocationEvidenceExclusive(evidence, root);
  console.log(
    JSON.stringify(
      {
        path,
        evidenceHash: evidence.evidenceHash,
        successCount: evidence.aggregate.successCount,
        allAttemptsSucceeded: evidence.aggregate.allAttemptsSucceeded,
        summaries: evidence.summaries,
      },
      null,
      2,
    ),
  );
  if (!evidence.aggregate.allAttemptsSucceeded) process.exitCode = 1;
} else if (command === "verify") {
  const evidence = verifyMarketplaceInvocationEvidence(root);
  console.log(
    JSON.stringify(
      {
        evidenceHash: evidence.evidenceHash,
        successCount: evidence.aggregate.successCount,
        allAttemptsSucceeded: evidence.aggregate.allAttemptsSucceeded,
        summaries: evidence.summaries,
      },
      null,
      2,
    ),
  );
} else {
  throw new Error(
    "Usage: tsx src/cli/marketplace-provenance.ts <verify-protocol|capture|verify>",
  );
}
