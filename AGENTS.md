# Automation guidance

- Automatic CI repair is retired. Individual working threads own their CI
  failures; do not restore unattended launch or merge behavior without a new
  owner request.
- Preserve Git history, existing repair threads, PRs, issues and reservation
  checks. They may contain useful work; retirement does not mean a failure was fixed.
- Keep tokens out of files, diagnostics and prompts.
- Deliver focused, ready-for-review PRs; never push the default branch directly
  or merge without owner authorization. Do not run CI on PR branches.
- Every PR needs a numbered Deployment order section with exact operator
  commands where relevant, validation gaps and rollback steps.
- This repository has no runtime, dependencies or test suite. Validate edits
  with `git diff --check` and review documentation commands before publishing.
