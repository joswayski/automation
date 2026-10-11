import assert from "node:assert/strict";
import test from "node:test";
import { repair } from "../src/repair.mjs";
import { launchAmp } from "../src/amp.mjs";
import { GitHub } from "../src/github.mjs";
import { listener } from "../scripts/listener.mjs";
import repositories from "../src/repositories.json" with { type: "json" };

const sha = "0123456789abcdef0123456789abcdef01234567";
const otherSha = "fedcba9876543210fedcba9876543210fedcba98";
const threadURL = "https://ampcode.com/threads/T-12345678-1234-1234-1234-123456789012";
const now = new Date("2026-10-10T16:00:00Z");

function harness(repo = "joswayski/caper") {
  const state = {
    repository: { id: 42, full_name: repo, default_branch: "main" },
    run: {
      id: 123,
      workflow_id: 7,
      run_number: 10,
      run_attempt: 2,
      created_at: "2026-10-10T15:00:00Z",
      path: ".github/workflows/ci.yml",
      name: "CI",
      event: "push",
      head_branch: "main",
      head_sha: sha,
      head_repository: { id: 42, full_name: repo },
      status: "completed",
      conclusion: "failure",
    },
    head: sha,
    jobs: [{ id: 9, conclusion: "failure", steps: [] }],
    runs: [],
    candidateJobs: {},
    failCandidateJobs: false,
    runsTotal: undefined,
    failRunsList: false,
    issues: [],
    comments: [],
    prs: [],
    labels: [],
    launches: [],
    writes: [],
    failIssueCreate: false,
    failIssueUpdate: false,
    launchError: false,
  };
  const options = {
    event: {
      action: "completed",
      repository: { ...state.repository },
      workflow_run: { id: 123, run_attempt: 2 },
    },
    eventName: "workflow_run",
    repo,
    enabled: "true",
    dailyLimit: "3",
    ampKey: "sgamp_test-only-not-a-real-token",
  };
  const request = async (urlString, init) => {
    const url = new URL(urlString);
    const path = url.pathname.replace(`/repos/${repo}`, "");
    const body = init.body && JSON.parse(init.body);
    const json = (value, status = 200) => Response.json(value, { status });
    const page = (items) =>
      items.slice(
        (Number(url.searchParams.get("page")) - 1) * 100,
        Number(url.searchParams.get("page")) * 100,
      );
    if (init.method === "GET") {
      if (path === "") return json(state.repository);
      if (path === `/actions/runs/${state.run.id}`) return json(state.run);
      if (path === `/actions/runs/${state.run.id}/attempts/${state.run.run_attempt}/jobs`)
        return json({ jobs: page(state.jobs) });
      const candidateAttempt = path.match(/^\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/);
      if (candidateAttempt) {
        if (state.failCandidateJobs) return json({}, 503);
        return json({ jobs: page(state.candidateJobs[`${candidateAttempt[1]}/${candidateAttempt[2]}`] ?? []) });
      }
      if (path === `/actions/workflows/${state.run.workflow_id}/runs`) {
        if (state.failRunsList) return json({}, 503);
        return json({
          workflow_runs: page(state.runs),
          total_count: state.runsTotal ?? state.runs.length,
        });
      }
      if (path === "/git/ref/heads/main") return json({ object: { sha: state.head } });
      if (path === "/issues") return json(page(state.issues));
      if (path === "/pulls") return json(page(state.prs));
      if (path === "/labels/amp-ci-repair")
        return state.labels.length ? json(state.labels[0]) : json({}, 404);
    }
    state.writes.push({ path, method: init.method, body });
    if (path === "/labels" && init.method === "POST") {
      state.labels.push(body);
      return json(body, 201);
    }
    if (path === "/issues" && init.method === "POST") {
      if (state.failIssueCreate) return json({ message: "private diagnostic must not leak" }, 403);
      const issue = {
        ...body,
        number: state.issues.length + 1,
        state: "open",
        user: { login: "github-actions[bot]" },
        created_at: now.toISOString(),
      };
      state.issues.push(issue);
      return json(issue, 201);
    }
    if (path.endsWith("/comments") && init.method === "POST") {
      if (state.failIssueUpdate) return json({}, 503);
      state.comments.push(body);
      return json(body, 201);
    }
    throw new Error(`Unexpected HTTP request: ${init.method} ${path}`);
  };
  const dependencies = {
    github: new GitHub("test-github-token", request),
    now,
    launch: async (request) => {
      state.launches.push(request);
      // Model a lost response after Amp has accepted the request.
      if (state.launchError) throw new Error("sensitive subprocess output");
      return threadURL;
    },
  };
  return { state, options, run: () => repair(options, dependencies) };
}

