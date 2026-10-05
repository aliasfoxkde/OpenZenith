//! Integration tests for the `openzenith_core_cli` binary.
//!
//! Tests JSON I/O by piping input to stdin and checking stdout output.

// In integration tests an unwrap/expect failure IS the test failing.
#![allow(clippy::unwrap_used, clippy::expect_used)]
// Process-spawning tests are host-only; wasm-pack test --node compiles every
// test target for wasm32, where this file must become an empty crate.
#![cfg(not(target_arch = "wasm32"))]

use assert_cmd::assert::OutputAssertExt;
use assert_cmd::Command;
use serde_json::json;

#[test]
fn test_d8_command_valid_input() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768.0,
        "data": [100.0, 100.0, 100.0, 100.0, 200.0, 100.0, 100.0, 100.0, 100.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"rows\":3"))
        .stdout(predicates::str::contains("\"cols\":3"));
}

#[test]
fn test_d8_command_wrong_data_length() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768.0,
        "data": [100.0, 100.0] // wrong length
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length"));
}

#[test]
fn test_d8_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .write_stdin("not json{")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

#[test]
fn test_accum_command_valid_input() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -1,
        "data": [0, 1, 2, 7, -1, 3, 6, 5, 4]  // D8 flow directions
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("accum")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"rows\":3"))
        .stdout(predicates::str::contains("\"cols\":3"));
}

#[test]
fn test_accum_command_wrong_data_length() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -1,
        "data": [0, 1] // wrong length
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("accum")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length"));
}

#[test]
fn test_viewshed_command_valid_input() {
    let input = json!({
        "rows": 5,
        "cols": 5,
        "observer_row": 2,
        "observer_col": 2,
        "observer_height": 1.8,
        "cell_size": 30.0,
        "nodata": -32768.0,
        "data": vec![100.0; 25]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("viewshed")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"rows\":5"))
        .stdout(predicates::str::contains("\"cols\":5"));
}

#[test]
fn test_stream_order_command_valid_input() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata_dir": -1,
        "streams": [0, 0, 0, 0, 1, 0, 0, 0, 0],  // center is a stream
        "flow_dir": [4, 0, 4, 4, 0, 4, 4, 4, 4]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("stream-order")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"rows\":3"))
        .stdout(predicates::str::contains("\"cols\":3"));
}

#[test]
fn test_gradient_predict_command_valid_input() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768.0,
        "data": [100.0, 150.0, 200.0, 110.0, 160.0, 210.0, 120.0, 170.0, 220.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("gradient-predict")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .unwrap()
        .assert()
        .success()
        .stdout(predicates::str::contains("\"rows\":3"))
        .stdout(predicates::str::contains("\"cols\":3"));
}

#[test]
fn test_gradient_reconstruct_command_valid_input() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768,
        "dequant_min": 0.0,
        "dequant_scale": 0.1,
        "data": [100i16, 150, 200, 110, 160, 210, 120, 170, 220]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("reconstruct")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"rows\":3"))
        .stdout(predicates::str::contains("\"cols\":3"));
}

#[test]
fn test_unknown_command() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("unknown-cmd")
        .assert()
        .failure()
        .stderr(predicates::str::contains("unknown command"));
}

#[test]
fn test_no_command_shows_usage() {
    // When no args provided, shows usage to stderr and exits with 1
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .assert()
        .failure()
        .stderr(predicates::str::contains("Usage:"));
}

#[test]
fn test_d8_with_nodata_cells() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768.0,
        "data": [-32768.0, 100.0, 100.0, 100.0, 200.0, 100.0, 100.0, 100.0, 100.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success();
}

#[test]
fn test_viewshed_with_max_distance() {
    let input = json!({
        "rows": 10,
        "cols": 10,
        "observer_row": 5,
        "observer_col": 5,
        "observer_height": 10.0,
        "cell_size": 30.0,
        "nodata": -32768.0,
        "max_distance_cells": 5,
        "data": vec![100.0; 100]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("viewshed")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success();
}

// ─── Error paths (every command validates JSON and array length) ─────────────

#[test]
fn test_accum_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("accum")
        .write_stdin("{\"rows\":3,")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

#[test]
fn test_reconstruct_command_wrong_data_length() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768,
        "dequant_min": 0.0,
        "dequant_scale": 0.1,
        "data": [1i16, 2] // wrong length
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("reconstruct")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length"));
}

#[test]
fn test_reconstruct_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("reconstruct")
        .write_stdin("]}")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

#[test]
fn test_viewshed_command_wrong_data_length() {
    let input = json!({
        "rows": 5,
        "cols": 5,
        "observer_row": 2,
        "observer_col": 2,
        "observer_height": 1.8,
        "cell_size": 30.0,
        "nodata": -32768.0,
        "data": vec![100.0; 7] // wrong length
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("viewshed")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length"));
}

#[test]
fn test_viewshed_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("viewshed")
        .write_stdin("{broken")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

#[test]
fn test_stream_order_command_streams_length_mismatch() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "streams": [0, 1], // wrong length
        "flow_dir": [4, 0, 4, 4, 0, 4, 4, 4, 4]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("stream-order")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("streams length"));
}

#[test]
fn test_stream_order_command_flow_dir_length_mismatch() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "streams": [0, 0, 0, 0, 1, 0, 0, 0, 0],
        "flow_dir": [0, 0] // wrong length
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("stream-order")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("flow_dir length"));
}

