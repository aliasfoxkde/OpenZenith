"""Multi-DEM fusion: SRTM land elevation + GEBCO 2025 bathymetry.

Fuses SRTM 30m land data with GEBCO 2025 ~450m ocean bathymetry into
a seamless global elevation grid with coherent coastline treatment.

Usage:
    from openzenith.fuse import FusedDEM, load_fused_tile

    # Get a fused 256x256 tile at zoom 10
    dem = load_fused_tile(lat_min, lon_min, zoom=10)

    # Or use the FusedDEM class for fine-grained control
    fused = FusedDEM(srtm_dir="/data/srtm30m-merged", gebco_dir="/data/gebco_2025")
    elevation_grid, mask = fused.query(lat_min, lon_min, lat_max, lon_max)

    # Export to GeoTIFF
    from openzenith.geotiff import export_geotiff
    export_geotiff(elevation_grid, "fused.tif", transform=(lat_min, lon_min, 0.001, 0.001))
"""

from __future__ import annotations

__all__ = [
    "FusedDEM",
    "load_fused_tile",
    "load_fused_elevation_grid",
]

import logging
import math
from pathlib import Path

import numpy as np

_logger = logging.getLogger(__name__)


# ─── GEBCO constants ────────────────────────────────────────────────────────────

GEBCO_BASE_URL = "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff"
"""Base URL for GEBCO 2025 quadrant GeoTIFFs (CEDA hosted, supports HTTP range requests)."""

GEBCO_RESOLUTION_ARCSEC = 15  # 15 arc-second = ~450m at equator
GEBCO_PIXELS_PER_DEG = 240   # 3600 arc-sec / 15 arc-sec per pixel
GEBCO_NODATA = -32768
"""GEBCO uses Int16 with no explicit nodata; unrealistic values (< -11000 or > 9000) are treated as nodata."""

GEBCO_LAND_THRESHOLD = 0.0  # positive = above sea level


# ─── GEBCO tile math ───────────────────────────────────────────────────────────

def _quad_name(lat: float, lon: float) -> str:
    """Return GEBCO quadrant filename for a lat/lon."""
    lat_dir = "n" if lat >= 0 else "s"
    lon_dir = "e" if lon >= 0 else "w"
    # Latitude: 0-90N → N45, 90-180N → N135
    lat_center = math.floor(abs(lat) / 90) * 90 + 45
    # Longitude: edge cases at ±90° and ±180°
    abs_lon = abs(lon)
    lon_floor = math.floor(abs_lon / 90) * 90
    if abs_lon == 180:
        lon_center = 180  # E180 or W180
    elif lon_floor == 90 and lon < 0:
        lon_center = 135  # W135 quadrant
    elif lon_floor == 0 and lon < 0:
        lon_center = 45  # W045 quadrant
    else:
        lon_center = lon_floor + 45
    return f"gebco_2025_{lat_dir}{lat_center:02d}_{lon_dir}{lon_center:03d}.tif"


def _quad_bounds(lat: float, lon: float) -> tuple[float, float, float, float]:
    """Return (lat_min, lon_min, lat_max, lon_max) for the quadrant containing lat/lon."""
    abs_lon = abs(lon)
    lon_floor = math.floor(abs_lon / 90) * 90

    # Latitude
    lat_floor = math.floor(abs(lat) / 90) * 90
    if lat >= 0:
        lat_min = lat_floor
        lat_max = lat_floor + 90
    else:
        lat_min = -(lat_floor + 90)
        lat_max = -lat_floor

    # Longitude
    if abs_lon == 180:
        lon_min = -180 if lon < 0 else 180
        lon_max = -90 if lon < 0 else 270
    elif lon >= 0:
        lon_min = lon_floor
        lon_max = lon_floor + 90
    else:
        if lon_floor == 90:  # e.g., lon=-90 → abs_lon=90, floor=90
            lon_min = -180
            lon_max = -90
        elif lon_floor == 0:  # e.g., lon=-45 → abs_lon=45, floor=0
            lon_min = -90
            lon_max = 0
        else:
            lon_min = -(lon_floor + 90)
            lon_max = -lon_floor

    return (lat_min, lon_min, lat_max, lon_max)


