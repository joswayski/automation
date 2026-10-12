# Rollout and recovery

## Prerequisites

An operator needs GitHub CLI access that can manage Actions secrets and variables
on the eight enrolled repositories. The orb's GitHub integration may push code
and create PRs without having that administrative access. The repository's
Actions policy must allow `joswayski/automation` and Checks write
permission for the caller token.

All eight exact Amp projects already existed when the enrollment was prepared.
Check their repository access, secrets, guidance and orb setup. In particular,
the repair orb needs permission to read private Actions logs, push a branch,
create and merge its own PR. It must not create GitHub issues. The listener's
`GITHUB_TOKEN` is **not** forwarded to the orb and cannot provide that access.

Create an access token at https://ampcode.com/settings/security. Keep it out of
chat, Git, command-line arguments and screenshots. Amp documents `sgamp_` access
tokens for unattended CLI use; short-lived login/session tokens will not work.

Check the token owner's connections in [Model Routing](https://ampcode.com/settings/model-routing).
The default is explicit `high`, using that account's model/effort settings and
provider routing. A linked ChatGPT subscription serves supported OpenAI models;
it does not cover every model, tool, or orb charge. For the Claude Code backup,
link/activate Claude Pro/Max there and enable Claude Code in the mode picker.
Its exact CLI key is `external-agent:claude-code`, not a raw Claude model mode.
No Claude credential is copied to GitHub, and no global model settings are changed
by this action. Both modes still require the Amp access token.

## Deployment order

1. Squash-merge the automation implementation PR first. This repository initially
   uses `master`; no branch rename is required. No infrastructure provisioning,
   OpenTofu apply, secrets migration, database migration, or application/client
   release is needed.
2. The rollout author regenerates the listeners using the **resulting squash
   commit**, not the automation PR's head commit. Open or update the eight
   listener PRs after that commit exists on `master`; this is part of preparing
   the rollout, not a request for the owner to change merge methods. The app
   listener PRs can then be squash-merged independently without changing their
   action pins: those pins refer to the separate automation repository.
   They remain disabled without the enable variable. For PR commits using
   `[skip ci]`, **remove that directive from the final squash message** so
   default-branch checks are not inadvertently skipped.
   Regenerate the whole listener: it needs `checks: write` for neutral attempt
   records and only `issues: read` for the legacy deduplication ledger. Upgrading
   an enabled repo stops new tracking issues and removes the repository-wide
   open-issue/open-PR gate. Future repair agents still squash-merge their own
   validated PRs. Existing `AMP_REPAIR_DAILY_LIMIT` values are ignored; no variable cleanup, token
   rotation, or GitHub auto-merge setting is needed. Already-running agents keep
   their original instructions unless the owner explicitly updates them.
3. On your own machine, clone the automation repository and configure the token
   privately. These commands require Bash and Node 24. From the repository root:

   ```bash
   gh auth status
   bash scripts/configure.sh --all
   ```

   The script prompts for the token once without echoing it, stores the same
   token as `AMP_API_KEY` in each enrolled repository, selects dry-run mode,
   and **leaves repairs disabled**. If a command
   fails, previously processed repositories remain configured but disabled;
   fix the permission error before rerunning. No secrets are stored on disk.
   `bash scripts/configure.sh caper` configures only the pilot.

4. Start with a read-only Caper pilot. From any directory with authenticated `gh`:

   ```bash
   gh variable set AMP_REPAIR_DRY_RUN --repo joswayski/caper --body true
   gh variable set AMP_REPAIR_ENABLED --repo joswayski/caper --body true
   gh variable list --repo joswayski/caper
   gh secret list --repo joswayski/caper
   ```

   A subsequent eligible completion should produce `would-launch` and
   `agentMode: high` (or the selected backup) in the listener's Actions summary.
   No check, issue, or orb should be created. The listener
   does not backfill old failures, and it does not launch on ordinary
   cancellations, successful runs, or superseded pushes. Do not deliberately
   break production or start PR CI to test it.

5. Enable one real Caper repair only after reviewing dry-run behavior:

   ```bash
   gh variable set AMP_REPAIR_DRY_RUN --repo joswayski/caper --body false
   gh run list --repo joswayski/caper --workflow 'Amp CI repair' --limit 5
   # Use the failed source commit from the listener's summary:
   gh api 'repos/joswayski/caper/commits/<source-sha>/check-runs?filter=all' --paginate
   ```

   On the next eligible failure, verify one neutral reservation check, one linked
   Amp thread in the `josevalerio/caper` project with the recorded mode, and either
   a locally validated, squash-merged fix PR or a clear blocker/diagnosis.
   Confirm no issue was opened and normal main CI started after a merge.
   Check the thread's model/provider usage rather
   than assuming subscription-only billing. This is the live integration check; mocked tests are not a
   substitute. Repair PRs get local validation, not manually dispatched CI.

