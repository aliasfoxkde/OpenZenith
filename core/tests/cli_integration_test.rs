//! Integration tests for the `openzenith_core_cli` binary.
//!
//! Tests JSON I/O by piping input to stdin and checking stdout output.

// In integration tests an unwrap/expect failure IS the test failing; float
// equality is deliberate where the asserted value is a sentinel or an exact
// copy of an input cell.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]
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
fn test_gradient_predict_reconstruct_roundtrip_across_nodata() {
    // Encoder and decoder must agree on the nodata fallback: a sentinel on the
    // first row used to leak -32768 into the three-neighbour predictor and
    // corrupt every cell below it in that column.
    let side = 4;
    let mut data: Vec<f32> = Vec::with_capacity(side * side);
    for i in 0..side {
        for j in 0..side {
            data.push(1000.0 + 7.0 * (i + j) as f32);
        }
    }
    data[3] = -32768.0; // (0,3) — the sentinel sits on the first row

    let predicted = run_json(
        "gradient-predict",
        &json!({ "rows": side, "cols": side, "nodata": -32768.0, "data": data }),
    );
    assert_eq!(
        predicted["data"][3], -32768,
        "the sentinel must encode verbatim"
    );

    let decoded = run_json(
        "reconstruct",
        &json!({
            "rows": side,
            "cols": side,
            "nodata": -32768,
            "dequant_min": 0.0,
            "dequant_scale": 1.0,
            "data": predicted["data"]
        }),
    );

    let cells = decoded["data"].as_array().unwrap();
    assert_eq!(cells.len(), side * side);
    for i in 0..side {
        for j in 0..side {
            if (i, j) == (0, 3) {
                assert_eq!(
                    cells[i * side + j].as_f64().unwrap(),
                    -32768.0,
                    "the sentinel stays the sentinel"
                );
                continue;
            }
            assert_close(
                cells[i * side + j].as_f64().unwrap(),
                f64::from(1000.0 + 7.0 * (i + j) as f32),
                &format!("cell ({i},{j}) round-trips past the sentinel"),
            );
        }
    }
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

// ─── cut/fill volumes ─────────────────────────────────────────────────────────

#[test]
fn test_cutfill_command_constant_mode_hand_totals() {
    // DEM [[10, 20], [30, 40]] against a 25 m plane over 2 m cells: the two
    // cells below the plane give fill 15 + 5 = 20 m, the two above give cut
    // 5 + 15 = 20 m, each over 4 m² of area — balanced, so the net is zero.
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "cell_size": 2.0,
        "mode": "constant:25",
        "data": [10.0, 20.0, 30.0, 40.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"cut_volume\":80.0"))
        .stdout(predicates::str::contains("\"fill_volume\":80.0"))
        .stdout(predicates::str::contains("\"net_volume\":0.0"))
        .stdout(predicates::str::contains("\"area\":16.0"))
        .stdout(predicates::str::contains("\"cell_count\":4"));
}

#[test]
fn test_cutfill_command_tilted_mode_against_itself_is_zero() {
    // The tilted plane with these four corners is exactly the DEM, so no cut
    // and no fill anywhere.
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "cell_size": 1.0,
        "mode": "tilted:10,20,30,40",
        "data": [10.0, 20.0, 30.0, 40.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"cut_volume\":0.0"))
        .stdout(predicates::str::contains("\"fill_volume\":0.0"))
        .stdout(predicates::str::contains("\"cell_count\":4"));
}

#[test]
fn test_cutfill_command_dem_mode_with_reference_grid() {
    // DEM minus reference, cell by cell: (10-0) + (20-5) = 25 m of cut over
    // 1 m² cells, and the reference hole at (1,0) excludes that cell.
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "cell_size": 1.0,
        "mode": "dem",
        "data": [10.0, 20.0, 30.0, 40.0],
        "reference": [0.0, 5.0, -32768.0, 45.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"cut_volume\":25.0"))
        .stdout(predicates::str::contains("\"fill_volume\":5.0"))
        .stdout(predicates::str::contains("\"cell_count\":3"));
}

