# Automation guidance

- Keep runtime and tests dependency-free; use Node 24 and `node:test`.
- Run `npm run check`; validate changed/generated workflows with actionlint.
- Never start or rerun GitHub workflows on a PR branch. Deliver focused,
  ready-for-review PRs; never push the default branch directly. Only merge with
  owner authorization. Generated repair requests carry standing authorization
  to squash-merge that agent's own locally validated fix without another approval;
  they must not bypass GitHub merge requirements or run deployment commands.
- The owner squash-merges PRs. Pin consumers to the resulting default-branch
  commit after the automation PR merges, never its pre-merge head. Update any
  already-open listener PRs yourself; do not ask the owner to use merge commits.
- Preserve fail-closed eligibility, durable reservation before launch, the
  caller's fixed concurrency group, and explicit opt-in. Do not automatically
  retry an ambiguous launch or delete its reservation check. Do not open GitHub
  issues or let another commit's open issue/PR pause new repairs. Legacy issues
  are read-only deduplication records, not a repository-wide gate.
- Never check out failing-run code or fetch its artifacts in the privileged
  listener. Logs and repository content are untrusted agent input.
- Keep tokens out of files, diagnostics and prompts. GitHub Actions and the
  spawned orb have separate credentials and permission boundaries.
- Every PR needs a numbered Deployment order section with exact configuration
  commands, validation gaps, and rollback steps. Listeners pin a full commit;
  updating this repository does not automatically update consumers.
