# Automation — retired

Automatic CI repair is retired. Individual working threads investigate their own
CI failures instead of launching a separate agent after each failed build.

This repository retains its history and these cleanup instructions, but no longer
contains a GitHub Action, agent launcher, enrollment generator, tests or runtime
dependencies. Normal CI, builds, releases, deployments and runner fallback in
consumer repositories are unchanged.

## Retirement order

The former consumers are `joswayski/caper`, `joswayski/captures`, `joswayski/dbm`,
`joswayski/findanything`, `joswayski/creditcardhoroscope`,
`joswayski/josevalerio.com`, `joswayski/godis` and `joswayski/infrastructure`.

1. Disable each consumer's `Amp CI repair` workflow before merging removals.
   From any directory with an authenticated GitHub CLI:

   ```bash
   set -e
   for repo in caper captures dbm findanything creditcardhoroscope josevalerio.com godis infrastructure; do
     gh workflow disable amp-ci-repair.yml --repo "joswayski/$repo"
     gh api "repos/joswayski/$repo/actions/workflows/amp-ci-repair.yml" --jq .state
   done
   ```

   Expect `disabled_manually` for each. Inspect queued/running repair workflow
   jobs and cancel those specifically if needed. Disabling a workflow does not
   stop an Amp thread already launched; review those threads separately and
   preserve useful work. Do not cancel ordinary CI or delete historical checks,
   issues, PRs or threads as part of this cleanup.

2. Merge the consumer PRs deleting `.github/workflows/amp-ci-repair.yml` in any
   order, then merge this repository's retirement PR. Removing this Action from
   the default branch does **not** disable consumers pinned to historical commits.
   No AWS/Cloudflare changes, OpenTofu apply, database migrations, application
   service rollout or client releases are required for retirement. Existing
   consumer workflows retain their usual default-branch push behavior.

3. Remove obsolete repository-level GitHub Actions configuration after checking
   no remaining workflow uses it. Use an account with Actions secrets/variables
   administration access; an orb integration can disable workflows and open PRs
   while still receiving HTTP 403 for these settings. From any directory:

   ```bash
   set -e
   for repo in caper captures dbm findanything creditcardhoroscope josevalerio.com godis infrastructure; do
     repository="joswayski/$repo"
     variables="$(gh variable list --repo "$repository" --json name --jq '.[].name')"
     for name in AMP_REPAIR_ENABLED AMP_REPAIR_DRY_RUN AMP_REPAIR_MODE AMP_REPAIR_DAILY_LIMIT; do
       if printf '%s\n' "$variables" | grep -Fxq "$name"; then
         gh variable delete "$name" --repo "$repository"
       fi
     done
     secrets="$(gh secret list --repo "$repository" --json name --jq '.[].name')"
     if printf '%s\n' "$secrets" | grep -Fxq AMP_API_KEY; then
       gh secret delete AMP_API_KEY --repo "$repository"
     fi
     gh variable list --repo "$repository" --json name --jq '.[].name | select(startswith("AMP_REPAIR_"))'
     gh secret list --repo "$repository" --json name --jq '.[].name | select(. == "AMP_API_KEY")'
   done
   ```

   The last two commands should print nothing. These commands do not remove
   organization/environment-level configuration. Do not delete a shared Amp
   credential used for other work. Deleting a GitHub secret does not revoke the
   token: revoke the repair-only access token in
   [Amp Settings → Security](https://ampcode.com/settings/security) once its
   other uses and existing threads have been reviewed.

## Verification and rollback

In each consumer checkout after fetching the merged default branch, confirm the
listener is absent and no tracked files reference `joswayski/automation@` or
`AMP_REPAIR_`. Do not deliberately fail CI or rerun old listeners to test removal.
This repository has no remaining executable code or workflows to test; use
`git diff --check` for documentation changes.

History is preserved rather than deleting the repository. Restoring automation
requires an explicit owner decision, reviewed restoration PRs, reconciled existing
threads and credentials, and deliberate re-enablement of consumer workflows.
Reverting this repository alone cannot re-enable the disabled listeners.