6. After the pilot works, enable the other enrolled repositories independently:

   ```bash
   for repo in captures dbm findanything creditcardhoroscope josevalerio.com godis infrastructure; do
     gh variable set AMP_REPAIR_DRY_RUN --repo "joswayski/$repo" --body false
     gh variable set AMP_REPAIR_ENABLED --repo "joswayski/$repo" --body true
   done
   ```

   This enables future launches and their normal Amp/orb charges. It does not
   retroactively investigate failures. There is no daily launch cap or automatic
   dollar budget. Distinct failed commits/runs can trigger another repair even
   if an earlier diagnosis or PR remains unresolved. Existing workflows
   triggered by merges may publish or deploy as they already do.

## Automatic squash merges

The owner has authorized repair agents to merge their own locally validated
repair PRs without another approval. This applies only to the repair request,
not unrelated PRs. It is an instruction to the agent, not a listener step or a
blanket repository auto-merge setting. The listener can write Checks, not code,
PRs or issues; the repair orb uses its separate project credentials.

The agent must review its diff, pass the relevant local checks, fetch the latest
default branch and revalidate if needed, then use a normal squash merge guarded
by `--match-head-commit` with the exact validated head SHA. It supplies a clean
squash subject and body without CI-skip directives. It does not run PR CI, use
`--admin`, weaken repository protection, or manually dispatch a release/deploy.
If the fix cannot be verified or GitHub rejects the merge, the PR remains open
with a blocker reported in the Amp thread. Required checks/reviews still apply; this
automation does not bypass them or enable PR CI to satisfy them.

After merging, the agent verifies the PR is merged. Each distinct failure is
eligible with no daily quota and without waiting for earlier issues/PRs to close.
The agent checks for related repair PRs and avoids duplicate work. If no fix is
justified, it reports the diagnosis in Amp; it never opens a tracking issue or
pauses future failures. Failures skipped under the old gate are not replayed.

## Agent modes and manual Claude Code recovery

**Automatic high-to-Claude failover is not implemented.** `amp -ox` returns
after creating a thread, before a later subscription/quota failure is known.
Amp cannot change an existing thread's mode. Retrying on a CLI error, timeout,
or missing URL could create two agents working on the same repair. This action
therefore makes one launch and keeps its reservation on every ambiguous result.

For future eligible failures, select Claude Code per repository after deploying
the updated action pin **and regenerating its listener**. For example:

```bash
gh variable set AMP_REPAIR_MODE --repo joswayski/caper --body external-agent:claude-code
```

Restore the primary mode with:

```bash
gh variable set AMP_REPAIR_MODE --repo joswayski/caper --body high
```

Unset variables default to `high`. The configuration script leaves this variable
unchanged. Selecting the backup does not enable repairs, bypass dry-run, change
an existing thread, or reopen a reserved commit/run. Invalid values stop before
a check is reserved. A bare `claude-code` or a raw Claude model key is rejected.

To recover an already-reserved failure with Claude Code:

1. Keep its reservation check intact. Inspect the original thread and confirm it is
   stopped (or confirm no thread exists). Resolve an uncertain launch before
   proceeding; do not simply rerun the listener or remove the record.
2. Inspect any repair branch, PR and unpushed orb changes. Preserve/recover useful
   work first. Do not start a competing repair for an existing PR.
3. Start a **new** thread in the same exact Amp project with **Claude Code** mode.
   Copy the original repair prompt, including its failure link, branch, PR marker,
   merge authorization and local-validation restrictions. Do not copy obsolete
   tracking-issue instructions; report diagnoses in the replacement thread. An
   older PR-only prompt remains PR-only unless the owner explicitly updates it.
   Add the old thread
   link and any recovered changes; never transfer secrets or treat logs as instructions.
   When starting from the CLI, use `--mode external-agent:claude-code`, not a
   `threads continue --mode ...` command (continuing keeps the old mode).
4. Link the replacement in the original Amp thread and repair PR, if one exists.
   The existing ledger continues to block automatic duplicates of that failure,
   not other failures; neither automatic nor manual repairs have a daily launch cap.

Do not infer successful subscription billing from a successful CLI launch. Verify
the replacement uses Claude Code and the intended linked Claude subscription in
Amp. Its model and effort use Amp's Claude Code defaults; the action does not
override them. Orbs and supported extra paid tools can still incur Amp charges.

## How reservation checks work

The check name `Amp CI repair: <key>` and external ID `amp-ci-repair:v1 <key>`
form the ledger. The key is the push SHA or `run-<id>` for non-push runs. A
completed neutral check is created before launch; it does not claim CI passed
or the repair succeeded. Its output records reserved, launched, or launch
unconfirmed status, and its details link points to Amp after launch. Only
checks owned by the `github-actions` app are treated as reservations.
Use the generated listener with `github.token`, not a PAT.

