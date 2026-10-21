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

# The scanner binary to bake into the image.
#
# The default path is the one the scanner was originally installed at, but
# that path is NOT reliable: the unrelated `aegis-cli` PyPI package installs a
# console script named `aegis` to the same ~/.local/bin, and whichever was
# installed last wins. The two tools have incompatible CLIs — the scanner has
# a `scan` subcommand and a top-level `--format` flag, the starter-file
# generator has neither — so the binary is VERIFIED before it is baked, and
# a wrong one is not silently shipped into the CI image.
#
# When the host copy is missing or shadowed, the scanner is recovered from
# the last published image, which by construction contains the right binary.
SOURCE_IMAGE="${AEGIS_SOURCE_IMAGE:-localhost:5000/openzenith-ci-aegis:1}"

is_scanner() {
    [[ -x "$1" ]] && "$1" scan --help >/dev/null 2>&1
}

resolve_binary() {
    local candidate="${AEGIS_BIN:-${HOME}/.local/bin/aegis}"
    if is_scanner "$candidate"; then
        printf '%s' "$candidate"
        return 0
    fi
    echo "note: '$candidate' is not the aegis security scanner" >&2
    echo "      (an unrelated 'aegis-cli' package installs a console script" >&2
    echo "       of the same name); recovering it from ${SOURCE_IMAGE}" >&2
    local cid recovered
    recovered="$(mktemp -t aegis-recovered-XXXXXX)"
    cid="$(docker create "$SOURCE_IMAGE")"
    docker cp "$cid:/usr/local/bin/aegis" "$recovered" >/dev/null
    docker rm "$cid" >/dev/null
    chmod +x "$recovered"
    if ! is_scanner "$recovered"; then
        echo "recovered binary from $SOURCE_IMAGE is not the scanner either" >&2
        rm -f "$recovered"
        exit 2
    fi
    printf '%s' "$recovered"
}

BIN="$(resolve_binary)"

ctx="$(mktemp -d)"
cp "$BIN" "$ctx/aegis"
docker build -t "openzenith-ci-aegis:$TAG" -f "$REPO_ROOT/scripts/ci/Dockerfile.aegis" "$ctx"
rm "$ctx/aegis"
rmdir "$ctx"
# Clean up a recovered (temporary) copy; a user-supplied binary is left alone.
if [[ "$BIN" != "${AEGIS_BIN:-${HOME}/.local/bin/aegis}" ]]; then
    rm -f "$BIN"
fi
docker tag "openzenith-ci-aegis:$TAG" "$REGISTRY/openzenith-ci-aegis:$TAG"
docker push "$REGISTRY/openzenith-ci-aegis:$TAG" > /dev/null
curl -fsS "$REGISTRY/v2/openzenith-ci-aegis/tags/list"
echo
docker image inspect "openzenith-ci-aegis:$TAG" --format 'built+pushed {{ $.RepoTags }}'
