#!/usr/bin/env bash
# Line-coverage gate for the Rust core crate (openzenith-core).
#
# Two measurements, both with a hard floor:
#
# 1. The default-feature workspace surface — lib, CLI binary, integration
#    tests and benches. This is the number recorded in docs/planning/ and the
#    one that ratchets upward only.
# 2. The `wasm` feature surface (`--lib --features wasm`). The WASM bindings
#    live behind `#[cfg(feature = "wasm")]`, not `#[cfg(target_arch =
#    "wasm32")]`, so they compile and run on the host and can be measured
#    here; building them into the default run would drag wasm-bindgen into
#    every consumer, so they get their own pass instead. Floor is separate
#    (WASM_COV_FLOOR) because `decode_ozt2` marshals `js_sys::Function` and
#    can only execute under wasm32 — those lines are exercised by
#    core/tests/wasm_decode_test.rs under `wasm-pack test --node`, not here.
#
# Baseline (2026-09-23, task #110): 78.81% lines (150/708 missed) before the
# par-variant, CLI error-path and edge-branch tests; 97.96% after (15/736
# missed — serde-derive internals and the unwritable-stdout guard in
# main.rs).
#
# Baseline (2026-10-04, task #179 coverage wave): 99.19% lines / 99.24%
# regions (default-feature workspace surface, same measurement this script
# makes). The stdout guard is now covered by the /dev/full write-failure
# test; the residual misses are closure instantiations (monomorphized serde
# derive copies plus one documented-unreachable serde fallback in
# error_exit) — line-level LCOV shows no zero-execution lines. Floor raised
# 95 -> 99 to match the project-wide 99% standard; if a toolchain update
# shifts serde expansion, re-measure and move the floor back up with the
# tests, or pin CORE_COV_FLOOR for a one-off churn window.
#
# Baseline (2026-10-07, Wave 6 — cutfill/dinf/solar + stream_order_wasm):
# default-feature pass 99.34% lines (12 missed), wasm-feature --lib pass
# 95.30% lines (91 missed, all in wasm.rs). The wasm floor is the measured
# value rounded down to the nearest integer (95), not aspirational: wasm.rs
# marshals `js_sys` closures for OZT2 decode that can only execute under
# wasm32, so roughly a quarter of that file is unrunnable here. Raise it only
# with tests that exercise more of the ABI on the host, never by lowering the
# bar to absorb a regression.
#
# Extra args are forwarded to the default-feature run only (e.g. --html for a
# report of the surface the ratchet tracks).
set -euo pipefail

FLOOR="${CORE_COV_FLOOR:-99}"
WASM_FLOOR="${WASM_COV_FLOOR:-95}"
CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../core" && pwd)"

cd "$CORE_DIR"

cargo llvm-cov --all --fail-under-lines "$FLOOR" "$@"

# Second pass over the feature-gated WASM bindings. --lib keeps the run to the
# library target: the integration tests are already covered above and
# assert_cmd's process plumbing is not rebuilt for this feature set.
cargo llvm-cov --lib --features wasm --fail-under-lines "$WASM_FLOOR"
