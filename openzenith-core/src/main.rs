//! CLI binary for openzenith-core.
//!
//! All commands use JSON I/O for simplicity and correctness.
//!
//! Usage:
//!   openzenith_core_cli d8 < rows.json
//!   openzenith_core_cli accum < flow_dir.json
//!   openzenith_core_cli gradient-reconstruct < residuals.json
//!   openzenith_core_cli viewshed < dem.json
//!
//! Input format (JSON):
//!   { "rows": N, "cols": M, "nodata": VAL, "data": [...], ...extra fields }
//!
//! Output format (JSON):
//!   { "rows": N, "cols": M, "data": [...] }

use std::io::{self, Read, Write};

fn main() {
    // Read all stdin as UTF-8
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();

    let cmd = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("Usage: openzenith_core_cli <command>  (d8|accum|reconstruct|viewshed)");
        std::process::exit(1);
    });

    let result = match cmd.as_str() {
        "d8" => cmd_d8(&input),
        "accum" => cmd_accum(&input),
        "reconstruct" => cmd_gradient_reconstruct(&input),
        "viewshed" => cmd_viewshed(&input),
        _ => {
            eprintln!("Unknown command: {cmd}");
            std::process::exit(1);
        }
    };

    io::stdout().write_all(result.as_bytes()).unwrap();
}

// ─── JSON helpers ──────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct D8Input {
    rows: usize,
    cols: usize,
    nodata: f32,
    data: Vec<f32>,
}

#[derive(serde::Serialize)]
struct D8Output {
    rows: usize,
    cols: usize,
    data: Vec<i8>,
}

fn cmd_d8(input: &str) -> String {
    let inp: D8Input = serde_json::from_str(input).unwrap();
    assert_eq!(inp.data.len(), inp.rows * inp.cols);

    use openzenith_core::d8_flow_direction;
    use ndarray::Array2;

    let arr = Array2::from_shape_vec((inp.rows, inp.cols), inp.data).unwrap();
    let result = d8_flow_direction(&arr.view(), inp.nodata);

    let out = D8Output {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec(),
    };
    serde_json::to_string(&out).unwrap()
}

#[derive(serde::Deserialize)]
struct AccumInput {
    rows: usize,
    cols: usize,
    nodata: i8,
    data: Vec<i8>,
}

#[derive(serde::Serialize)]
struct AccumOutput {
    rows: usize,
    cols: usize,
    data: Vec<i32>,
}

fn cmd_accum(input: &str) -> String {
    let inp: AccumInput = serde_json::from_str(input).unwrap();
    assert_eq!(inp.data.len(), inp.rows * inp.cols);

    use openzenith_core::flow_accumulation;
    use ndarray::Array2;

    let arr = Array2::from_shape_vec((inp.rows, inp.cols), inp.data).unwrap();
    let result = flow_accumulation(&arr.view(), inp.nodata);

    let out = AccumOutput {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec(),
    };
    serde_json::to_string(&out).unwrap()
}

#[derive(serde::Deserialize)]
struct ReconstructInput {
    rows: usize,
    cols: usize,
    nodata: i16,
    dequant_min: f32,
    dequant_scale: f32,
    data: Vec<i16>,
}

#[derive(serde::Serialize)]
struct ReconstructOutput {
    rows: usize,
    cols: usize,
    data: Vec<f32>,
}

fn cmd_gradient_reconstruct(input: &str) -> String {
    let inp: ReconstructInput = serde_json::from_str(input).unwrap();
    assert_eq!(inp.data.len(), inp.rows * inp.cols);

    use openzenith_core::gradient_reconstruct;
    use ndarray::Array2;

    let residuals = Array2::from_shape_vec((inp.rows, inp.cols), inp.data).unwrap();
    let result = gradient_reconstruct(&residuals.view(), inp.nodata, inp.dequant_min, inp.dequant_scale);

    let out = ReconstructOutput {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec(),
    };
    serde_json::to_string(&out).unwrap()
}

#[derive(serde::Deserialize)]
struct ViewshedInput {
    rows: usize,
    cols: usize,
    observer_row: usize,
    observer_col: usize,
    observer_height: f32,
    cell_size: f32,
    nodata: f32,
    #[serde(default)]
    max_distance_cells: Option<usize>,
    data: Vec<f32>,
}

#[derive(serde::Serialize)]
struct ViewshedOutput {
    rows: usize,
    cols: usize,
    data: Vec<u8>, // 0/1 for bool
}

fn cmd_viewshed(input: &str) -> String {
    let inp: ViewshedInput = serde_json::from_str(input).unwrap();
    assert_eq!(inp.data.len(), inp.rows * inp.cols);

    use openzenith_core::viewshed;
    use ndarray::Array2;

    let dem = Array2::from_shape_vec((inp.rows, inp.cols), inp.data).unwrap();
    let result = viewshed(
        &dem.view(),
        inp.observer_row,
        inp.observer_col,
        inp.observer_height,
        inp.cell_size,
        inp.nodata,
        inp.max_distance_cells,
    );

    let out = ViewshedOutput {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec().iter().map(|&b| if b { 1u8 } else { 0u8 }).collect(),
    };
    serde_json::to_string(&out).unwrap()
}
