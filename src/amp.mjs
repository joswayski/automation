import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execute = promisify(execFile);

export async function launchAmp({ project, prompt, title, agentMode }, apiKey) {
  const home = await mkdtemp(join(tmpdir(), "amp-ci-repair-"));
  // Never pass the caller's GitHub token, other Actions secrets, or environment
  // overrides to the downloaded installer or CLI. No failing-run checkout exists.
  const env = { HOME: home, PATH: process.env.PATH, AMP_HOME: join(home, ".amp") };
  const response = await fetch("https://ampcode.com/install.sh", {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Amp installer download failed");
  const installer = join(home, "install.sh");
  await writeFile(installer, await response.text(), { mode: 0o600 });
  await execute("bash", [installer], { env, cwd: home, timeout: 180_000, maxBuffer: 1024 * 1024 });
  const invocation = execute(
    join(env.AMP_HOME, "bin", "amp"),
    ["-ox", prompt, "--project", project, "--title", title, "--mode", agentMode],
    {
      env: { ...env, AMP_API_KEY: apiKey },
      cwd: home,
      timeout: 90_000,
      maxBuffer: 1024 * 1024,
    },
  );
  // The prompt is already in argv. Amp also reads non-TTY stdin, so an open
  // input pipe would time out instead of proceeding with the remote launch.
  invocation.child.stdin.end();
  const { stdout } = await invocation;
  const urls = stdout.match(/https:\/\/ampcode\.com\/threads\/T-[a-f0-9-]{36}/g);
  if (urls?.length !== 1) throw new Error("Amp launch response was ambiguous");
  return urls[0];
}
