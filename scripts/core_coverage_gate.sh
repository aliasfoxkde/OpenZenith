#!/usr/bin/env bash
# Line-coverage gate for the Rust core crate (openzenith-core).
#
# Measures workspace coverage with cargo-llvm-cov and enforces a hard floor.
# The floor ratchets upward only: raise CORE_COV_FLOOR (default below)
# together with the tests that cover the delta, and record the measurement
# in docs/planning/ (see docs/planning/MASTER_PLAN_2026-09-22.md).
#
# Baseline (2026-09-23, task #110): 78.81% lines (150/708 missed) before the
# par-variant, CLI error-path and edge-branch tests; 97.96% after (15/736
# missed — serde-derive internals and the unwritable-stdout guard in
# main.rs). Floor set to 95 to leave headroom for toolchain/serde churn.
#
# Extra args are forwarded to cargo llvm-cov (e.g. --html for a report).
set -euo pipefail

FLOOR="${CORE_COV_FLOOR:-95}"
CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../core" && pwd)"

cd "$CORE_DIR"
exec cargo llvm-cov --all --fail-under-lines "$FLOOR" "$@"
