import { writeFounderAgentAdvantageReport } from "../benchmark/founder-report.js";

async function main(): Promise<void> {
  const [outputDirectory, lendingSession, lpSession, gridSession, ...extra] = process.argv.slice(2);
  if (!outputDirectory || !lendingSession || !lpSession || !gridSession || extra.length > 0) {
    throw new Error(
      "Usage: npm run benchmark:founder-report -- <output-directory> <lending-session> <lp-session> <grid-session>",
    );
  }
  const result = writeFounderAgentAdvantageReport(
    [lendingSession, lpSession, gridSession],
    { outputDirectory },
  );
  process.stdout.write(
    `${JSON.stringify({ directory: result.directory, reportHash: result.report.reportHash })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
