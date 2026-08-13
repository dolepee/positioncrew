import { resolve } from "node:path";
import { stageAgentAdvantageReport } from "../benchmark/publication.js";

const [reportDirectory, acknowledgement, ...extra] = process.argv.slice(2);
if (
  !reportDirectory ||
  acknowledgement !== "--confirm-independent-humans" ||
  extra.length > 0
) {
  throw new Error(
    "Usage: npm run benchmark:publish-report -- <report-directory> --confirm-independent-humans",
  );
}

const publication = stageAgentAdvantageReport(
  resolve(reportDirectory),
  resolve("web/public"),
  { confirmedIndependentHumans: true },
);
console.log(JSON.stringify(publication, null, 2));