test("a failed attempt creates a durable issue and launches the exact Amp project, then suppresses reruns and sibling workflows", async () => {
  const h = harness();
  assert.deepEqual(await h.run(), { status: "launched", issue: 1, threadURL, agentMode: "high" });
  assert.match(h.state.issues[0].body, /attempts\/2/);
  assert.match(h.state.issues[0].body, /Agent mode: `high`/);
  assert.match(h.state.comments[0].body, /Status: \*\*launched\*\*/);
  assert.match(h.state.comments[0].body, /ampcode.com\/threads/);
  assert.equal(h.state.launches[0].project, "josevalerio/caper");
  assert.equal(h.state.launches[0].agentMode, "high");
  assert.match(
    h.state.launches[0].prompt,
    /PR marker: <!-- amp-ci-repair:v1 0123456789abcdef0123456789abcdef01234567 -->/,
  );
  assert.match(h.state.launches[0].prompt, /owner explicitly authorizes.*squash-merge/);
  assert.match(h.state.launches[0].prompt, /gh pr merge.*--squash.*--match-head-commit/);
  assert.match(h.state.launches[0].prompt, /Never use --admin/);
  assert.match(h.state.issues[0].body, /automatically squash-merge/);
  h.state.issues[0].state = "closed";
  h.state.run.run_attempt = 3;
  h.options.event.workflow_run.run_attempt = 3;
  assert.equal((await h.run()).status, "skipped");
  h.state.run.id = 124;
  h.options.event.workflow_run.id = 124;
  h.state.run.path = ".github/workflows/native.yml";
  h.state.run.name = "Native development builds";
  assert.equal((await h.run()).status, "skipped");
  assert.equal(h.state.launches.length, 1);
  assert.equal(h.state.issues.length, 1);
});

test("Claude Code can be selected explicitly without reopening an existing reservation", async () => {
  const h = harness();
  h.options.agentMode = "external-agent:claude-code";
  assert.deepEqual(await h.run(), {
    status: "launched",
    issue: 1,
    threadURL,
    agentMode: "external-agent:claude-code",
  });
  assert.equal(h.state.launches[0].agentMode, "external-agent:claude-code");
  assert.match(h.state.issues[0].body, /Agent mode: `external-agent:claude-code`/);
  h.options.agentMode = "high";
  h.state.issues[0].state = "closed";
  assert.equal((await h.run()).status, "skipped");
  assert.equal(h.state.launches.length, 1);
});

test("cancellation with a failed step launches, but ordinary cancellations and successful continue-on-error workflows do not", async () => {
  for (const [conclusion, step, expected] of [
    ["cancelled", "failure", "launched"],
    ["cancelled", "timed_out", "launched"],
    ["cancelled", "cancelled", "skipped"],
    ["cancelled", "success", "skipped"],
    ["success", "failure", "skipped"],
  ]) {
    const h = harness();
    h.state.run.conclusion = conclusion;
    h.state.jobs = [{ conclusion: "cancelled", steps: [{ conclusion: step }] }];
    assert.equal((await h.run()).status, expected, `${conclusion}/${step}`);
    assert.equal(h.state.launches.length, expected === "launched" ? 1 : 0);
  }
});

