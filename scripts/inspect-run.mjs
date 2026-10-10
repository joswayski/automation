// Read-only replay against live GitHub metadata. Never creates issues or orbs.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitHub } from "../src/github.mjs";
import { repair } from "../src/repair.mjs";
import repositories from "../src/repositories.json" with { type: "json" };

const [repo, runID] = process.argv.slice(2);
if (
  !repositories[repo] ||
  !/^[1-9][0-9]*$/.test(runID ?? "") ||
  !Number.isSafeInteger(Number(runID))
) {
  throw new Error("Usage: node scripts/inspect-run.mjs <enrolled-owner/repo> <run-id>");
}
const execute = promisify(execFile);
const github = new GitHub("", async (url, init) => {
  if (init.method !== "GET") throw new Error("Read-only inspection refuses writes");
  const { pathname, search } = new URL(url);
  try {
    const { stdout } = await execute("gh", ["api", `${pathname}${search}`], {
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return new Response(stdout, { headers: { "Content-Type": "application/json" } });
  } catch {
    throw new Error("GitHub read via gh failed; check authentication and repository access");
  }
});
const repository = await github.call(`/repos/${repo}`);
const workflow_run = await github.call(`/repos/${repo}/actions/runs/${runID}`);
const result = await repair(
  {
    repo,
    eventName: "workflow_run",
    enabled: "true",
    dryRun: true,
    event: { action: "completed", repository, workflow_run },
  },
  {
    github,
    launch: async () => {
      throw new Error("Read-only inspection refuses launches");
    },
  },
);
console.log(JSON.stringify(result, null, 2));
