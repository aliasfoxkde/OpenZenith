//! OpenZenith core Rust library — high-performance terrain analysis primitives.
//!
//! Pure Rust algorithms: D8 flow direction, flow accumulation, stream order,
//! viewshed, and OZT2 gradient reconstruction.
//!
//! Build with `maturin develop` (from openzenith-core/) to install Python bindings.

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