#[test]
fn test_stream_order_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("stream-order")
        .write_stdin("nope{")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

#[test]
fn test_stream_order_default_nodata_dir_confluence() {
    // nodata_dir omitted → serde default (-1) applies and Strahler orders
    // propagate: two order-1 headwaters ((0,0) via E then S, (2,0) via NE)
    // converge on (1,1) → order 2. Expected row-major: [1,1,0,0,2,0,1,0,0].
    let input = json!({
        "rows": 3,
        "cols": 3,
        "streams": [1, 1, 0, 0, 1, 0, 1, 0, 0],
        "flow_dir": [0, 2, -1, -1, -1, -1, 7, -1, -1]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("stream-order")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"data\":[1,1,0,0,2,0,1,0,0]"));
}

#[test]
fn test_gradient_predict_command_wrong_data_length() {
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768.0,
        "data": [100.0] // wrong length
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("gradient-predict")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length"));
}

#[test]
fn test_gradient_predict_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("gradient-predict")
        .write_stdin("[[[")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

#[test]
fn test_non_utf8_stdin_fails_cleanly() {
    // stdin that is not valid UTF-8 must produce the JSON error shape, not a
    // panic — read_to_string fails before any command dispatch.
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .write_stdin(vec![0xff, 0xfe, 0x00])
        .assert()
        .failure()
        .stderr(predicates::str::contains("failed to read stdin"));
}

// ─── Dimension overflow (rows*cols must not overflow usize) ──────────────────

#[test]
fn test_d8_rows_cols_overflow_is_rejected_not_panicked() {
    // rows*cols = usize::MAX * 2 overflows. The product is computed with
    // checked_mul, so this is a JSON error with exit code 1 — previously it
    // aborted with a "multiply with overflow" panic (exit 101).
    let input = json!({
        "rows": 18_446_744_073_709_551_615u64,
        "cols": 2,
        "nodata": -32768.0,
        "data": [100.0, 200.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .code(1)
        .stderr(predicates::str::contains("overflows usize"));
}

#[test]
fn test_stream_order_rows_cols_overflow_is_rejected_not_panicked() {
    // Same overflow guard on the two-array command: absurd dimensions must be
    // rejected before either array is shaped.
    let input = json!({
        "rows": 4_294_967_296u64,
        "cols": 4_294_967_296u64,
        "streams": [0i8, 1],
        "flow_dir": [0i8, 1]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("stream-order")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .code(1)
        .stderr(predicates::str::contains("overflows usize"));
}

#[test]
fn test_d8_data_length_mismatch_message_is_preserved() {
    // Shaping now goes through ndarray directly, but the caller-facing message
    // (and therefore the existing "data length" contract) is unchanged.
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "data": [100.0, 200.0, 300.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length 3 != rows*cols 2*2"));
}

// ─── stdout write failure (main's last error path) ───────────────────────────

#[test]
fn test_stdout_write_failure_reports_error() {
    // /dev/full accepts open(2) but fails every write(2) with ENOSPC — the
    // only portable way to make the binary's final write_all fail and reach
    // the error_exit("failed to write stdout") arm that no stdin-side fault
    // can reach. std::process::Command here because assert_cmd's wrapper
    // offers no Stdio redirection.
    use assert_cmd::cargo::CommandCargoExt;
    use std::io::Write;
    use std::process::{Command, Stdio};

    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "data": [100.0, 100.0, 100.0, 100.0]
    });

    let dev_full = std::fs::File::create("/dev/full").unwrap();
    let mut child = Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("d8")
        .stdin(Stdio::piped())
        .stdout(dev_full)
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(serde_json::to_string(&input).unwrap().as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();

    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("failed to write stdout"),
        "stderr was: {stderr}"
    );
}
