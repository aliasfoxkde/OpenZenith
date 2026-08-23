//! Integration tests for the openzenith_core_cli binary.
//!
//! Tests JSON I/O by piping input to stdin and checking stdout output.

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
