//! `OpenZenith` core Rust library — high-performance terrain analysis primitives.
//!
//! Pure Rust algorithms: D8 flow direction, flow accumulation, stream order,
//! viewshed, and OZT2 gradient reconstruction.
//!
//! Every function in this crate is **total**: it never panics, never allocates
//! unboundedly beyond its output grid, and has no failure mode — malformed or
//! degenerate input (empty grids, out-of-range indices, nodata-saturated cells)
//! yields a well-defined grid rather than an error. Consequences:
//!
//! * All grid arguments are borrowed as [`ndarray::ArrayView2`] and the result
//!   is a freshly allocated [`ndarray::Array2`]; no input is mutated.
//! * Elevations and lengths are `f32` in whatever unit the caller's DEM uses
//!   (metres for SRTM); indices are `usize` row/column pairs.
//! * Every `nodata` parameter is a caller-supplied sentinel compared with `<=`:
//!   cells at or below it are treated as "no data", never as terrain.
//!
//! Build with `maturin develop` (from `openzenith-core/`) to install Python
//! bindings; build with `wasm-pack build --target web` for the browser bindings.

pub mod d8;
pub mod ozt2;
pub mod viewshed;

// WASM bindings (activated by wasm-bindgen crate feature)
#[cfg(feature = "wasm")]
pub mod wasm;

// Re-export for convenience
pub use d8::{
    d8_flow_direction, d8_flow_direction_par, flow_accumulation, flow_accumulation_par,
    stream_order,
};
pub use ozt2::{gradient_predict, gradient_reconstruct, left_reconstruct};
pub use viewshed::viewshed;
