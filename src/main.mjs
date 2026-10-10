import { readFile, appendFile } from "node:fs/promises";
import { GitHub } from "./github.mjs";
import { repair } from "./repair.mjs";
import { launchAmp } from "./amp.mjs";

const input = (name) => process.env[`INPUT_${name.toUpperCase()}`];

try {
  const result = await repair(
    {
      event: JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")),
      eventName: process.env.GITHUB_EVENT_NAME,
      repo: process.env.GITHUB_REPOSITORY,
      enabled: input("enabled"),
      dryRun: input("dry-run") === "true",
      dailyLimit: input("daily-limit"),
      ampKey: input("amp-api-key"),
    },
    {
      github: new GitHub(input("github-token")),
      launch: (request) => launchAmp(request, input("amp-api-key")),
    },
  );
  const summary = `Amp CI repair: ${JSON.stringify(result)}\n`;
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} catch (error) {
  // Exceptions from subprocesses can contain credentials or untrusted output.
  // repair() replaces launch errors with a safe status; do not print stacks.
  console.error(
    `Amp CI repair failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
}
