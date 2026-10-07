"""Thin REST client for the deployed OpenZenith API.

Wraps the public HTTP surface (elevation, contours, profiles, hydrology,
geocoding) behind :class:`ZenithClient` plus module-level convenience
functions. Every method returns the parsed JSON body exactly as the route
returns it — this module does not reshape responses, so the docstrings below
mirror the route implementations under ``api/src/app/api/<route>/route.ts``.

Usage:
    from openzenith import ZenithClient

    client = ZenithClient()

    # Point elevation (OZT2 -> merged SRTM -> GEBCO bathymetry)
    result = client.elevation(40.7128, -74.0060)
    meters, source = result["elevation"], result["source"]

    # Batch — 1-2000 points per request
    rows = client.elevation_batch([(40.7128, -74.0060), (35.6762, 139.6503)])

    # Profile, watershed and downstream trace
    transect = client.profile(40.7, -74.0, 40.8, -73.9, samples=200)
    basin = client.watershed(40.7, -74.0)
    path = client.trace(40.7, -74.0)

    client.close()

Non-OK responses raise :class:`RestError` carrying the HTTP status and the
server's message when the body provides one; a status of ``0`` means the
request never produced an HTTP response (DNS failure, timeout, reset).

The base URL defaults to ``https://openzenith.cyopsys.com`` and may be
overridden with the ``OPENZENITH_BASE_URL`` environment variable (no trailing
``/api`` — route paths already carry it).
"""

import os
import threading
from collections.abc import Sequence
from typing import Any

import requests
from typing_extensions import Self

from .elevation import check_elevation_params, latlon_to_tile
from .exceptions import RestError

__all__ = [
    "BASE_URL_ENV",
    "DEFAULT_BASE_URL",
    "ELEVATION_BATCH_MAX_POINTS",
    "RestError",
    "ZenithClient",
    "contours",
    "contours_bbox",
    "elevation_at",
    "elevation_batch",
    "geocode",
    "profile",
    "query",
    "slope_aspect",
    "trace",
    "watershed_at",
]

#: Default deployment base URL (no trailing ``/api``).
DEFAULT_BASE_URL = "https://openzenith.cyopsys.com"

#: Environment variable that overrides the base URL.
BASE_URL_ENV = "OPENZENITH_BASE_URL"

#: Server-enforced cap on the ``POST /api/elevation/batch`` point count.
ELEVATION_BATCH_MAX_POINTS = 2000

_BATCH_PATH = "/api/elevation/batch"

_VALID_INCLUDES = ("elevation", "address", "weather", "tides", "waterways")

Point = tuple[float, float] | dict[str, Any]
"""A batch point: either a ``(lat, lon)`` tuple or a dict with ``lat``/``lon``
and an optional string ``id`` echoed back in the matching result."""


# ─── Request helpers ──────────────────────────────────────────────────────────


def _error_message(payload: Any, fallback: str) -> str:
    """Extract a human-readable message from an API error body.

    The routes use two shapes: ``{"error": "<message>"}`` (query, slope,
    aspect, profile, batch, watershed, trace, contours) and
    ``{"error": {"code": ..., "message": ...}}`` (elevation, geocode).
    """
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, str) and err:
            return err
        if isinstance(err, dict):
            message = err.get("message")
            if isinstance(message, str) and message:
                code = err.get("code")
                return f"{code}: {message}" if code else message
    return fallback


def _check_latlon(lat: float, lon: float) -> None:
    """Validate a coordinate pair against the range every route enforces."""
    if not -90.0 <= lat <= 90.0:
        raise ValueError(f"lat must be -90..90, got {lat}")
    if not -180.0 <= lon <= 180.0:
        raise ValueError(f"lon must be -180..180, got {lon}")


