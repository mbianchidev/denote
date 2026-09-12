#!/usr/bin/env bash

set -euo pipefail

readonly RELEASE_FILES=(
  package.json
  package-lock.json
  src-tauri/Cargo.toml
  src-tauri/Cargo.lock
  src-tauri/tauri.conf.json
  plugins/catalog.json
)

fail() {
  printf 'Release failed: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  fail "usage: scripts/release.sh <version-or-v-prefixed-tag>"
fi

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" ||
  fail "cannot resolve the script directory"
readonly SCRIPT_DIRECTORY

REPOSITORY_ROOT="$(
  git -C "${SCRIPT_DIRECTORY}/.." rev-parse --show-toplevel 2>/dev/null
)" || fail "run this script from the Denote repository"
readonly REPOSITORY_ROOT
cd "$REPOSITORY_ROOT"

VERSION="$(
  node --input-type=module -e '
    import { normalizeVersion } from "./scripts/release.mjs";

    try {
      process.stdout.write(normalizeVersion(process.argv[1]));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  ' "$1"
)" || fail "invalid release version"
readonly VERSION
readonly TAG="v${VERSION}"

[[ "$(git branch --show-current)" == "main" ]] ||
  fail "run this script from the main branch"
[[ -z "$(git status --porcelain)" ]] ||
  fail "main must have no staged, unstaged, or untracked changes"

git switch main
git fetch origin
git merge --ff-only origin/main

[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] ||
  fail "main contains commits that are not on origin/main"
[[ -z "$(git status --porcelain)" ]] ||
  fail "main must remain clean after updating from origin/main"

if git rev-parse --verify --quiet "refs/tags/${TAG}" >/dev/null; then
  fail "local tag ${TAG} already exists"
fi

REMOTE_TAG="$(git ls-remote --tags origin "refs/tags/${TAG}")"
readonly REMOTE_TAG
[[ -z "$REMOTE_TAG" ]] || fail "remote tag ${TAG} already exists"

node scripts/updater-release.mjs status
node scripts/preinstall-validate-plugins.mjs
npm ci --ignore-scripts

npm run release -- "$VERSION"
npm run release -- --check "$TAG"

npm run check:plugin-archives -- --base "$(git rev-parse origin/main)"
npm test
npm run check:plugins
npm run package:plugins
npm run prepare:bundled-tools
npm run verify:bundled-tools
npm run build
npm run test:website
npm run build:website
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml

git diff --cached --quiet ||
  fail "release validation unexpectedly staged files"
[[ -z "$(git ls-files --others --exclude-standard)" ]] ||
  fail "release validation created untracked files"

while IFS= read -r changed_file; do
  allowed=false
  for release_file in "${RELEASE_FILES[@]}"; do
    if [[ "$changed_file" == "$release_file" ]]; then
      allowed=true
      break
    fi
  done
  [[ "$allowed" == true ]] ||
    fail "release validation changed unexpected file ${changed_file}"
done < <(git diff --name-only)

git diff --quiet -- "${RELEASE_FILES[@]}" &&
  fail "release ${TAG} produced no version changes"

git add \
  package.json package-lock.json \
  src-tauri/Cargo.toml src-tauri/Cargo.lock \
  src-tauri/tauri.conf.json plugins/catalog.json

git diff --quiet ||
  fail "release files remain unstaged"
git diff --cached --quiet &&
  fail "release ${TAG} produced no staged changes"

git commit --no-gpg-sign -m "Release ${TAG}"

[[ -z "$(git status --porcelain)" ]] ||
  fail "working tree is not clean after the release commit"

git push origin main

git tag "$TAG"
git push origin "$TAG"