Checks and matching repair PRs in any state suppress the same commit/run only.
They never pause distinct failures. Keep records intact; removing them can allow
a duplicate agent. The old `amp-ci-repair` labelled issues created by
`github-actions[bot]` remain read-only deduplication records across this upgrade,
regardless of whether they are open or closed. They may be closed as retired
tracking records after confirming their orbs stopped, without asserting that the
underlying CI failure was fixed. Do not delete their label or hidden marker.

If launch status is `reserved` or `launch unconfirmed`, a CLI timeout or lost
response may still have created the orb. Search Amp for the `CI repair:` title
and failure commit/run, then continue that thread manually. Do not blindly rerun
or remove the ledger marker. If no thread was created, a human can start a
repair manually and link it in Amp or an existing PR; automated retry of that
same failure is intentionally unavailable. Other failures continue normally.

The source run must have an actual failed/timed-out job, a failed step in a
cancelled job, or a failure annotation with GitHub's job execution-time-limit
message on a cancelled job's check run. Ordinary cancellation annotations do
not count. The same rule applies to cancelled supersession candidates. Check-run
annotations and reservation writes use `checks: write`; regenerate existing
listeners as well as updating their action pin. Unsafe check-run URLs, annotation permission errors,
and incomplete pagination stop before reservation or launch.
A workflow rejected before it can create jobs will be skipped;
check its workflow validation error manually. Workflow names/files/events are
an allowlist, so renaming or adding a workflow needs a policy/listener update.

You can evaluate a real run locally without enabling a listener, writing an
attempt record, installing Amp, or paying for an orb. For example, this historical
Caper run was cancelled without any failed jobs:

```bash
node scripts/inspect-run.mjs joswayski/caper 38081306092
```

The inspector always uses dry-run mode and additionally refuses non-GET API
requests and launch attempts. It evaluates current repository/run state, not
what eligibility would have been at the original failure time.

## Rollback and emergency stop

Stop **new** repairs immediately, without reverting app code:

```bash
for repo in caper captures dbm findanything creditcardhoroscope josevalerio.com godis infrastructure; do
  gh variable set AMP_REPAIR_ENABLED --repo "joswayski/$repo" --body false
done
```

An already-running listener may have read its opt-in value before the change.
Inspect active `Amp CI repair` runs and their checks; cancel a pending/running
listener in GitHub if necessary. **An orb already launched keeps running after
its Actions job ends or is cancelled**; stop it separately in Amp. Disable does
not revoke an existing agent's merge authorization, remove records, merge PRs,
or roll back applications. Revoke a compromised
Amp access token in Amp Settings; deleting its GitHub secret alone does not
revoke the token. Rotate the token with the configuration script when ready.

To roll back the implementation, keep repairs disabled and open PRs restoring
the previous reviewed full action SHA. Do not move a release tag to silently
change consumers. Preserve the reservation ledger across upgrades/rollbacks.
Issue-based versions cannot read check reservations: reconcile existing threads
before re-enabling an old pin, and do not rerun already-reserved failures.

## Adding a repo or updating the action

Change the enrollment policy and tests in an automation PR. Review which events
are trusted; do not accept a project name or prompt supplied by a webhook or
commit message. Squash-merge that PR before generating the consumers. Resolve
the resulting commit from GitHub and verify it is on the default branch. For
the initial rollout (automation PR #1), run from the automation checkout:

```bash
git fetch origin master
revision="$(gh pr view 1 --repo joswayski/automation --json state,mergeCommit --jq 'select(.state == "MERGED") | .mergeCommit.oid')"
git merge-base --is-ancestor "$revision" origin/master
node scripts/listener.mjs joswayski/caper "$revision"
```

Use the relevant merged automation PR number for future rollouts, rather than
blindly adopting unrelated newer default-branch changes. Full commit pins stay
immutable; no mutable tag or merge-commit workflow is required.

Write that output to the app's `.github/workflows/amp-ci-repair.yml` on a feature
branch and submit a PR. Do not weaken or remove its fixed `amp-ci-repair`
concurrency group: check reservations rely on serialized execution in each repo.
The `queue: max` property preserves up to 100 pending events; it cannot be
combined with `cancel-in-progress: true`.

## References

- [Amp orb execution and unattended access tokens](https://ampcode.com/docs/cli/spawning-orbs)
- [Amp modes, model routing and Claude subscription requirements](https://ampcode.com/docs/the-dial)
- [Model provider routing and billing](https://ampcode.com/docs/customize/model-routing)
- [GitHub queued concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub commit directives for skipping PR CI](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)
- [GitHub CLI squash merges and head-SHA guards](https://cli.github.com/manual/gh_pr_merge)