def _check_bbox(min_lat: float, min_lon: float, max_lat: float, max_lon: float) -> None:
    """Validate a bounding box given as (min_lat, min_lon, max_lat, max_lon)."""
    for lat in (min_lat, max_lat):
        if not -90.0 <= lat <= 90.0:
            raise ValueError(f"latitude must be -90..90, got {lat}")
    for lon in (min_lon, max_lon):
        if not -180.0 <= lon <= 180.0:
            raise ValueError(f"longitude must be -180..180, got {lon}")
    if min_lat > max_lat or min_lon > max_lon:
        raise ValueError("bbox must be ordered (min_lat, min_lon, max_lat, max_lon)")


def _params(**kwargs: Any) -> dict[str, Any]:
    """Drop None values so unset query parameters are simply not sent."""
    return {key: value for key, value in kwargs.items() if value is not None}


def _normalize_points(points: Sequence[Point]) -> list[dict[str, Any]]:
    """Convert client-side points into the batch route's ``{lat, lon, id?}`` shape."""
    count = len(points)
    if count < 1 or count > ELEVATION_BATCH_MAX_POINTS:
        raise ValueError(
            f"elevation_batch accepts 1-{ELEVATION_BATCH_MAX_POINTS} points per request, "
            f"got {count}"
        )

    body: list[dict[str, Any]] = []
    for point in points:
        if isinstance(point, dict):
            lat = point.get("lat")
            lon = point.get("lon")
            if lat is None or lon is None:
                raise ValueError("point dicts must carry 'lat' and 'lon'")
            entry: dict[str, Any] = {"lat": float(lat), "lon": float(lon)}
            if point.get("id") is not None:
                entry["id"] = point["id"]
        else:
            lat, lon = point
            entry = {"lat": float(lat), "lon": float(lon)}
        _check_latlon(entry["lat"], entry["lon"])
        body.append(entry)
    return body


# ─── Client ───────────────────────────────────────────────────────────────────