test("only enrolled, trusted main completions and the latest attempt are eligible", async (t) => {
  const cases = {
    disabled: (h) => {
      h.options.enabled = "false";
    },
    "fork caller": (h) => {
      h.options.repo = "attacker/caper";
    },
    "PR trigger": (h) => {
      h.options.eventName = "pull_request";
    },
    "running event": (h) => {
      h.options.event.action = "in_progress";
    },
    "wrong repository": (h) => {
      h.options.event.repository.id = 43;
    },
    "branch renamed": (h) => {
      h.state.repository.default_branch = "other";
    },
    "fork source": (h) => {
      h.state.run.head_repository = { id: 43, full_name: "attacker/caper" };
    },
    "different repo ID": (h) => {
      h.state.run.head_repository.id = 43;
    },
    "feature branch": (h) => {
      h.state.run.head_branch = "feature";
    },
    "pull request source": (h) => {
      h.state.run.event = "pull_request";
    },
    "scheduled source": (h) => {
      h.state.run.event = "schedule";
    },
    "unapproved chain": (h) => {
      h.state.run.event = "workflow_run";
    },
    "lookalike name": (h) => {
      h.state.run.path = ".github/workflows/untrusted.yml";
    },
    "renamed workflow": (h) => {
      h.state.run.name = "Something else";
    },
    "incomplete run": (h) => {
      h.state.run.status = "in_progress";
    },
    "already successful": (h) => {
      h.state.run.conclusion = "success";
    },
    "stale attempt": (h) => {
      h.state.run.run_attempt++;
    },
    "missing workflow identity": (h) => {
      delete h.state.run.workflow_id;
    },
    "invalid workflow run ordering": (h) => {
      h.state.run.run_number = 0;
    },
    "missing creation time": (h) => {
      delete h.state.run.created_at;
    },
  };
  for (const [name, modify] of Object.entries(cases))
    await t.test(name, async () => {
      const h = harness();
      modify(h);
      assert.equal((await h.run()).status, "skipped");
      assert.deepEqual(h.state.writes, []);
      assert.deepEqual(h.state.launches, []);
    });
});

test("a path-filtered native failure remains eligible after an unrelated main commit", async () => {
  const h = harness();
  Object.assign(h.state.run, {
    path: ".github/workflows/native.yml",
    name: "Native development builds",
    conclusion: "cancelled",
  });
  h.state.jobs = [{ conclusion: "cancelled", steps: [{ conclusion: "failure" }] }];
  h.state.head = otherSha;
  h.state.runs = [h.state.run]; // No native push ran on the logo-only commit.
  assert.equal((await h.run()).status, "launched");
  assert.equal(h.state.launches.length, 1);
  assert.match(h.state.launches[0].prompt, /Fetch the current default branch/);
  assert.match(h.state.launches[0].prompt, /Verify the failure is still relevant before editing/);
});

test("only a newer trusted push of the same workflow on a different SHA supersedes a failure", async (t) => {
  const cases = [
    ["completed success", {}, true],
    ["completed failure", { conclusion: "failure" }, true],
    ["completed timeout", { conclusion: "timed_out" }, true],
    ["completed ordinary cancellation", { conclusion: "cancelled" }, false],
    ["completed skipped", { conclusion: "skipped" }, false],
    ["completed neutral", { conclusion: "neutral" }, false],
    ["completed action required", { conclusion: "action_required" }, false],
    ["completed unknown conclusion", { conclusion: "unknown" }, false],
    ["completed missing conclusion", { conclusion: undefined }, false],
    ["queued", { status: "queued", conclusion: null }, true],
    ["in progress", { status: "in_progress", conclusion: null }, true],
    ["missing status", { status: undefined }, false],
    ["null status", { status: null }, false],
    ["unknown status", { status: "unknown" }, false],
    ["different workflow ID", { workflow_id: 8 }, false],
    ["different enrolled workflow", { path: ".github/workflows/native.yml", name: "Native development builds" }, false],
    ["different workflow name", { name: "Impostor" }, false],
    ["fork", { head_repository: { id: 43, full_name: "attacker/caper" } }, false],
    ["wrong repository ID", { head_repository: { id: 43, full_name: "joswayski/caper" } }, false],
    ["feature branch", { head_branch: "feature" }, false],
    ["pull request", { event: "pull_request" }, false],
    ["dispatch", { event: "workflow_dispatch" }, false],
    ["same SHA", { head_sha: sha }, false],
    ["older run rerun recently", { run_number: 9, run_attempt: 8, updated_at: "2026-10-10T17:00:00Z" }, false],
    ["same run number", { run_number: 10 }, false],
    ["missing run number", { run_number: undefined }, false],
    ["invalid SHA", { head_sha: "main" }, false],
    ["invalid attempt", { run_attempt: 0 }, false],
    ["invalid ID", { id: 0 }, false],
  ];
  for (const [name, changes, supersedes] of cases)
    await t.test(name, async () => {
      const h = harness();
      h.state.head = otherSha;
      h.state.runs = [{
        ...h.state.run,
        id: 124,
        run_number: 11,
        head_sha: otherSha,
        conclusion: "success",
        ...changes,
      }];
      const result = await h.run();
      assert.equal(result.status, supersedes ? "skipped" : "launched");
      if (supersedes) {
        assert.match(result.reason, /newer trusted push run of this workflow/);
        assert.deepEqual(h.state.writes, []);
        assert.deepEqual(h.state.launches, []);
      }
    });
});

