#!/usr/bin/env bash
# Test for resolve-vidimus-ref.sh using a throw-away local repo as the "remote".
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
git init -q "$tmp/vid" && cd "$tmp/vid"
git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git branch -M main && git branch feat/phase1

check() { # <expected> <env assignments...>
  local expected="$1"; shift
  local got; got="$(env "$@" "$here/resolve-vidimus-ref.sh")"
  [ "$got" = "$expected" ] || { echo "FAIL: expected '$expected', got '$got' ($*)"; exit 1; }
  echo "ok   $expected  ($*)"
}
U="VIDIMUS_REPO_URL=$tmp/vid"
check feat/phase1 "$U" BRANCH=feat/phase1          # same branch exists upstream -> use it
check main        "$U" BRANCH=feat/unknown         # no such branch -> main
check main        "$U" BRANCH=                      # empty -> main
check feat/phase1 "$U" BRANCH=main VIDIMUS_REF=feat/phase1   # explicit override wins
