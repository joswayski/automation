# Rollout and recovery

## Prerequisites

An operator needs GitHub CLI access that can manage Actions secrets and variables
on the eight enrolled repositories. The orb's GitHub integration may push code
and create PRs without having that administrative access. GitHub Issues must be
enabled (all eight had Issues enabled when enrollment was prepared), and the
repository's Actions policy must allow `joswayski/automation` and Issues write
permission for the caller token.

All eight exact Amp projects already existed when the enrollment was prepared.
Check their repository access, secrets, guidance and orb setup. In particular,
the repair orb needs permission to read private Actions logs, push a branch,
create a PR and update its tracking issue. The listener's `GITHUB_TOKEN` is **not**
forwarded to the orb and cannot provide that access.

Create an access token at https://ampcode.com/settings/security. Keep it out of
chat, Git, command-line arguments and screenshots. Amp documents `sgamp_` access
tokens for unattended CLI use; short-lived login/session tokens will not work.

## Deployment order

1. Merge the automation implementation PR first. This new repository initially
   uses `master`; no branch rename is required. No infrastructure provisioning,
   OpenTofu apply, secrets migration, database migration, or application/client
   release is needed.
2. Merge the eight listener PRs only after their pinned action commit has been
   reviewed and is available in this public repository. A merge commit preserves
   the pin's ancestry. If squashing/rebasing the automation PR, regenerate the
   listeners with the final reviewed commit first. Do not merge references to
   an unreviewed implementation. The app listeners can then merge independently.
   They remain disabled without the enable variable. For PR commits using
   `[skip ci]`, **remove that directive from the final merge/squash message** so
   default-branch checks are not inadvertently skipped.
3. On your own machine, clone the automation repository and configure the token
   privately. These commands require Bash and Node 24. From the repository root:

   ```bash
   gh auth status
   bash scripts/configure.sh --all
   ```

   The script prompts for the token once without echoing it, stores the same
   token as `AMP_API_KEY` in each enrolled repository, sets the rolling limit to
   three, selects dry-run mode, and **leaves repairs disabled**. If a command
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

   A subsequent eligible completion should produce `would-launch` in the
   listener's Actions summary. No issue or orb should be created. The listener
   does not backfill old failures, and it does not launch on ordinary
   cancellations, successful runs, or superseded pushes. Do not deliberately
   break production or start PR CI to test it.

5. Enable one real Caper repair only after reviewing dry-run behavior:

   ```bash
   gh variable set AMP_REPAIR_DRY_RUN --repo joswayski/caper --body false
   gh run list --repo joswayski/caper --workflow 'Amp CI repair' --limit 5
   gh issue list --repo joswayski/caper --label amp-ci-repair --state all
   ```

   On the next eligible failure, verify one tracking issue, one linked Amp
   thread in the `josevalerio/caper` project, and either a fix PR or a clear
   diagnosis. This is the live integration check; mocked tests are not a
   substitute. Repair PRs get local validation, not manually dispatched CI.

6. After the pilot works, enable the other enrolled repositories independently:

   ```bash
   for repo in captures dbm findanything creditcardhoroscope josevalerio.com godis infrastructure; do
     gh variable set AMP_REPAIR_DRY_RUN --repo "joswayski/$repo" --body false
     gh variable set AMP_REPAIR_ENABLED --repo "joswayski/$repo" --body true
   done
   ```

   This enables future launches and their normal Amp/orb charges. It does not
   deploy apps or retroactively investigate failures. The cap applies per repo,
   not globally; eight repositories at the default cap can reserve 24 attempts
   over a rolling day. No automatic dollar budget is enforced.

## How tracking issues work

The `amp-ci-repair` label and hidden body marker form the durable ledger.
Keep them intact and never delete tracking issues to reset an attempt. Only
issues created by `github-actions[bot]` are treated as automatic reservations.
Use the generated listener with `github.token`, not a PAT.

An open tracking issue blocks new automatic repairs in its repository. A fix
PR references the issue with `Fixes`, so merging closes it. If the outcome is
an infrastructure outage, missing credential, unverified fix, or other blocker,
the agent leaves a diagnosis and keeps the issue open for a human. Close it
after resolving/reviewing the blocker **and confirming that its orb is no longer
working**. Closing an issue does not cancel an orb or permit another automated
attempt for the same commit/run. An open repair PR also blocks new launches.

If launch status is `reserved` or `launch unconfirmed`, a CLI timeout or lost
response may still have created the orb. Search Amp for the `CI repair:` title
and failure commit/run, then continue that thread manually. Do not blindly rerun
or remove the ledger marker. If no thread was created, a human can start a
repair manually and link it; automated retry is intentionally unavailable.

The source run must have an actual failed/timed-out job or a failed step in a
cancelled job. A workflow rejected before it can create jobs will be skipped;
check its workflow validation error manually. Workflow names/files/events are
an allowlist, so renaming or adding a workflow needs a policy/listener update.

You can evaluate a real run locally without enabling a listener, writing an
issue, installing Amp, or paying for an orb. For example, this historical Caper
run was cancelled without any failed jobs:

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
Inspect active `Amp CI repair` runs and their issues; cancel a pending/running
listener in GitHub if necessary. **An orb already launched keeps running after
its Actions job ends or is cancelled**; stop it separately in Amp. Disable does
not close issues, merge PRs, or roll back applications. Revoke a compromised
Amp access token in Amp Settings; deleting its GitHub secret alone does not
revoke the token. Rotate the token with the configuration script when ready.

To roll back the implementation, keep repairs disabled and open PRs restoring
the previous reviewed full action SHA. Do not move a release tag to silently
change consumers. Preserve the reservation ledger across upgrades/rollbacks.

## Adding a repo or updating the action

Change the enrollment policy and tests in an automation PR. Review which events
are trusted; do not accept a project name or prompt supplied by a webhook or
commit message. Pin listeners to the full reviewed commit, generated with:

```bash
git fetch origin
revision="$(git rev-parse origin/master)"
node scripts/listener.mjs joswayski/caper "$revision"
```

Write that output to the app's `.github/workflows/amp-ci-repair.yml` on a feature
branch and submit a PR. Do not weaken or remove its fixed `amp-ci-repair`
concurrency group: issue reservations rely on serialized execution in each repo.
The `queue: max` property preserves up to 100 pending events; it cannot be
combined with `cancel-in-progress: true`.

## References

- [Amp orb execution and unattended access tokens](https://ampcode.com/docs/cli/spawning-orbs)
- [GitHub queued concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [GitHub commit directives for skipping PR CI](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)