test("a completed cancelled replacement supersedes only with failures in its exact attempt", async (t) => {
  const cases = [
    ["failed job", [{ conclusion: "failure" }], true],
    ["timed-out job", [{ conclusion: "timed_out" }], true],
    ["failed step in cancelled job", [{ conclusion: "cancelled", steps: [{ conclusion: "failure" }] }], true],
    ["timed-out step in cancelled job", [{ conclusion: "cancelled", steps: [{ conclusion: "timed_out" }] }], true],
    ["ordinary cancellation", [{ conclusion: "cancelled", steps: [{ conclusion: "cancelled" }] }], false],
    ["no jobs", [], false],
    ["failure in successful job is not the failure rule", [{ conclusion: "success", steps: [{ conclusion: "failure" }] }], false],
    ["page-two failed step", [
      ...Array.from({ length: 100 }, () => ({ conclusion: "success" })),
      { conclusion: "cancelled", steps: [{ conclusion: "failure" }] },
    ], true],
  ];
  for (const [name, jobs, supersedes] of cases)
    await t.test(name, async () => {
      const h = harness();
      h.state.runs = [{
        ...h.state.run,
        id: 124,
        run_number: 11,
        run_attempt: 3,
        head_sha: otherSha,
        conclusion: "cancelled",
      }];
      // The old attempt has the opposite result: inspecting it must not count.
      h.state.candidateJobs["124/2"] = supersedes ? [] : [{ conclusion: "failure" }];
      h.state.candidateJobs["124/3"] = jobs;
      assert.equal((await h.run()).status, supersedes ? "skipped" : "launched");
      if (supersedes) assert.deepEqual(h.state.writes, []);
      else assert.equal(h.state.launches.length, 1);
    });

  const h = harness();
  h.state.runs = [{ ...h.state.run, id: 124, run_number: 11, head_sha: otherSha, conclusion: "cancelled" }];
  h.state.failCandidateJobs = true;
  await assert.rejects(h.run(), /503/);
  assert.deepEqual(h.state.writes, []);
  assert.deepEqual(h.state.launches, []);
  h.state.failCandidateJobs = false;
  h.state.runs.push({ ...h.state.runs[0], id: 125, run_number: 12, conclusion: "success" });
  // An ordinary cancellation must not hide another qualifying replacement.
  assert.equal((await h.run()).status, "skipped");
  assert.deepEqual(h.state.writes, []);
});

test("supersession checks all pages and refuses failed or truncated workflow lookups", async () => {
  const h = harness();
  h.state.runs = [
    ...Array.from({ length: 100 }, () => ({ ...h.state.run, run_number: 9 })),
    { ...h.state.run, id: 124, run_number: 11, head_sha: otherSha },
  ];
  assert.equal((await h.run()).status, "skipped");
  h.state.failRunsList = true;
  await assert.rejects(h.run(), /503/);
  h.state.failRunsList = false;
  h.state.runs = Array.from({ length: 1000 }, () => ({ ...h.state.run, run_number: 9 }));
  h.state.runsTotal = 1001; // GitHub caps filtered workflow searches at 1,000.
  await assert.rejects(h.run(), /incomplete safety check/);
  assert.deepEqual(h.state.writes, []);
  assert.deepEqual(h.state.launches, []);
});