class ZenithClient:
    """Synchronous REST client for the OpenZenith API.

    Holds a ``requests.Session`` for connection reuse and is safe to share
    across threads for concurrent reads.

    Args:
        base_url: API base URL without a trailing ``/api``. Defaults to
            ``OPENZENITH_BASE_URL`` when set, else the production deployment.
        timeout: Per-request timeout in seconds (default: 30).
        session: Optional pre-built ``requests.Session`` (mainly for tests).
            When supplied the caller keeps ownership and ``close()`` is a no-op.

    Raises:
        ValueError: If ``base_url`` resolves to an empty string.

    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout: float = 30.0,
        session: requests.Session | None = None,
    ):
        """Resolve the base URL and bind (or create) the HTTP session."""
        resolved = base_url if base_url is not None else os.environ.get(BASE_URL_ENV)
        if resolved is None:
            resolved = DEFAULT_BASE_URL
        resolved = resolved.strip().rstrip("/")
        if not resolved:
            raise ValueError("base_url must be a non-empty URL")

        self.base_url = resolved
        self.timeout = timeout
        self._session = session if session is not None else requests.Session()
        self._owns_session = session is None

    # ── plumbing ──────────────────────────────────────────────────────────────

    def _url(self, path: str) -> str:
        """Join the base URL with an ``/api/...`` route path."""
        return f"{self.base_url}{path}"

    def _decode(self, response: requests.Response, url: str) -> Any:
        """Return parsed JSON, or raise RestError for a non-OK status."""
        if response.status_code >= 400:
            try:
                payload = response.json()
            except ValueError:
                payload = None
            base = f"{url} returned HTTP {response.status_code}"
            fallback = base if payload else f"{base}: {response.text[:200]}"
            raise RestError(response.status_code, _error_message(payload, fallback), url)
        try:
            return response.json()
        except ValueError as err:
            detail = f"{url} returned a non-JSON body: {err}"
            raise RestError(response.status_code, detail, url) from err

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        """GET a route and return the parsed JSON body."""
        url = self._url(path)
        try:
            response = self._session.get(url, params=params, timeout=self.timeout)
        except requests.RequestException as err:
            raise RestError(0, f"{url} failed: {err}", url) from err
        return self._decode(response, url)

    def _post(self, path: str, payload: dict[str, Any]) -> Any:
        """POST a JSON body to a route and return the parsed JSON response."""
        url = self._url(path)
        try:
            response = self._session.post(url, json=payload, timeout=self.timeout)
        except requests.RequestException as err:
            raise RestError(0, f"{url} failed: {err}", url) from err
        return self._decode(response, url)

    # ── routes ────────────────────────────────────────────────────────────────

    def query(
        self,
        lat: float,
        lon: float,
        include: Sequence[str] | None = None,
        units: str | None = None,
        forecast_days: int | None = None,
    ) -> dict[str, Any]:
        """Call ``GET /api/query`` — the unified point query endpoint.

        Args:
            lat: Latitude (-90 to 90).
            lon: Longitude (-180 to 180).
            include: Data to include. Available keys: ``elevation``,
                ``address``, ``weather``, ``tides``, ``waterways``. Defaults to
                the server default ``["elevation"]``.
            units: Temperature units, ``"metric"`` (server default) or
                ``"imperial"``.
            forecast_days: Weather forecast days, 1-7 (server default: 3).

        Returns:
            The response body::

                {
                  "location": {"lat": ..., "lon": ...},
                  "query": {"includes": [...], "units": "...", "timestamp": "..."},
                  "elevation": <number | null>,
                  "address": {...} | null,
                  "weather": {...} | null,
                  "tides": {...} | null,
                  "waterways": {"count": n, "features": [...]} | null,
                }

            Only requested includes appear as top-level keys; an include the
            server could not serve arrives as ``null`` rather than missing.

        Raises:
            RestError: On a non-OK response (400 for invalid coords/includes).
            ValueError: If lat/lon are out of range or an include is unknown.

        """
        _check_latlon(lat, lon)
        params: dict[str, Any] = {"lat": lat, "lon": lon}
        if include is not None:
            unknown = [name for name in include if name not in _VALID_INCLUDES]
            if unknown:
                valid = ", ".join(_VALID_INCLUDES)
                raise ValueError(f"Unknown include(s): {', '.join(unknown)}. Available: {valid}")
            params["include"] = ",".join(include)
        if units is not None:
            params["units"] = units
        if forecast_days is not None:
            params["forecast_days"] = forecast_days
        result: dict[str, Any] = self._get("/api/query", _params(**params))
        return result

    def elevation(
        self,
        lat: float,
        lon: float,
        datum: str | None = None,
        interpolation: str | None = None,
        units: str | None = None,
    ) -> dict[str, Any]:
        """Call ``GET /api/elevation`` — point elevation in meters.

        Args:
            lat: Latitude (-90 to 90).
            lon: Longitude (-180 to 180).
            datum: Vertical datum, ``"egm96"`` (orthometric, the SRTM native
                datum) or ``"ellipsoid"`` (heights above the WGS84 ellipsoid).
                Sent only when set.
            interpolation: Resampling method, ``"nearest"`` or ``"bilinear"``.
                Sent only when set.
            units: Response units, ``"meters"`` or ``"feet"``. Sent only when
                set.

        Returns:
            The response body::

                {
                  "requestId": "oz-...",
                  "elevation": <number | null>,
                  "surface_type": "land" | "ocean" | "unknown",
                  "unit": "meters",
                  "location": {"lat": ..., "lon": ...},
                  "source": "ozt2" | "huggingface" | "gebco2025" | "none",
                  "tile": "<tile path or empty>",
                  "resolution": <30 | 450 | 0>,
                  "metadata": {"datum": ..., "interpolation": ..., "units": ...},
                  "ok": true | false,
                }

            ``elevation`` is ``null`` with ``source: "none"`` and
            ``ok: false`` when every source (OZT2, merged SRTM, GEBCO) missed.

        Raises:
            RestError: On a non-OK response (400 invalid coords, 502 when the
                sources are unavailable).
            ValueError: If lat/lon are out of range, or a datum/interpolation/
                units value is not one the route defines.

        Note:
            The three optional parameters are validated locally and sent only
            when set. The route echoes the options it actually applied in the
            response's ``metadata`` object, so a caller can confirm the server
            honored the request rather than a default.

        """
        _check_latlon(lat, lon)
        check_elevation_params(datum=datum, interpolation=interpolation, units=units)
        result: dict[str, Any] = self._get(
            "/api/elevation",
            _params(lat=lat, lon=lon, datum=datum, interpolation=interpolation, units=units),
        )
        return result

    def elevation_batch(self, points: Sequence[Point]) -> list[dict[str, Any]]:
        """Call ``POST /api/elevation/batch`` — elevation for many points.

        Args:
            points: 1-2000 points as :data:`Point` values — ``(lat, lon)``
                tuples or dicts with ``lat``/``lon`` and an optional string
                ``id`` echoed back in each result.

        Returns:
            The route's ``results`` array — one entry per input point in input
            order, each ``{"id": <str | null>, "lat": ..., "lon": ...,
            "elevation": <number | null>}``. ``elevation`` is ``null`` where no
            tile data was available. Points are sampled at zoom 12 server-side
            and rounded to 0.1 m.

        Note:
            No ``datum``/``interpolation``/``units`` here: the batch route's
            body contract is ``{points}`` only — it takes no options object,
            always samples at zoom 12 and always returns meters.

        Raises:
            ValueError: If ``points`` is empty or exceeds
                ``ELEVATION_BATCH_MAX_POINTS`` (2000), or a point is malformed.
            RestError: On a non-OK response, including a body without a
                ``results`` array.

        """
        body = _normalize_points(points)
        response: dict[str, Any] = self._post(_BATCH_PATH, {"points": body})
        results = response.get("results", [])
        if not isinstance(results, list):
            raise RestError(
                200,
                f"{_BATCH_PATH} returned a body without a results array",
                self._url(_BATCH_PATH),
            )
        return results

    def geocode(self, q: str, limit: int = 5) -> dict[str, Any]:
        """Call ``GET /api/geocode`` — forward geocoding via Nominatim.

        Args:
            q: Free-text place query (1-200 characters).
            limit: Maximum results, 1-10 (server clamps; default: 5).

        Returns:
            The response body::

                {
                  "requestId": "oz-...",
                  "count": <int>,
                  "results": [
                    {
                      "display_name": "...",
                      "lat": <float>,
                      "lon": <float>,
                      "type": "...",
                      "importance": <float>,
                      "address": {...},
                    },
                    ...
                  ],
                }

            Note the wire parameter is ``query`` (not ``q``).

        Raises:
            RestError: On a non-OK response (400 missing/over-long query, 429
                rate limited, 502 upstream unavailable).
            ValueError: If ``q`` is empty or over 200 characters.

        """
        stripped = q.strip()
        if not stripped or len(stripped) > 200:
            raise ValueError("q must be 1-200 characters")
        clamped = max(1, min(int(limit), 10))
        result: dict[str, Any] = self._get("/api/geocode", {"query": stripped, "limit": clamped})
        return result

    def contours(self, lat: float, lon: float, zoom: int = 10) -> dict[str, Any]:
        """Call ``GET /api/contours/{z}/{x}/{y}`` — contour lines as GeoJSON.

        The deployed route is tile-shaped: it takes zoom/x/y, not a bbox, and
        it has no interval parameter. Contour intervals are derived
        server-side from the zoom level (major/minor, meters): zoom >= 10 gives
        200/50, zoom >= 8 gives 500/100, zoom >= 6 gives 1000/200, otherwise
        2000/500. Use :meth:`contours_bbox` to cover an area.

        Args:
            lat: Latitude of a point inside the wanted tile (-90 to 90).
            lon: Longitude of a point inside the wanted tile (-180 to 180).
            zoom: Tile zoom level, 4-14 (default: 10).

        Returns:
            A GeoJSON ``FeatureCollection``. Each feature is a contour
            polyline with ``properties.elevation`` (meters) and
            ``properties.type`` (``"major"`` or ``"minor"``).

        Raises:
            RestError: On a non-OK response (400 for an out-of-range tile, 502
                when elevation assembly fails).
            ValueError: If lat/lon are out of range or zoom is outside 4-14.

        """
        _check_latlon(lat, lon)
        if not 4 <= int(zoom) <= 14:
            raise ValueError("zoom must be 4-14")
        x, y = latlon_to_tile(lat, lon, int(zoom))
        return self.contours_tile(int(zoom), x, y)

    def contours_tile(self, zoom: int, x: int, y: int) -> dict[str, Any]:
        """Call ``GET /api/contours/{z}/{x}/{y}`` with explicit tile indices.

        Args:
            zoom: Tile zoom level, 4-14.
            x: Tile x index in ``[0, 2**zoom)``.
            y: Tile y index in ``[0, 2**zoom)``.

        Returns:
            A GeoJSON ``FeatureCollection`` — see :meth:`contours` for the
            feature shape.

        Raises:
            RestError: On a non-OK response.
            ValueError: If tile indices are out of range for the zoom level.

        """
        zoom = int(zoom)
        if not 4 <= zoom <= 14:
            raise ValueError("zoom must be 4-14")
        n = 2**zoom
        if not 0 <= int(x) < n or not 0 <= int(y) < n:
            raise ValueError(f"tile indices must be in [0, {n}) at zoom {zoom}")
        result: dict[str, Any] = self._get(f"/api/contours/{zoom}/{int(x)}/{int(y)}")
        return result

    def contours_bbox(
        self,
        min_lat: float,
        min_lon: float,
        max_lat: float,
        max_lon: float,
        zoom: int = 10,
    ) -> dict[str, Any]:
        """Fetch contours covering a bounding box by merging its tiles.

        Client-side convenience over the tile-shaped ``/api/contours`` route:
        resolves every tile intersecting the box at ``zoom`` and concatenates
        their features into one FeatureCollection. The interval stays
        zoom-derived — see :meth:`contours`.

        Args:
            min_lat: Southern edge in degrees.
            min_lon: Western edge in degrees.
            max_lat: Northern edge in degrees.
            max_lon: Eastern edge in degrees.
            zoom: Tile zoom level, 4-14 (default: 10). One request is made per
                covering tile, so keep the box small relative to the zoom.

        Returns:
            A GeoJSON ``FeatureCollection`` whose ``features`` are the
            concatenated features of every covering tile, in tile order.

        Raises:
            RestError: On the first non-OK tile response.
            ValueError: If the box or zoom is invalid.

        """
        _check_bbox(min_lat, min_lon, max_lat, max_lon)
        if not 4 <= int(zoom) <= 14:
            raise ValueError("zoom must be 4-14")
        z = int(zoom)
        x0, y0 = latlon_to_tile(max_lat, min_lon, z)
        x1, y1 = latlon_to_tile(min_lat, max_lon, z)

        features: list[dict[str, Any]] = []
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                tile = self.contours_tile(z, x, y)
                features.extend(tile.get("features", []))
        return {"type": "FeatureCollection", "features": features}

    def profile(
        self,
        lat1: float,
        lon1: float,
        lat2: float,
        lon2: float,
        samples: int = 100,
        zoom: int = 10,
    ) -> dict[str, Any]:
        """Call ``POST /api/profile`` — elevation along a transect.

        Args:
            lat1: Start latitude.
            lon1: Start longitude.
            lat2: End latitude.
            lon2: End longitude.
            samples: Point count along the line. Sent as ``num_points``; the
                server clamps to 2-1000 (route default: 100).
            zoom: Sampling zoom level; the server clamps to 5-14 (default: 10).

        Returns:
            The response body::

                {
                  "start": {"lat": ..., "lon": ...},
                  "end": {"lat": ..., "lon": ...},
                  "num_points": <int>,
                  "zoom": <int>,
                  "stats": {"min": .., "max": .., "total_gain": ..,
                            "total_dist": ..} | null,
                  "profile": [
                    {"distance_m": .., "elevation": .., "lat": .., "lon": ..},
                    ...
                  ],
                }

            ``stats`` is ``null`` when no sample exceeded the NODATA sentinel.

        Raises:
            RestError: On a non-OK response (400 missing/invalid coords, 502).
            ValueError: If an endpoint is out of range.

        """
        _check_latlon(lat1, lon1)
        _check_latlon(lat2, lon2)
        payload = {
            "lat1": lat1,
            "lon1": lon1,
            "lat2": lat2,
            "lon2": lon2,
            "num_points": int(samples),
            "zoom": int(zoom),
        }
        result: dict[str, Any] = self._post("/api/profile", payload)
        return result

    def watershed(
        self,
        lat: float,
        lon: float,
        zoom: int = 10,
        radius_cells: int = 100,
    ) -> dict[str, Any]:
        """Call ``POST /api/watershed`` — upstream area from a pour point.

        Args:
            lat: Pour point latitude.
            lon: Pour point longitude.
            zoom: Sampling zoom level (route default: 10).
            radius_cells: Grid radius in cells; the server clamps to 10-200
                (route default: 100).

        Returns:
            The response body::

                {
                  "center": [lat, lon],
                  "area_km2": <float>,
                  "pixels": <int>,
                  "min_elev": <int | null>,
                  "max_elev": <int | null>,
                  "mean_elev": <int | null>,
                  "zoom": <int>,
                  "cell_size_deg": <float>,
                  "boundary": [[lat, lon], ...],
                  "geojson": {"type": "FeatureCollection", "features": [...]},
                }

            ``boundary`` holds at most 2000 vertices.

        Raises:
            RestError: On a non-OK response (400 missing/invalid coords, 502).
            ValueError: If lat/lon are out of range.

        """
        _check_latlon(lat, lon)
        payload = {"lat": lat, "lon": lon, "zoom": int(zoom), "radius_cells": int(radius_cells)}
        result: dict[str, Any] = self._post("/api/watershed", payload)
        return result

    def trace(
        self,
        lat: float,
        lon: float,
        zoom: int = 10,
        max_steps: int = 1000,
    ) -> dict[str, Any]:
        """Call ``POST /api/trace`` — follow the flow path to the ocean.

        Args:
            lat: Start latitude.
            lon: Start longitude.
            zoom: Sampling zoom level (route default: 10).
            max_steps: Step budget; the server clamps to 1-10000 (route
                default: 1000).

        Returns:
            The response body::

                {
                  "start": [lat, lon],
                  "end": [lat, lon],
                  "start_elev": <float>,
                  "end_elev": <float>,
                  "total_distance": <int meters>,
                  "steps": <int>,
                  "path": [[lat, lon], ...],
                  "elevations": [<float>, ...],
                  "distances": [<float>, ...],
                  "geojson": {"type": "Feature",
                              "geometry": {"type": "LineString", ...},
                              "properties": {...}},
                }

        Raises:
            RestError: On a non-OK response (400 missing/invalid coords, 502).
            ValueError: If lat/lon are out of range.

        """
        _check_latlon(lat, lon)
        payload = {"lat": lat, "lon": lon, "zoom": int(zoom), "max_steps": int(max_steps)}
        result: dict[str, Any] = self._post("/api/trace", payload)
        return result

    def slope_aspect(
        self,
        lat: float,
        lon: float,
        radius: int = 50,
        zoom: int = 10,
    ) -> dict[str, Any]:
        """Compose ``GET /api/slope`` and ``GET /api/aspect`` for one point.

        Args:
            lat: Center latitude.
            lon: Center longitude.
            radius: Grid radius in cells; the server clamps to 1-200 (route
                default: 50).
            zoom: Tile zoom level; the server clamps to 5-14 (default: 10).

        Returns:
            ``{"slope": <slope body>, "aspect": <aspect body>}`` where each
            body carries ``center``, ``bounds`` (``latMin``/``latMax``/
            ``lonMin``/``lonMax``), ``radius_cells``, ``zoom``,
            ``cell_size_deg``, ``stats`` and a sampled ``grid``. Slope is in
            degrees (0-90); aspect is a compass direction with 0=N, 90=E,
            180=S, 270=W and -1 for flat, plus ``direction_bins`` and
            ``valid_cells``. Border and NODATA cells are ``null``.

        Raises:
            RestError: On a non-OK response from either route.
            ValueError: If lat/lon are out of range.

        """
        _check_latlon(lat, lon)
        params = _params(lat=lat, lon=lon, radius=int(radius), zoom=int(zoom))
        slope = self._get("/api/slope", params)
        aspect = self._get("/api/aspect", params)
        return {"slope": slope, "aspect": aspect}

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the underlying session (no-op for caller-owned sessions)."""
        if self._owns_session:
            self._session.close()

    def __enter__(self) -> Self:
        """Return self so the client can be used as a context manager."""
        return self

    def __exit__(self, *_exc: object) -> None:
        """Close the session on exit."""
        self.close()


