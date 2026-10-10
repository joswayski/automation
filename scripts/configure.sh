#!/usr/bin/env bash
# Run locally with your own GitHub credentials. Never paste tokens into chat.
set -euo pipefail
set +x

if [[ $# != 1 ]]; then
  echo 'Usage: bash scripts/configure.sh <repository-name|--all>' >&2
  exit 2
fi

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
enrolled=()
while IFS= read -r repository; do enrolled+=("$repository"); done < <(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  for (const repo of Object.keys(JSON.parse(readFileSync(process.argv[1], "utf8")))) console.log(repo);
' "$root/src/repositories.json")
if [[ ${#enrolled[@]} == 0 ]]; then
  echo 'Could not load enrollment policy; check Node 24 is installed.' >&2
  exit 2
fi

if [[ "$1" == '--all' ]]; then
  repositories=("${enrolled[@]}")
else
  repository="joswayski/${1#joswayski/}"
  repositories=()
  for candidate in "${enrolled[@]}"; do
    if [[ "$candidate" == "$repository" ]]; then repositories+=("$candidate"); fi
  done
  if [[ ${#repositories[@]} != 1 ]]; then
    echo 'Repository is not enrolled.' >&2
    exit 2
  fi
fi

gh auth status
IFS= read -r -s -p 'Amp access token (hidden): ' token
printf '\n'
trap 'unset token' EXIT
if [[ "$token" != sgamp_* ]]; then
  echo 'Use an Amp Settings > Security access token, not a CLI session token.' >&2
  exit 2
fi

for repository in "${repositories[@]}"; do
  # Fail closed before changing credentials. This does not stop existing orbs.
  gh variable set AMP_REPAIR_ENABLED --repo "$repository" --body false
  gh variable set AMP_REPAIR_DRY_RUN --repo "$repository" --body true
  gh variable set AMP_REPAIR_DAILY_LIMIT --repo "$repository" --body 3
  printf '%s' "$token" | gh secret set AMP_API_KEY --repo "$repository"
  printf '%s: configured, disabled, dry-run selected.\n' "$repository"
done
