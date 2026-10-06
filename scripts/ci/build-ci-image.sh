#!/usr/bin/env bash
# Build the CI image for the aegis delta-gate job:
#   scripts/ci/build-ci-image.sh <tag>     e.g. scripts/ci/build-ci-image.sh 1
#
# Copies the aegis binary from the host (default ~/.local/bin/aegis,
# override with AEGIS_BIN=<path>) into a throwaway build context and builds
# scripts/ci/Dockerfile.aegis as openzenith-ci-aegis:<tag>. Runner-host
# infrastructure: the .gitforge.yml aegis job references the tag, so build
# and bump the tag BEFORE pushing a commit that references it (images must
# already exist on the runner host — see the .gitforge.yml header).
#
# Verify against a real checkout afterwards (this is what CI executes):
#   docker run --rm -v "$PWD":/workspace:z -w /workspace \
#     openzenith-ci-aegis:<tag> ./scripts/aegis_scan.sh
set -euo pipefail

TAG="${1:?usage: build-ci-image.sh <tag>}"

# Resolve the script's repo root without assuming the caller's cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${AEGIS_BIN:-${HOME}/.local/bin/aegis}"
[[ -x "$BIN" ]] || { echo "aegis binary not found/executable: $BIN" >&2; exit 2; }

ctx="$(mktemp -d)"
cp "$BIN" "$ctx/aegis"
docker build -t "openzenith-ci-aegis:$TAG" -f "$REPO_ROOT/scripts/ci/Dockerfile.aegis" "$ctx"
rm "$ctx/aegis"
rmdir "$ctx"
docker image inspect "openzenith-ci-aegis:$TAG" --format 'built {{ $.RepoTags }} ({{ .Size }})'
