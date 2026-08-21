import { verifyFounderAgentAdvantageReport } from "../benchmark/founder-report.js";

async function main(): Promise<void> {
  const [reportDirectory, ...extra] = process.argv.slice(2);
  if (!reportDirectory || extra.length > 0) {
    throw new Error(
      "Usage: npm run benchmark:verify-founder-report -- <report-directory>",
    );
  }
  const report = verifyFounderAgentAdvantageReport(reportDirectory);
  process.stdout.write(
    `${JSON.stringify({ reportHash: report.reportHash, evidenceManifestHash: report.evidenceManifestHash })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
