import { publishFounderAgentAdvantageReport } from "../benchmark/founder-publication.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmation = "--confirm-founder-operated-nonblind";
  const reportDirectories = args.filter((argument) => argument !== confirmation);
  if (reportDirectories.length !== 1 || args.length !== 2 || !args.includes(confirmation)) {
    throw new Error(
      "Usage: npm run benchmark:publish-founder-report -- <report-directory> --confirm-founder-operated-nonblind",
    );
  }
  const status = publishFounderAgentAdvantageReport(reportDirectories[0]!, {
    confirmedFounderOperatedNonblind: true,
  });
  process.stdout.write(`${JSON.stringify(status)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
