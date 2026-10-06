#!/usr/bin/env bash
# Print the git ref of the vidimus library to test against:
#   1. $VIDIMUS_REF if set (explicit override),
#   2. else the branch currently being built ($BRANCH) if vidimus has a branch of that name,
#   3. else main.
set -euo pipefail
repo="${VIDIMUS_REPO_URL:-https://github.com/kabNath/vidimus.git}"
if [ -n "${VIDIMUS_REF:-}" ]; then echo "$VIDIMUS_REF"; exit 0; fi
if [ -n "${BRANCH:-}" ] && git ls-remote --exit-code --heads "$repo" "$BRANCH" >/dev/null 2>&1; then
  echo "$BRANCH"
else
  echo main
fi