# ─── Module-level convenience functions ───────────────────────────────────────

_SHARED_CLIENT: ZenithClient | None = None
_SHARED_CLIENT_LOCK = threading.Lock()


def _shared_client() -> ZenithClient:
    """Return the process-wide client used by the module-level functions."""
    global _SHARED_CLIENT
    if _SHARED_CLIENT is None:
        with _SHARED_CLIENT_LOCK:
            if _SHARED_CLIENT is None:
                _SHARED_CLIENT = ZenithClient()
    return _SHARED_CLIENT


def query(
    lat: float,
    lon: float,
    include: Sequence[str] | None = None,
    units: str | None = None,
    forecast_days: int | None = None,
    client: ZenithClient | None = None,
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.query`."""
    return (client or _shared_client()).query(lat, lon, include, units, forecast_days)


def elevation_at(
    lat: float,
    lon: float,
    datum: str | None = None,
    interpolation: str | None = None,
    units: str | None = None,
    client: ZenithClient | None = None,
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.elevation`.

    Suffixed ``_at`` because the bare name ``openzenith.elevation`` is the
    package's local-tile elevation module.
    """
    return (client or _shared_client()).elevation(lat, lon, datum, interpolation, units)


def elevation_batch(
    points: Sequence[Point], client: ZenithClient | None = None
) -> list[dict[str, Any]]:
    """Module-level :meth:`ZenithClient.elevation_batch`."""
    return (client or _shared_client()).elevation_batch(points)


def geocode(q: str, limit: int = 5, client: ZenithClient | None = None) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.geocode`."""
    return (client or _shared_client()).geocode(q, limit)


def contours(
    lat: float, lon: float, zoom: int = 10, client: ZenithClient | None = None
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.contours`."""
    return (client or _shared_client()).contours(lat, lon, zoom)


def contours_bbox(
    min_lat: float,
    min_lon: float,
    max_lat: float,
    max_lon: float,
    zoom: int = 10,
    client: ZenithClient | None = None,
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.contours_bbox`."""
    return (client or _shared_client()).contours_bbox(min_lat, min_lon, max_lat, max_lon, zoom)


def profile(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    samples: int = 100,
    zoom: int = 10,
    client: ZenithClient | None = None,
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.profile`."""
    return (client or _shared_client()).profile(lat1, lon1, lat2, lon2, samples, zoom)


def watershed_at(
    lat: float,
    lon: float,
    zoom: int = 10,
    radius_cells: int = 100,
    client: ZenithClient | None = None,
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.watershed`.

    Suffixed ``_at`` because ``openzenith.watershed`` is the local-tile
    hydrology function.
    """
    return (client or _shared_client()).watershed(lat, lon, zoom, radius_cells)


def trace(
    lat: float,
    lon: float,
    zoom: int = 10,
    max_steps: int = 1000,
    client: ZenithClient | None = None,
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.trace`."""
    return (client or _shared_client()).trace(lat, lon, zoom, max_steps)


def slope_aspect(
    lat: float,
    lon: float,
    radius: int = 50,
    zoom: int = 10,
    client: ZenithClient | None = None,
) -> dict[str, Any]:
    """Module-level :meth:`ZenithClient.slope_aspect`."""
    return (client or _shared_client()).slope_aspect(lat, lon, radius, zoom)
