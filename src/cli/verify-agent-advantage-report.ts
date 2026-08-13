import { resolve } from "node:path";
import { verifyAgentAdvantageReport } from "../benchmark/report.js";

const directory = process.argv[2];
if (!directory) {
  throw new Error("Usage: npm run benchmark:verify-report -- <report-directory>");
}

const report = verifyAgentAdvantageReport(resolve(directory));
console.log(
  JSON.stringify(
    {
      reportHash: report.reportHash,
      evidenceManifestHash: report.summary.evidenceManifestHash,
      taskCount: report.summary.taskCount,
      supportedAdvantageCount: report.summary.supportedAdvantageCount,
      manualOperator: report.participants.manualOperator,
      blindEvaluator: report.participants.blindEvaluator,
    },
    null,
    2,
  ),
);
