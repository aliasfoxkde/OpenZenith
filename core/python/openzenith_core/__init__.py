"""OpenZenith-core: high-performance Rust primitives for terrain analysis.

Pure-Python subprocess wrapper around the ``openzenith_core_cli`` binary built
from this crate. There is no native Python extension here — the Rust crate has
no pyo3 dependency, so the binding is a JSON-over-stdin/stdout round trip per
call. That makes this module the whole story:

1. Build the CLI once from the repo root::

       cd core && cargo build --release   # -> core/target/release/openzenith_core_cli

2. Make it importable. Either install this directory as its own distribution
   (``pip install core`` — see ``core/pyproject.toml``) or leave it in place;
   the resolution order below finds an uninstalled checkout.

Binary resolution (``_cli_path``), first match wins:

1. ``OPENZENITH_CORE_CLI`` — explicit path, used when the file exists.
2. ``<this package>/../../target/release/openzenith_core_cli`` — a checkout
   that has been built in place.
3. Otherwise ``RuntimeError`` with the build instruction.

Every function takes plain nested lists and returns plain nested lists, so the
wrapper has no numpy dependency; callers pass ``arr.tolist()`` from an ndarray.

Usage:
    from openzenith_core import d8_flow_direction, flow_accumulation

    flow_dir = d8_flow_direction(dem, nodata=-32768.0)
    accum = flow_accumulation(flow_dir, nodata_dir=-1)
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

__all__ = [
    "d8_flow_direction",
    "flow_accumulation",
    "gradient_predict",
    "gradient_reconstruct",
    "stream_order",
    "viewshed",
]

# ─── Locate the CLI binary ──────────────────────────────────────────────────────

_CLI: Path | None = None


def _cli_path() -> Path:
    """Resolve the CLI binary; see the module docstring for the search order."""
    global _CLI
    if _CLI is not None:
        return _CLI

    env = os.environ.get("OPENZENITH_CORE_CLI", "")
    if env:
        p = Path(env)
        if p.exists():
            _CLI = p
            return _CLI

    # Relative: ../../target/release/openzenith_core_cli
    local = Path(__file__).parent.parent.parent / "target" / "release" / "openzenith_core_cli"
    if local.exists():
        _CLI = local
        return _CLI

    raise RuntimeError(
        "openzenith-core CLI not found. "
        "Set OPENZENITH_CORE_CLI env var, or build with: "
        "cd core && cargo build --release"
    )


def _run(cmd: str, payload: dict) -> dict:
    """Run CLI with JSON payload and return JSON response."""
    cli = _cli_path()
    stdin = json.dumps(payload).encode()
    try:
        proc = subprocess.run(
            [str(cli), cmd],
            input=stdin,
            capture_output=True,
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"openzenith-core CLI timed out (command={cmd})") from None
    except FileNotFoundError:
        raise RuntimeError(
            f"openzenith-core CLI not found at {cli}. "
            "Set OPENZENITH_CORE_CLI or build with: "
            "cd core && cargo build --release"
        ) from None

    if proc.returncode != 0:
        raise RuntimeError(
            f"openzenith-core CLI failed (exit {proc.returncode}): "
            f"{proc.stderr.decode(errors='replace')}"
        )

    try:
        return json.loads(proc.stdout.decode())
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"openzenith-core CLI returned invalid JSON: {e}\n"
            f"stdout (first 500 bytes): {proc.stdout[:500]!r}"
        ) from None


def _to_2d(flat: list, rows: int, cols: int) -> list[list]:
    return [flat[i * cols:(i + 1) * cols] for i in range(rows)]


# ─── Public API ────────────────────────────────────────────────────────────────


def d8_flow_direction(
    dem: list[list[float]],
    nodata: float = -32768.0,
) -> list[list[int]]:
    """Compute D8 flow direction via Rust.

    Args:
        dem: 2D elevation grid (list of rows)
        nodata: nodata value

    Returns:
        2D grid of int8 direction values:
        0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE, -1=nodata/pit
    """
    rows = len(dem)
    cols = len(dem[0]) if rows > 0 else 0
    flat = [cell for row in dem for cell in row]

    out = _run("d8", {
        "rows": rows,
        "cols": cols,
        "nodata": nodata,
        "data": flat,
    })

    data = out["data"]
    # JSON deserializes i8 as signed int in Python 3
    if isinstance(data[0], str):
        data = [int(x) for x in data]
    return _to_2d(data, rows, cols)


def flow_accumulation(
    flow_dir: list[list[int]],
    nodata_dir: int = -1,
) -> list[list[int]]:
    """Compute D8 flow accumulation via Rust.

    Args:
        flow_dir: 2D grid of D8 direction values
        nodata_dir: nodata direction value (typically -1)

    Returns:
        2D grid of int32 upstream cell counts
    """
    rows = len(flow_dir)
    cols = len(flow_dir[0]) if rows > 0 else 0
    flat = [cell for row in flow_dir for cell in row]

    out = _run("accum", {
        "rows": rows,
        "cols": cols,
        "nodata": nodata_dir,
        "data": flat,
    })

    data = out["data"]
    if isinstance(data[0], str):
        data = [int(x) for x in data]
    return _to_2d(data, rows, cols)


def gradient_reconstruct(
    residuals: list[list[int]],
    nodata: int = -32768,
    dequant_min: float = 0.0,
    dequant_scale: float = 1.0,
) -> list[list[float]]:
    """Reconstruct elevation grid from OZT2 gradient residuals.

    Args:
        residuals: 2D grid of int16 residuals
        nodata: nodata value
        dequant_min: minimum dequantization value
        dequant_scale: dequantization scale

    Returns:
        2D grid of reconstructed f32 elevations
    """
    rows = len(residuals)
    cols = len(residuals[0]) if rows > 0 else 0
    flat = [cell for row in residuals for cell in row]

    out = _run("reconstruct", {
        "rows": rows,
        "cols": cols,
        "nodata": nodata,
        "dequant_min": dequant_min,
        "dequant_scale": dequant_scale,
        "data": flat,
    })

    data = out["data"]
    if isinstance(data[0], str):
        data = [float(x) for x in data]
    return _to_2d(data, rows, cols)


def viewshed(
    dem: list[list[float]],
    observer_row: int,
    observer_col: int,
    observer_height: float = 1.75,
    cell_size: float = 0.001,
    nodata: float = -32768.0,
    max_distance_cells: int | None = None,
) -> list[list[int]]:
    """Compute viewshed (visible cells) from an observer point.

    Args:
        dem: 2D elevation grid
        observer_row: row index of observer
        observer_col: column index of observer
        observer_height: observer height above terrain (metres)
        cell_size: cell size in same units as elevation
        nodata: nodata value
        max_distance_cells: maximum ray length (default: grid diagonal)

    Returns:
        2D grid of 1 (visible) / 0 (not visible)
    """
    rows = len(dem)
    cols = len(dem[0]) if rows > 0 else 0
    flat = [cell for row in dem for cell in row]

    payload = {
        "rows": rows,
        "cols": cols,
        "observer_row": observer_row,
        "observer_col": observer_col,
        "observer_height": observer_height,
        "cell_size": cell_size,
        "nodata": nodata,
        "data": flat,
    }
    if max_distance_cells is not None:
        payload["max_distance_cells"] = max_distance_cells

    out = _run("viewshed", payload)

    data = out["data"]
    if isinstance(data[0], str):
        data = [int(x) for x in data]
    return _to_2d(data, rows, cols)


def stream_order(
    streams: list[list[int]],
    flow_dir: list[list[int]],
    nodata_dir: int = -1,
) -> list[list[int]]:
    """Compute Strahler stream order from binary stream mask and D8 flow directions.

    Args:
        streams: 2D grid of 1 (stream cell) / 0 (non-stream), from extract_streams
        flow_dir: 2D grid of D8 direction values (0-7, -1 for pits), from d8_flow_direction
        nodata_dir: nodata direction value (default -1)

    Returns:
        2D grid of stream order values (1 = first-order stream, etc., 0 = not a stream)
    """
    rows = len(streams)
    cols = len(streams[0]) if rows > 0 else 0
    stream_flat = [cell for row in streams for cell in row]
    flow_flat = [cell for row in flow_dir for cell in row]

    out = _run("stream-order", {
        "rows": rows,
        "cols": cols,
        "nodata_dir": nodata_dir,
        "streams": stream_flat,
        "flow_dir": flow_flat,
    })

    data = out["data"]
    if isinstance(data[0], str):
        data = [int(x) for x in data]
    return _to_2d(data, rows, cols)


def gradient_predict(
    elevation: list[list[float]],
    nodata: float = -32768.0,
) -> list[list[int]]:
    """Compute gradient prediction residuals (OZT2 encode).

    Args:
        elevation: 2D elevation grid (f32)
        nodata: nodata value

    Returns:
        2D grid of int16 residuals
    """
    rows = len(elevation)
    cols = len(elevation[0]) if rows > 0 else 0
    flat = [cell for row in elevation for cell in row]

    out = _run("gradient-predict", {
        "rows": rows,
        "cols": cols,
        "nodata": nodata,
        "data": flat,
    })

    data = out["data"]
    if isinstance(data[0], str):
        data = [int(x) for x in data]
    return _to_2d(data, rows, cols)