# ─── FusedDEM class ───────────────────────────────────────────────────────────


class FusedDEM:
    """Fused SRTM + GEBCO elevation source.

    Provides a unified interface for querying elevation anywhere on Earth,
    automatically using SRTM 30m data over land and GEBCO 2025 ~450m
    bathymetry over ocean.

    Args:
        srtm_dir: Path to SRTM .merged files (OZCHNK01 format).
        gebco_dir: Path to local GEBCO 2025 quadrant GeoTIFFs. If None,
            fetches from CEDA HTTP endpoint (requires network).
        gebco_url: Override base URL for GEBCO HTTP fetching.
        srtm_tiles: Optional pre-loaded SRTM tile index. If None, built on first use.
        use_http_fallback: If True and GEBCO quadrant is not in gebco_dir,
            fetch it over HTTP from CEDA. Requires requests library.

    Example:
        fused = FusedDEM(
            srtm_dir="/data/srtm30m-merged",
            gebco_dir="/data/gebco_2025",
        )
        elev, mask = fused.query(40.0, -74.0, 41.0, -73.0)
        print(f"Elevation at NYC: {elev[0,0]:.1f}m")
    """

    def __init__(
        self,
        srtm_dir: str | Path | None = None,
        gebco_dir: str | Path | None = None,
        *,
        gebco_url: str = GEBCO_BASE_URL,
        srtm_tiles: dict | None = None,
        use_http_fallback: bool = True,
    ):
        self.srtm_dir = Path(srtm_dir) if srtm_dir else None
        self.gebco_dir = Path(gebco_dir) if gebco_dir else None
        self.gebco_url = gebco_url
        self.use_http_fallback = use_http_fallback
        self._srtm_tiles = srtm_tiles
        self._gebco_cache: dict[str, np.ndarray] = {}

    # ─── Public API ───────────────────────────────────────────────────────────

    def query(
        self,
        lat_min: float,
        lon_min: float,
        lat_max: float,
        lon_max: float,
        *,
        resolution: float = 0.001,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Query a rectangular region and return fused elevation + land/ocean mask.

        Args:
            lat_min, lon_min: Southwest corner of the query region.
            lat_max, lon_max: Northeast corner.
            resolution: Grid cell size in degrees (default: 0.001 ≈ 111m at equator).

        Returns:
            (elevation, mask) where elevation is int16 (meters, NODATA=-32768)
            and mask is uint8 (0=ocean, 1=land, 2=SRTM nodata).
        """
        rows = max(1, int(math.ceil((lat_max - lat_min) / resolution)))
        cols = max(1, int(math.ceil((lon_max - lon_min) / resolution)))

        elevation = np.full((rows, cols), GEBCO_NODATA, dtype=np.int16)
        mask = np.zeros((rows, cols), dtype=np.uint8)  # 0=ocean, 1=land

        lat_vals = np.linspace(lat_max, lat_min, rows)
        lon_vals = np.linspace(lon_min, lon_max, cols)

        # Collect GEBCO quadrant files we need
        gebco_quads: dict[str, tuple[int, int, int, int]] = {}  # quad_name → (r_start, r_end, c_start, c_end)

        for r in range(rows):
            for c in range(cols):
                lat = lat_vals[r]
                lon = lon_vals[c]

                srtm_result = self._srtm_elevation(lat, lon)
                if srtm_result is not None:
                    elev, is_land = srtm_result
                    elevation[r, c] = elev
                    mask[r, c] = 1 if is_land else 0
                else:
                    # Use GEBCO
                    gebco_elev = self._gebco_elevation(lat, lon)
                    if gebco_elev is not None:
                        elevation[r, c] = gebco_elev
                        mask[r, c] = 0  # ocean

        return elevation, mask

    def query_point(self, lat: float, lon: float) -> tuple[int | None, str]:
        """Query elevation at a single point.

        Returns:
            (elevation_meters, surface_type) where surface_type is
            "land", "ocean", or "unknown".
        """
        srtm_result = self._srtm_elevation(lat, lon)
        if srtm_result is not None:
            elev, is_land = srtm_result
            return elev, "land" if is_land else "ocean"

        gebco_elev = self._gebco_elevation(lat, lon)
        if gebco_elev is not None:
            return gebco_elev, "ocean"

        return None, "unknown"

    # ─── SRTM ─────────────────────────────────────────────────────────────────

    def _srtm_elevation(self, lat: float, lon: float) -> tuple[int, bool] | None:
        """Get SRTM elevation at a point, or None if not available.

        Returns (elevation, is_land) or None if the point is outside SRTM coverage.
        """
        if self.srtm_dir is None:
            return None

        from openzenith.merged import get_merged_file

        # Find SRTM tile
        srtm_lat = math.floor(lat)
        srtm_lon = math.floor(lon)

        # Build SRTM tiles index lazily
        if self._srtm_tiles is None:
            from openzenith.merged import discover_srtm_tiles
            self._srtm_tiles = discover_srtm_tiles(self.srtm_dir)

        if (srtm_lat, srtm_lon) not in self._srtm_tiles:
            return None

        info = self._srtm_tiles[(srtm_lat, srtm_lon)]
        if not info.get("has_data", False):
            return None

        # Compute pixel position within SRTM tile
        lat_frac = lat - srtm_lat  # 0 at S bottom, 1 at N top
        lon_frac = lon - srtm_lon  # 0 at W edge, 1 at E edge

        # SRTM: row 0 = max lat, row 3600 = min lat
        row = round((1.0 - lat_frac) * 3600)
        col = round(lon_frac * 3600)
        row = max(0, min(3600, row))
        col = max(0, min(3600, col))

        chunk_row = row // 256
        chunk_col = col // 256
        local_row = row - chunk_row * 256
        local_col = col - chunk_col * 256

        tile_name = self._tile_name(srtm_lat, srtm_lon)
        lat_dir = tile_name[:3]
        merged_path = self.srtm_dir / lat_dir / f"{tile_name}.merged"
        if not merged_path.exists():
            return None

        try:
            mf = get_merged_file(merged_path)
            idx_flat = chunk_row * mf.cols + chunk_col
            if idx_flat >= len(mf.index) or mf.index[idx_flat]["size"] == 0:
                return None
            chunk = mf.get_chunk(chunk_row, chunk_col)
            elev = chunk[local_row, local_col]
            if elev == -32768:
                return None
            is_land = True
            return elev, is_land
        except Exception as err:
            _logger.debug("SRTM merged read failed (path=%s): %s: %s", merged_path, type(err).__name__, err)
            return None

    # ─── GEBCO ────────────────────────────────────────────────────────────────

    def _gebco_elevation(self, lat: float, lon: float) -> int | None:
        """Get GEBCO elevation at a point (negative = ocean depth)."""
        if self.gebco_dir is not None:
            return self._gebco_from_local(lat, lon)
        elif self.use_http_fallback:
            return self._gebco_from_http(lat, lon)
        return None

    def _gebco_from_local(self, lat: float, lon: float) -> int | None:
        """Read GEBCO from local quadrant files."""
        if self.gebco_dir is None:
            return None

        quad = _quad_name(lat, lon)
        if quad not in self._gebco_cache:
            quad_path = self.gebco_dir / quad
            if quad_path.exists():
                self._gebco_cache[quad] = self._read_gebco_quad(quad_path)
            else:
                return None

        quad_data = self._gebco_cache.get(quad)
        if quad_data is None:
            return None

        bounds = _quad_bounds(lat, lon)
        row = int(round((bounds[2] - lat) * GEBCO_PIXELS_PER_DEG))
        col = int(round((lon - bounds[1]) * GEBCO_PIXELS_PER_DEG))
        row = max(0, min(21600 - 1, row))
        col = max(0, min(21600 - 1, col))
        elev = quad_data[row, col]

        # GEBCO nodata check
        if elev < -11000 or elev > 9000:
            return None
        return elev

    def _read_gebco_quad(self, path: Path) -> np.ndarray:
        """Read a GEBCO quadrant GeoTIFF as a numpy array."""
        try:
            import rasterio
            with rasterio.open(path) as src:
                return src.read(1)  # shape: (21600, 21600)
        except ImportError:
            # Fallback: use PIL for geotiff
            from PIL import Image
            img = Image.open(path)
            return np.array(img, dtype=np.int16)

    def _gebco_from_http(self, lat: float, lon: float) -> int | None:
        """Fetch a single GEBCO strip over HTTP (no local files needed)."""
        try:
            import requests
        except ImportError:
            return None

        quad = _quad_name(lat, lon)
        bounds = _quad_bounds(lat, lon)
        url = f"{self.gebco_url}/{quad}"

        # Compute which row we need
        row = int(round((bounds[2] - lat) * GEBCO_PIXELS_PER_DEG))
        row = max(0, min(21600 - 1, row))

        # GEBCO strip: each row is STRIP_BYTES = 21600 * 2 = 43200 bytes
        # Data starts at byte 135948
        STRIP_BYTES = 21600 * 2
        STRIP_DATA_START = 135948
        offset = STRIP_DATA_START + row * STRIP_BYTES

        headers = {"Range": f"bytes={offset}-{offset + STRIP_BYTES - 1}"}
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code not in (200, 206):
                return None
            data = np.frombuffer(resp.content, dtype=np.int16)  # 21600 values
            col = int(round((lon - bounds[1]) * GEBCO_PIXELS_PER_DEG))
            col = max(0, min(21600 - 1, col))
            elev = int(data[col])
            if elev < -11000 or elev > 9000:
                return None
            return elev
        except Exception as err:
            _logger.debug("GEBCO HTTP fetch failed (url=%s): %s: %s", url, type(err).__name__, err)
            return None

    # ─── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _tile_name(lat: float, lon: float) -> str:
        """SRTM .merged filename for a tile corner."""
        lat_dir = "N" if lat >= 0 else "S"
        lon_dir = "E" if lon >= 0 else "W"
        return f"{lat_dir}{abs(lat):02d}{lon_dir}{abs(lon):03d}"


# ─── High-level helpers ────────────────────────────────────────────────────────


def load_fused_tile(
    lat: float,
    lon: float,
    zoom: int = 10,
    srtm_dir: str | Path | None = None,
    gebco_dir: str | Path | None = None,
    resolution: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Load a fused SRTM+GEBCO tile as a 256×256 grid.

    Args:
        lat, lon: Center of the tile (or SW corner depending on convention).
        zoom: Web Mercator zoom level. Determines tile size.
        srtm_dir: Path to SRTM .merged files.
        gebco_dir: Path to GEBCO quadrant GeoTIFFs.
        resolution: Override cell size in degrees. Default: derived from zoom.

    Returns:
        (elevation_grid, mask) as for FusedDEM.query().
    """
    from scripts.convert_to_ozt2 import xyz_tile_to_lat_lon_bounds, mercator_lat_to_tile_y

    # Convert center lat/lon to tile coords
    n = 2 ** zoom
    x_tile = int((lon + 180) / 360 * n)
    y_tile = mercator_lat_to_tile_y(lat, zoom)

    lat_min, lat_max, lon_min, lon_max = xyz_tile_to_lat_lon_bounds(zoom, x_tile, y_tile)

    if resolution is None:
        resolution = (lat_max - lat_min) / 256

    fused = FusedDEM(srtm_dir=srtm_dir, gebco_dir=gebco_dir)
    return fused.query(lat_min, lon_min, lat_max, lon_max, resolution=resolution)


def load_fused_elevation_grid(
    lat_min: float,
    lon_min: float,
    lat_max: float,
    lon_max: float,
    resolution: float = 0.001,
    srtm_dir: str | Path | None = None,
    gebco_dir: str | Path | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Load a rectangular region as fused SRTM+GEBCO elevation.

    Convenience function equivalent to creating a FusedDEM and calling query().

    Args:
        lat_min, lon_min: Southwest corner.
        lat_max, lon_max: Northeast corner.
        resolution: Cell size in degrees (default: 0.001 ≈ 111m).
        srtm_dir: Path to SRTM .merged files.
        gebco_dir: Path to GEBCO quadrant GeoTIFFs.

    Returns:
        (elevation, mask) arrays as for FusedDEM.query().
    """
    fused = FusedDEM(srtm_dir=srtm_dir, gebco_dir=gebco_dir)
    return fused.query(lat_min, lon_min, lat_max, lon_max, resolution=resolution)
