"""Terrarium PNG elevation tile encoding/decoding.

Terrarium format encodes elevation as RGB pixels in a PNG image:
    height_m = (R * 256 + G + B / 256) - 32768

This is the standard format used by MapLibre GL JS, CesiumJS, and Deck.gl
for raster-dem terrain visualization.

Supports decoding tiles to numpy arrays and encoding arrays back to PNG bytes.
"""

import io

import numpy as np
from PIL import Image


def decode_tile(png_bytes: bytes) -> np.ndarray:
    """Decode a Terrarium PNG tile to a float32 elevation array.

    Args:
        png_bytes: Raw PNG file bytes

    Returns:
        (height, width) float32 array of elevation values in meters.
        NoData pixels (encoded as R=0, G=0, B=0) return NaN.
    """
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    pixels = np.array(img, dtype=np.float64)

    # Decode Terrarium: height = R*256 + G + B/256 - 32768
    r = pixels[:, :, 0]
    g = pixels[:, :, 1]
    b = pixels[:, :, 2]

    elevation = r * 256.0 + g + b / 256.0 - 32768.0

    # NoData: all-zero RGB encodes to -32768 in Terrarium
    nodata_mask = (r == 0) & (g == 0) & (b == 0)
    elevation[nodata_mask] = np.nan

    return elevation.astype(np.float32)


def encode_tile(elevation: np.ndarray, nodata: float = np.nan) -> bytes:
    """Encode a float32 elevation array to Terrarium PNG bytes.

    Args:
        elevation: (height, width) float32 array of elevation values in meters.
        nodata: Value indicating NoData (default: np.nan).

    Returns:
        PNG file bytes with Terrarium encoding.
    """
    h, w = elevation.shape
    arr = elevation.flatten().astype(np.float64)

    # Handle NoData
    valid = ~np.isnan(arr) if np.isnan(nodata) else (arr != nodata)

    # Encode Terrarium: height_m = (R * 256 + G + B / 256) - 32768
    # So: R = floor((h + 32768) / 256), G = (h + 32768) % 256, B = frac * 256
    shifted = np.zeros_like(arr)
    shifted[valid] = np.clip(arr[valid] + 32768.0, 0, 65535)

    r = np.zeros(len(arr), dtype=np.uint8)
    g = np.zeros(len(arr), dtype=np.uint8)
    b = np.zeros(len(arr), dtype=np.uint8)

    r[valid] = np.floor(shifted[valid] / 256.0).astype(np.uint8)
    g[valid] = (shifted[valid] % 256).astype(np.uint8)
    b[valid] = np.floor((shifted[valid] - np.floor(shifted[valid])) * 256).astype(np.uint8)

    # Build RGB image
    rgb = np.stack([r, g, b], axis=-1).reshape(h, w, 3)
    img = Image.fromarray(rgb, mode="RGB")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
