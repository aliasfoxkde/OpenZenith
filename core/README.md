# core

High-performance Rust primitives for OpenZenith terrain analysis.

## Building

```bash
cargo build --release
# Binary: target/release/openzenith_core_cli
```

## CLI Commands

```bash
# D8 flow direction
echo '{"rows":3,"cols":3,"nodata":-32768.0,"data":[100,100,100,100,5,0,100,0,100]}' \
  | openzenith_core_cli d8

# Flow accumulation
cat input.json | openzenith_core_cli accum

# Gradient reconstruction
cat input.json | openzenith_core_cli reconstruct

# Viewshed
cat input.json | openzenith_core_cli viewshed
```

## Python API

```bash
export OPENZENITH_CORE_CLI=/path/to/openzenith_core_cli
pip install /path/to/core/python
```

```python
from openzenith_core import d8_flow_direction, flow_accumulation

flow_dir = d8_flow_direction(dem, nodata=-32768.0)
accum = flow_accumulation(flow_dir, nodata_dir=-1)
```

## Algorithms

- **D8 flow direction**: steepest-descent neighbour, direction encoding 0=E,1=SE,2=S,3=SW,4=W,5=NW,6=N,7=NE, -1=nodata/pit
- **Flow accumulation**: topological sort (Kahn's algorithm), O(n) single pass
- **Gradient reconstruction**: OZT2 tile decode step — row-by-row recurrence with gradient predictor
- **Viewshed**: angular ray marching with bilinear interpolation

## Rust Tests

```bash
cargo test
```