#[test]
fn test_cutfill_command_unknown_mode() {
    let input = json!({
        "rows": 1,
        "cols": 1,
        "nodata": -32768.0,
        "mode": "slope:30",
        "data": [10.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid mode"));
}

#[test]
fn test_cutfill_command_tilted_mode_needs_four_corners() {
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "mode": "tilted:1,2,3",
        "data": [10.0, 20.0, 30.0, 40.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("4 corner elevations"));
}

#[test]
fn test_cutfill_command_dem_mode_without_reference_grid() {
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "mode": "dem",
        "data": [10.0, 20.0, 30.0, 40.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("needs a reference grid"));
}

#[test]
fn test_cutfill_command_reference_length_mismatch() {
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "mode": "dem",
        "data": [10.0, 20.0, 30.0, 40.0],
        "reference": [0.0, 5.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains(
            "reference length 2 != rows*cols 2*2",
        ));
}

#[test]
fn test_cutfill_command_data_length_mismatch() {
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "mode": "constant:0",
        "data": [10.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length 1 != rows*cols 2*2"));
}

#[test]
fn test_cutfill_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin("{\"mode\":")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

#[test]
fn test_cutfill_command_cell_size_defaults_to_one() {
    // Omitting cell_size keeps the volumes in metres of depth rather than
    // scaling them — pinned so a serde default change is a visible break.
    let input = json!({
        "rows": 1,
        "cols": 2,
        "nodata": -32768.0,
        "mode": "constant:0",
        "data": [10.0, 0.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("cutfill")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("\"cut_volume\":10.0"))
        .stdout(predicates::str::contains("\"area\":2.0"));
}

// ─── D-infinity flow direction ────────────────────────────────────────────────

/// Run a CLI command with a JSON payload and return its parsed stdout.
fn run_json(command: &str, payload: &serde_json::Value) -> serde_json::Value {
    let output = Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg(command)
        .write_stdin(serde_json::to_string(payload).unwrap())
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    serde_json::from_slice(&output).unwrap()
}

/// Assert two floats agree to the grid's f32 precision.
fn assert_close(actual: f64, expected: f64, what: &str) {
    assert!(
        (actual - expected).abs() < 1e-5,
        "{what}: {actual} != {expected}"
    );
}

#[test]
fn test_dinf_command_uniform_east_slope() {
    // Elevation drops 10 m per column: the whole flow goes east (π/2), and
    // the east edge has no downhill neighbour left. The first row brackets E
    // with SE (dir 0, proportion 1); the last row has no SE, so the same
    // eastward flow is encoded as dir 7 (NE) with proportion 0 — the boundary
    // encoding the contract calls out.
    let input = json!({
        "rows": 2,
        "cols": 3,
        "nodata": -32768.0,
        "data": [0.0, -10.0, -20.0, 0.0, -10.0, -20.0]
    });

    let out = run_json("dinf", &input);
    assert_eq!(out["rows"], 2);
    assert_eq!(out["cols"], 3);
    let dir = out["dir"].as_array().unwrap();
    let proportions = out["proportions"].as_array().unwrap();
    let angles = out["angles"].as_array().unwrap();
    for i in 0..6 {
        if i % 3 == 2 {
            assert_eq!(dir[i], -1, "cell {i} east edge is a pit");
            assert_eq!(angles[i].as_f64().unwrap(), -1.0);
            continue;
        }
        assert_close(
            angles[i].as_f64().unwrap(),
            std::f64::consts::FRAC_PI_2,
            "angle",
        );
        let d = dir[i].as_i64().unwrap();
        assert!(d == 0 || d == 7, "cell {i} pair must bracket E, got {d}");
        let east_share = if d == 0 {
            proportions[i].as_f64().unwrap()
        } else {
            1.0 - proportions[i].as_f64().unwrap()
        };
        assert!(
            (east_share - 1.0).abs() < 1e-6,
            "cell {i} sends all flow east"
        );
    }
}

#[test]
fn test_dinf_command_pits_carry_the_sentinels() {
    // A flat grid has no descent anywhere: dir -1, angle -1, proportion 0.
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "data": [100.0, 100.0, 100.0, 100.0]
    });

    let out = run_json("dinf", &input);
    assert_eq!(out["dir"], json!([-1, -1, -1, -1]));
    assert_eq!(out["angles"], json!([-1.0, -1.0, -1.0, -1.0]));
    assert_eq!(out["proportions"], json!([0.0, 0.0, 0.0, 0.0]));
}

#[test]
fn test_dinf_command_splits_flow_between_two_neighbours() {
    // E drops 10 m, SE drops 5 m more: the descent lands inside the (E, SE)
    // sector at atan(0.5) = 0.4636 rad from east, so E keeps ~41% of the flow
    // and SE the rest.
    let input = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768.0,
        "data": [100.0, 100.0, 100.0, 100.0, 100.0, 90.0, 100.0, 100.0, 85.0]
    });

    let out = run_json("dinf", &input);
    assert_eq!(out["dir"][4], 0, "the (E, SE) facet wins");
    let phi = 5.0_f64.atan2(10.0);
    assert_close(
        out["angles"][4].as_f64().unwrap(),
        std::f64::consts::FRAC_PI_2 + phi,
        "descent bearing",
    );
    assert_close(
        out["proportions"][4].as_f64().unwrap(),
        1.0 - phi / std::f64::consts::FRAC_PI_4,
        "share routed to E",
    );
}

#[test]
fn test_dinf_command_data_length_mismatch() {
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "data": [1.0, 2.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("dinf")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length 2 != rows*cols 2*2"));
}

#[test]
fn test_dinf_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("dinf")
        .write_stdin("{oops")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
}

// ─── Solar insolation ─────────────────────────────────────────────────────────

#[test]
fn test_solar_command_flat_grid_is_uniform_and_positive() {
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "latitude_deg": 40.0,
        "day_of_year": 172,
        "cell_size": 30.0,
        "data": [0.0, 0.0, 0.0, 0.0]
    });

    let out = run_json("solar", &input);
    assert_eq!(out["rows"], 2);
    assert_eq!(out["cols"], 2);
    let cells = out["data"].as_array().unwrap();
    let first = cells[0].as_f64().unwrap();
    assert!(
        (5.0..=11.0).contains(&first),
        "clear-sky June day at 40N was {first} kWh/m2/day"
    );
    assert_eq!(
        cells[1].as_f64().unwrap(),
        first,
        "flat grid must be uniform"
    );
}