test("different deployments at the same infrastructure SHA have separate reservations", async () => {
  const h = harness("joswayski/infrastructure");
  Object.assign(h.state.run, {
    path: ".github/workflows/deploy-caper-web.yml",
    name: "Deploy Caper web",
    event: "workflow_dispatch",
  });
  h.state.head = otherSha; // Deploys can commit an image pin before their run completes.
  h.state.failRunsList = true; // Push supersession must not apply to dispatches.
  assert.equal((await h.run()).status, "launched");
  assert.equal(h.state.launches[0].project, "josevalerio/infrastructure");
  assert.match(h.state.issues[0].body, /amp-ci-repair:v1 run-123/);
  h.state.issues[0].state = "closed";
  h.state.run.id = 124;
  h.options.event.workflow_run.id = 124;
  assert.equal((await h.run()).status, "launched");
  assert.match(h.state.issues[1].body, /amp-ci-repair:v1 run-124/);
});

test("explicitly enrolled chained releases are supported without admitting arbitrary workflow_run sources", async () => {
  const h = harness("joswayski/findanything");
  Object.assign(h.state.run, {
    path: ".github/workflows/native-release.yml",
    name: "Native Preview release",
    event: "workflow_run",
  });
  assert.equal((await h.run()).status, "launched");
  assert.match(h.state.issues[0].body, /amp-ci-repair:v1 run-123/);
});

test("distinct failures, including failed fixes, have no daily cap even with a legacy limit configured", async () => {
  // This option used to limit all repairs to three per rolling day. Old callers
  // must not retain that cap, and raising it to the former maximum of ten is not enough.
  for (const dailyLimit of [undefined, "3"]) {
    const h = harness();
    h.options.dailyLimit = dailyLimit;
    for (let i = 0; i < 12; i++) {
      h.state.run.head_sha = h.state.head = (i + 1).toString(16).padStart(40, "0");
      assert.equal((await h.run()).status, "launched", `failure ${i + 1}`);
      h.state.issues[i].state = "closed";
    }
    assert.equal(h.state.launches.length, 12);
    assert.equal(h.state.issues.length, 12);
    assert.match((await h.run()).reason, /already reserved/);
    assert.equal(h.state.launches.length, 12);
  }
});

test("an open tracking issue pauses newer commits until reviewed; an open repair PR still blocks after issue closure", async () => {
  const h = harness();
  await h.run();
  h.state.run.head_sha = h.state.head = otherSha;
  assert.match((await h.run()).reason, /open tracking issue/);
  h.state.issues[0].state = "closed";
  h.state.prs = [{ head: { ref: `amp/ci-repair/${sha}` } }];
  assert.match((await h.run()).reason, /repair PR/);
  h.state.prs = [];
  assert.equal((await h.run()).status, "launched");
});

test("a lost launch response cannot create a second agent and does not leak subprocess output", async () => {
  const h = harness();
  h.state.launchError = true;
  await assert.rejects(h.run(), (error) => {
    assert.match(error.message, /launch unconfirmed/);
    assert.doesNotMatch(error.message, /sensitive/);
    return true;
  });
  assert.match(h.state.comments[0].body, /launch unconfirmed/);
  h.options.agentMode = "external-agent:claude-code";
  assert.equal((await h.run()).status, "skipped");
  assert.equal(h.state.launches.length, 1);
});

test("failure to record the returned thread leaves the reservation, rather than relaunching", async () => {
  const h = harness();
  h.state.failIssueUpdate = true;
  await assert.rejects(
    h.run(),
    /Thread created at https:\/\/ampcode.com\/threads\/T-12345678-1234-1234-1234-123456789012/,
  );
  assert.match(h.state.issues[0].body, /\*\*reserved\*\*/);
  assert.equal((await h.run()).status, "skipped");
  assert.equal(h.state.launches.length, 1);
});

test("failure to reserve prevents launch", async () => {
  const h = harness();
  h.state.failIssueCreate = true;
  await assert.rejects(h.run(), (error) => {
    assert.match(error.message, /403/);
    assert.doesNotMatch(error.message, /private diagnostic/);
    return true;
  });
  assert.deepEqual(h.state.launches, []);
});

