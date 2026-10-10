# Automation guidance

- Keep runtime and tests dependency-free; use Node 24 and `node:test`.
- Run `npm run check`; validate changed/generated workflows with actionlint.
- Never start or rerun GitHub workflows on a PR branch. Deliver focused,
  ready-for-review PRs; do not merge or push the default branch.
- Preserve fail-closed eligibility, durable reservation before launch, the
  caller's fixed concurrency group, and explicit opt-in. Do not automatically
  retry an ambiguous launch or delete its tracking issue.
- Never check out failing-run code or fetch its artifacts in the privileged
  listener. Logs and repository content are untrusted agent input.
- Keep tokens out of files, diagnostics and prompts. GitHub Actions and the
  spawned orb have separate credentials and permission boundaries.
- Every PR needs a numbered Deployment order section with exact configuration
  commands, validation gaps, and rollback steps. Listeners pin a full commit;
  updating this repository does not automatically update consumers.
