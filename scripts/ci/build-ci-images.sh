#!/usr/bin/env bash
# Build, verify and publish the OpenZenith CI images for the rust-gates and
# python-gates jobs in .gitforge.yml.
#
#   scripts/ci/build-ci-images.sh [rust|python|both]     (default: both)
#
# Why the images exist at all: the runner resolves an image from the host
# daemon's local store before it pulls, has a hard 60 s sandbox-acquisition
# cap, and no reliable crates.io / PyPI egress from inside a job container.
# So the toolchain, the crate registry and the Python dependency set are
# baked into the image, and the job runs the gates offline.
#
# The two images are pinned to the toolchain and dependency set the coverage
# baselines were measured with:
#   * openzenith-ci-rust:1   — rust 1.97 (the channel core/rust-toolchain.toml
#     names), cargo-llvm-cov 0.9.1, the crate graph of the committed
#     core/Cargo.lock. Baseline: 99.25% lines (default features), 96.08%
#     (wasm features).
#   * openzenith-ci-python:1 — python 3.13 with the exact dependency set the
#     dev environment has, including the optional accelerators whose presence
#     decides which ImportError branch the coverage run sees. Baseline:
#     99.06% lines over 14,749 statements.
#
# Publication path (the one the aegis image already uses): build locally,
# stream the image to the runner host over ssh, load it into that host's
# daemon, then push it to the host's OCI registry so the runner's hardened
# service context can resolve it:
#
#   docker save openzenith-ci-rust:1 | ssh <runner> docker load
#   ssh <runner> 'docker tag openzenith-ci-rust:1 localhost:5001/openzenith-ci-rust:1'
#   ssh <runner> 'docker push localhost:5001/openzenith-ci-rust:1'
#
# The registry must hold the tag BEFORE a push that references it.
set -euo pipefail

WHICH="${1:-both}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${RUNNER:-fedora}"
REGISTRY="${REGISTRY:-localhost:5001}"

RUST_TAG="${RUST_TAG:-1}"
PYTHON_TAG="${PYTHON_TAG:-1}"

log() { printf '\n=== %s ===\n' "$*"; }

build_rust() {
  log "building openzenith-ci-rust:${RUST_TAG}"
  local ctx
  ctx="$(mktemp -d -t oz-ci-rust-XXXXXX)"
  mkdir -p "$ctx/core"
  cp "$REPO_ROOT/core/Cargo.toml" "$REPO_ROOT/core/Cargo.lock" \
     "$REPO_ROOT/core/rust-toolchain.toml" "$ctx/core/"
  cp -r "$REPO_ROOT/core/src" "$ctx/core/src"
  cp -r "$REPO_ROOT/core/tests" "$ctx/core/tests"
  docker build -t "openzenith-ci-rust:${RUST_TAG}" \
    -f "$REPO_ROOT/scripts/ci/Dockerfile.rust" "$ctx"
  find "$ctx" -depth -delete
}

build_python() {
  log "building openzenith-ci-python:${PYTHON_TAG}"
  # The python image carries no project source: the job materializes the
  # checkout it is testing. An empty context is all it needs.
  local ctx
  ctx="$(mktemp -d -t oz-ci-python-XXXXXX)"
  docker build -t "openzenith-ci-python:${PYTHON_TAG}" \
    -f "$REPO_ROOT/scripts/ci/Dockerfile.python" "$ctx"
  find "$ctx" -depth -delete
}

publish() {
  local name="$1" tag="$2"
  log "publishing ${name}:${tag} to ${RUNNER}"
  docker save "${name}:${tag}" | ssh "$RUNNER" docker load
  ssh "$RUNNER" "docker tag ${name}:${tag} ${REGISTRY}/${name}:${tag}"
  ssh "$RUNNER" "docker push ${REGISTRY}/${name}:${tag}"
  ssh "$RUNNER" "curl -fsS ${REGISTRY}/v2/${name}/tags/list"
  echo
}

case "$WHICH" in
  rust)
    build_rust
    publish openzenith-ci-rust "$RUST_TAG"
    ;;
  python)
    build_python
    publish openzenith-ci-python "$PYTHON_TAG"
    ;;
  both)
    build_rust
    build_python
    publish openzenith-ci-rust "$RUST_TAG"
    publish openzenith-ci-python "$PYTHON_TAG"
    ;;
  publish)
    # Publish-only: the images are already built locally (a rebuild is
    # unnecessary when only the runner's registry is out of date). The
    # argument after "publish" names which images to publish.
    case "${2:-both}" in
      rust)
        publish openzenith-ci-rust "$RUST_TAG"
        ;;
      python)
        publish openzenith-ci-python "$PYTHON_TAG"
        ;;
      both)
        publish openzenith-ci-rust "$RUST_TAG"
        publish openzenith-ci-python "$PYTHON_TAG"
        ;;
      *)
        echo "usage: $0 publish [rust|python|both]" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    echo "usage: $0 [rust|python|both|publish [rust|python|both]]" >&2
    exit 2
    ;;
esac

log "done"