#[test]
fn test_solar_command_south_wall_shades_northern_winter() {
    // A 1000 m wall filling the row immediately south of the targets, over
    // 1 m cells, at 60°N on day 5. The wall can only ever remove sun steps,
    // so every cell north of it must end up strictly below the same cell on
    // an otherwise identical open grid, and the wall top — which looks down
    // on everything and so cannot be shaded by it — keeps the full open-grid
    // day. Exact zeros are not asserted because a corner cell's ray toward a
    // low winter sun can leave this small grid before it reaches the wall;
    // that is the documented local-march behaviour, not a defect.
    let base = json!({
        "rows": 3,
        "cols": 3,
        "nodata": -32768.0,
        "latitude_deg": 60.0,
        "day_of_year": 5,
        "cell_size": 1.0,
        "horizon_cells": 10
    });

    let mut open = base.clone();
    open["data"] = json!([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    let mut walled = base.clone();
    walled["data"] = json!([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1000.0, 1000.0, 1000.0]);

    let open_cells = run_json("solar", &open)["data"].clone();
    let walled_cells = run_json("solar", &walled)["data"].clone();

    let wall_top = walled_cells[8].as_f64().unwrap();
    assert!(wall_top > 0.0, "wall top {wall_top} still sees the sky");
    for i in 0..6 {
        let shaded = walled_cells[i].as_f64().unwrap();
        let unshaded = open_cells[i].as_f64().unwrap();
        assert!(
            shaded < unshaded,
            "cell {i}: wall must cost energy ({shaded} vs {unshaded})"
        );
        assert!(
            shaded < wall_top,
            "cell {i}: no northern cell can out-see the wall top ({shaded} vs {wall_top})"
        );
    }
}

#[test]
fn test_solar_command_nodata_is_copied_through() {
    let input = json!({
        "rows": 1,
        "cols": 2,
        "nodata": -32768.0,
        "latitude_deg": 40.0,
        "day_of_year": 172,
        "cell_size": 30.0,
        "data": [-32768.0, 0.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("solar")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .success()
        .stdout(predicates::str::contains("-32768.0"));
}

#[test]
fn test_solar_command_data_length_mismatch() {
    let input = json!({
        "rows": 2,
        "cols": 2,
        "nodata": -32768.0,
        "latitude_deg": 40.0,
        "day_of_year": 172,
        "cell_size": 30.0,
        "data": [0.0]
    });

    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("solar")
        .write_stdin(serde_json::to_string(&input).unwrap())
        .assert()
        .failure()
        .stderr(predicates::str::contains("data length 1 != rows*cols 2*2"));
}

#[test]
fn test_solar_command_invalid_json() {
    Command::cargo_bin("openzenith_core_cli")
        .unwrap()
        .arg("solar")
        .write_stdin("[[[")
        .assert()
        .failure()
        .stderr(predicates::str::contains("invalid JSON"));
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
