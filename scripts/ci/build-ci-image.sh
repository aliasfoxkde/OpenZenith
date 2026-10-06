#!/usr/bin/env bash
# Build AND publish the CI image for the aegis delta-gate job:
#   scripts/ci/build-ci-image.sh <tag>     e.g. scripts/ci/build-ci-image.sh 1
#
# Copies the aegis binary from the host (default ~/.local/bin/aegis,
# override with AEGIS_BIN=<path>) into a throwaway build context, builds
# scripts/ci/Dockerfile.aegis as openzenith-ci-aegis:<tag>, then tags and
# pushes it to the GitForge local OCI registry as
# localhost:5000/openzenith-ci-aegis:<tag> — the runner's hardened service
# context (User=gitforge, ProtectHome) cannot see a developer's local docker
# store, so the registry is the only distribution path. The registry must
# have the image BEFORE a push references the tag (see .gitforge.yml header).
#
# Verify against a real checkout afterwards (this is what CI executes):
#   docker run --rm -v "$PWD":/workspace:z -w /workspace \
#     localhost:5000/openzenith-ci-aegis:<tag> ./scripts/aegis_scan.sh
set -euo pipefail

TAG="${1:?usage: build-ci-image.sh <tag>}"
REGISTRY="${REGISTRY:-localhost:5000}"

# Resolve the script's repo root without assuming the caller's cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${AEGIS_BIN:-${HOME}/.local/bin/aegis}"
[[ -x "$BIN" ]] || { echo "aegis binary not found/executable: $BIN" >&2; exit 2; }

ctx="$(mktemp -d)"
cp "$BIN" "$ctx/aegis"
docker build -t "openzenith-ci-aegis:$TAG" -f "$REPO_ROOT/scripts/ci/Dockerfile.aegis" "$ctx"
rm "$ctx/aegis"
rmdir "$ctx"
docker tag "openzenith-ci-aegis:$TAG" "$REGISTRY/openzenith-ci-aegis:$TAG"
docker push "$REGISTRY/openzenith-ci-aegis:$TAG" > /dev/null
curl -fsS "$REGISTRY/v2/openzenith-ci-aegis/tags/list"
echo
docker image inspect "openzenith-ci-aegis:$TAG" --format 'built+pushed {{ $.RepoTags }}'
