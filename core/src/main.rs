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
//!
//! Error format (JSON):
//!   { "error": "message" }

use std::io::{self, Read, Write};

fn main() {
    // Read all stdin as UTF-8
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        error_exit(format!("failed to read stdin: {e}"));
    }

    let cmd = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("Usage: openzenith_core_cli <command>  (d8|accum|reconstruct|viewshed|stream-order|gradient-predict)");
        std::process::exit(1);
    });

    let result = match cmd.as_str() {
        "d8" => cmd_d8(&input),
        "accum" => cmd_accum(&input),
        "reconstruct" => cmd_gradient_reconstruct(&input),
        "viewshed" => cmd_viewshed(&input),
        "stream-order" => cmd_stream_order(&input),
        "gradient-predict" => cmd_gradient_predict(&input),
        _ => {
            error_exit(format!("unknown command: {cmd}"));
        }
    };

    match result {
        Ok(json) => {
            if let Err(e) = io::stdout().write_all(json.as_bytes()) {
                error_exit(format!("failed to write stdout: {e}"));
            }
        }
        Err(msg) => error_exit(msg),
    }
}

fn error_exit(msg: String) -> ! {
    let _ = io::stderr()
        .write_all(format!("{{\"error\": {}}}\n", serde_json::to_string(&msg).unwrap()).as_bytes());
    std::process::exit(1);
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

fn cmd_d8(input: &str) -> Result<String, String> {
    let inp: D8Input = serde_json::from_str(input).map_err(|e| format!("invalid JSON: {e}"))?;
    if inp.data.len() != inp.rows * inp.cols {
        return Err(format!(
            "data length {} != rows*cols {}*{}",
            inp.data.len(),
            inp.rows,
            inp.cols
        ));
    }

    use ndarray::Array2;
    use openzenith_core::d8_flow_direction;

    let arr = Array2::from_shape_vec((inp.rows, inp.cols), inp.data)
        .map_err(|e| format!("invalid array shape: {e}"))?;
    let result = d8_flow_direction(&arr.view(), inp.nodata);

    let out = D8Output {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec_and_offset().0,
    };
    serde_json::to_string(&out).map_err(|e| format!("serialization error: {e}"))
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

fn cmd_accum(input: &str) -> Result<String, String> {
    let inp: AccumInput = serde_json::from_str(input).map_err(|e| format!("invalid JSON: {e}"))?;
    if inp.data.len() != inp.rows * inp.cols {
        return Err(format!(
            "data length {} != rows*cols {}*{}",
            inp.data.len(),
            inp.rows,
            inp.cols
        ));
    }

    use ndarray::Array2;
    use openzenith_core::flow_accumulation;

    let arr = Array2::from_shape_vec((inp.rows, inp.cols), inp.data)
        .map_err(|e| format!("invalid array shape: {e}"))?;
    let result = flow_accumulation(&arr.view(), inp.nodata);

    let out = AccumOutput {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec_and_offset().0,
    };
    serde_json::to_string(&out).map_err(|e| format!("serialization error: {e}"))
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

fn cmd_gradient_reconstruct(input: &str) -> Result<String, String> {
    let inp: ReconstructInput =
        serde_json::from_str(input).map_err(|e| format!("invalid JSON: {e}"))?;
    if inp.data.len() != inp.rows * inp.cols {
        return Err(format!(
            "data length {} != rows*cols {}*{}",
            inp.data.len(),
            inp.rows,
            inp.cols
        ));
    }

    use ndarray::Array2;
    use openzenith_core::gradient_reconstruct;

    let residuals = Array2::from_shape_vec((inp.rows, inp.cols), inp.data)
        .map_err(|e| format!("invalid array shape: {e}"))?;
    let result = gradient_reconstruct(
        &residuals.view(),
        inp.nodata,
        inp.dequant_min,
        inp.dequant_scale,
    );

    let out = ReconstructOutput {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec_and_offset().0,
    };
    serde_json::to_string(&out).map_err(|e| format!("serialization error: {e}"))
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

fn cmd_viewshed(input: &str) -> Result<String, String> {
    let inp: ViewshedInput =
        serde_json::from_str(input).map_err(|e| format!("invalid JSON: {e}"))?;
    if inp.data.len() != inp.rows * inp.cols {
        return Err(format!(
            "data length {} != rows*cols {}*{}",
            inp.data.len(),
            inp.rows,
            inp.cols
        ));
    }

    use ndarray::Array2;
    use openzenith_core::viewshed;

    let dem = Array2::from_shape_vec((inp.rows, inp.cols), inp.data)
        .map_err(|e| format!("invalid array shape: {e}"))?;
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
        data: result
            .into_raw_vec_and_offset()
            .0
            .iter()
            .map(|&b| if b { 1u8 } else { 0u8 })
            .collect(),
    };
    serde_json::to_string(&out).map_err(|e| format!("serialization error: {e}"))
}

// ─── Stream order ─────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct StreamOrderInput {
    rows: usize,
    cols: usize,
    #[serde(default = "default_nodata_dir")]
    nodata_dir: i8,
    streams: Vec<i8>,
    flow_dir: Vec<i8>,
}

fn default_nodata_dir() -> i8 {
    -1
}

#[derive(serde::Serialize)]
struct StreamOrderOutput {
    rows: usize,
    cols: usize,
    data: Vec<u8>,
}

fn cmd_stream_order(input: &str) -> Result<String, String> {
    let inp: StreamOrderInput =
        serde_json::from_str(input).map_err(|e| format!("invalid JSON: {e}"))?;
    if inp.streams.len() != inp.rows * inp.cols {
        return Err(format!(
            "streams length {} != rows*cols {}*{}",
            inp.streams.len(),
            inp.rows,
            inp.cols
        ));
    }
    if inp.flow_dir.len() != inp.rows * inp.cols {
        return Err(format!(
            "flow_dir length {} != rows*cols {}*{}",
            inp.flow_dir.len(),
            inp.rows,
            inp.cols
        ));
    }

    use ndarray::Array2;
    use openzenith_core::stream_order;

    let streams = Array2::from_shape_vec((inp.rows, inp.cols), inp.streams)
        .map_err(|e| format!("invalid array shape: {e}"))?;
    let flow_dir = Array2::from_shape_vec((inp.rows, inp.cols), inp.flow_dir)
        .map_err(|e| format!("invalid array shape: {e}"))?;
    let result = stream_order(&streams.view(), &flow_dir.view(), inp.nodata_dir);

    let out = StreamOrderOutput {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec_and_offset().0,
    };
    serde_json::to_string(&out).map_err(|e| format!("serialization error: {e}"))
}

// ─── Gradient predict (encode) ─────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct GradientPredictInput {
    rows: usize,
    cols: usize,
    nodata: f32,
    data: Vec<f32>,
}

#[derive(serde::Serialize)]
struct GradientPredictOutput {
    rows: usize,
    cols: usize,
    data: Vec<i16>,
}

fn cmd_gradient_predict(input: &str) -> Result<String, String> {
    let inp: GradientPredictInput =
        serde_json::from_str(input).map_err(|e| format!("invalid JSON: {e}"))?;
    if inp.data.len() != inp.rows * inp.cols {
        return Err(format!(
            "data length {} != rows*cols {}*{}",
            inp.data.len(),
            inp.rows,
            inp.cols
        ));
    }

    use ndarray::Array2;
    use openzenith_core::gradient_predict;

    let arr = Array2::from_shape_vec((inp.rows, inp.cols), inp.data)
        .map_err(|e| format!("invalid array shape: {e}"))?;
    let result = gradient_predict(&arr.view(), inp.nodata);

    let out = GradientPredictOutput {
        rows: inp.rows,
        cols: inp.cols,
        data: result.into_raw_vec_and_offset().0,
    };
    serde_json::to_string(&out).map_err(|e| format!("serialization error: {e}"))
}