test("dry run needs no Amp key and makes no writes or launches", async () => {
  const h = harness();
  h.options.dryRun = true;
  h.options.ampKey = "";
  for (const agentMode of ["high", "external-agent:claude-code"]) {
    h.options.agentMode = agentMode;
    assert.deepEqual(await h.run(), {
      status: "would-launch",
      project: "josevalerio/caper",
      key: sha,
      failedJobs: 1,
      agentMode,
    });
  }
  assert.deepEqual(h.state.writes, []);
  assert.deepEqual(h.state.launches, []);
});

test("safety checks cover all pages of jobs, issues, and repair PRs", async () => {
  const h = harness();
  h.state.jobs = [
    ...Array.from({ length: 100 }, () => ({ conclusion: "success" })),
    { conclusion: "timed_out" },
  ];
  await h.run();
  const reservation = h.state.issues[0];
  const unrelated = Array.from({ length: 100 }, () => ({ body: "", user: { login: "someone" } }));
  h.state.issues = [...unrelated, reservation];
  assert.equal((await h.run()).status, "skipped");
  reservation.state = "closed";
  h.state.run.head_sha = h.state.head = otherSha;
  h.state.prs = [
    ...Array.from({ length: 100 }, () => ({ head: { ref: "unrelated" } })),
    { head: { ref: "amp/ci-repair/previous" } },
  ];
  assert.match((await h.run()).reason, /repair PR/);
  assert.equal(h.state.launches.length, 1);
});

test("missing credentials and unsupported modes fail before reserving", async () => {
  for (const changes of [
    { ampKey: "" },
    { ampKey: "session-token" },
    { agentMode: "claude-code" },
    { agentMode: "claude-opus-5-5" },
    { agentMode: "ultra" },
    { agentMode: "high --fast" },
  ]) {
    const h = harness();
    Object.assign(h.options, changes);
    await assert.rejects(h.run());
    assert.deepEqual(h.state.writes, []);
    assert.deepEqual(h.state.launches, []);
  }
});

test("listeners pin one shared implementation and carry the serialization, permissions and opt-in contract for every enrolled repository", () => {
  for (const [repo, policy] of Object.entries(repositories)) {
    const yaml = listener(repo, sha);
    assert.match(yaml, /uses: joswayski\/automation@0123456789abcdef0123456789abcdef01234567/);
    assert.match(yaml, /group: amp-ci-repair\n  queue: max/);
    assert.match(yaml, /enabled: \$\{\{ vars.AMP_REPAIR_ENABLED }}/);
    assert.match(yaml, /agent-mode: \$\{\{ vars.AMP_REPAIR_MODE \|\| 'high' }}/);
    assert.match(yaml, /amp-api-key: \$\{\{ secrets.AMP_API_KEY }}/);
    assert.match(yaml, /issues: write/);
    assert.doesNotMatch(
      yaml,
      /contents: write|pull-requests: write|actions\/checkout|secrets: inherit|workflow_dispatch:/,
    );
    for (const workflow of Object.values(policy.workflows))
      assert.ok(yaml.includes(JSON.stringify(workflow.name)));
  }
  assert.throws(() => listener("attacker/repo", sha));
  assert.throws(() => listener("joswayski/caper", "main"));
});

test("the CLI launcher can finish reading stdin when its prompt is passed as an argument", async (t) => {
  // Keep the process boundary real: this CLI fixture needs EOF like Amp does,
  // but times out quickly if the parent leaves its input pipe open.
  t.mock.method(globalThis, "fetch", async () => new Response(`#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$AMP_HOME/bin"
cat > "$AMP_HOME/bin/amp" <<'CLI'
#!/usr/bin/env bash
if read -r -t 2; then
  echo 'Unexpected stdin data' >&2
  exit 1
else
  status=$?
  if [[ "$status" != 1 ]]; then
    echo 'Timed out waiting for stdin EOF' >&2
    exit 1
  fi
fi
printf '%s\\n' '${threadURL}'
CLI
chmod +x "$AMP_HOME/bin/amp"
`));
  assert.equal(
    await launchAmp(
      {
        project: "josevalerio/caper",
        prompt: "Investigate a failed CI run",
        title: "CI repair regression test",
        agentMode: "high",
      },
      "sgamp_test-only-not-a-real-token",
    ),
    threadURL,
  );
});
