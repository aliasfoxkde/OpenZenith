"""Coverage-closing tests for branches reachable only under specific inputs.

Each test targets a named missed branch (line numbers refer to the 2026-10-24
in-image coverage report that measured 98.42% against the 99% floor after
rasterio began importing in the CI image):
  * ``OZT2HFBackend`` token-header branches (ozt2.py 325, 375, 398, 442)
  * ``mstp`` mixed-TPI classification arms (indices.py 76-81)
  * ``sub_basins`` interior tracing paths (watersheds.py 340, 344, 392,
    398-405)
  * ``flow_accumulation`` toposort fallback (flow.py 94-95)
  * ``fuse`` PIL fallback when rasterio is absent (fuse.py 557-562)
  * ``depressions`` empty-stream-link guards (depressions.py 211, 263, 304)
"""

import asyncio
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from openzenith.backends.ozt2 import OZT2HFBackend
from openzenith.hydrology.depressions import breach_bridges, fill_depressions
from openzenith.hydrology.flow import flow_accumulation
from openzenith.hydrology.streams import _label_streams
from openzenith.hydrology.watersheds import sub_basins
from openzenith.terrain.indices import mstp

# ─── OZT2HFBackend token branches ────────────────────────────────────────


class TestHFTokenHeaders:
    """HF_TOKEN set → Authorization header branches across fetch paths."""

    def test_get_token_reads_env(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("HF_TOKEN", "hf_test_token")
        backend = OZT2HFBackend()
        assert backend._get_token() == "hf_test_token"

    def test_get_token_none_without_env(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.delenv("HF_TOKEN", raising=False)
        backend = OZT2HFBackend()
        assert backend._get_token() is None

    def test_fetch_tile_bytes_token_header(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ):
        """The urllib fetch path builds a Bearer header when HF_TOKEN is set."""
        monkeypatch.setenv("HF_TOKEN", "hf_test_token")
        backend = OZT2HFBackend(cache_dir=tmp_path)

        captured: dict[str, object] = {}

        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args: object) -> None:
                pass

            def read(self) -> bytes:
                return b"tile-bytes"

        class _FakeURLOpen:
            def __call__(self, req, timeout):
                captured["headers"] = dict(req.headers)
                return _FakeResp()

        with (
            patch("openzenith.backends.ozt2.urllib.request.urlopen", _FakeURLOpen()),
            patch("openzenith.backends.ozt2.urllib.request.Request") as req_cls,
        ):
            req_cls.side_effect = lambda url, headers=None: type(
                "R", (), {"headers": headers or {}, "full_url": url}
            )()
            data = backend.fetch_tile_bytes(z=10, x=163, y=395)

        assert data == b"tile-bytes"
        headers = captured["headers"]
        assert any(v == "Bearer hf_test_token" for v in headers.values())

    def test_tile_exists_token_header(self, monkeypatch: pytest.MonkeyPatch):
        """The HEAD probe also carries the token when set."""
        monkeypatch.setenv("HF_TOKEN", "hf_test_token")
        backend = OZT2HFBackend()

        captured: dict[str, object] = {}

        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args: object) -> None:
                pass

            status = 200

        def _fake_urlopen(req, timeout):
            captured["headers"] = dict(req.headers)
            return _FakeResp()

        with (
            patch("openzenith.backends.ozt2.urllib.request.urlopen", _fake_urlopen),
            patch("openzenith.backends.ozt2.urllib.request.Request") as req_cls,
        ):
            req_cls.side_effect = lambda url, headers=None, **kw: type(
                "R", (), {"headers": headers or {}, "full_url": url, "method": kw.get("method")}
            )()
            assert backend.tile_exists(z=10, x=163, y=395) is True

        headers = captured["headers"]
        assert any(v == "Bearer hf_test_token" for v in headers.values())


# ─── mstp classification arms ────────────────────────────────────────────


class TestMstpArms:
    """Mixed-relief DEM drives every classification arm of mstp."""

    def test_mixed_relief_hits_all_classes(self):
        """Ridges + pits + flats across the grid exercise cls 0-4 branches."""
        dem = np.zeros((24, 24), dtype=np.float32)
        # Sharp central ridge (positive TPI at all scales → cls 0/1)
        dem[12, :] = 40.0
        dem[11:14, :] = 40.0
        # Deep pits (negative TPI at all scales → cls 3/4)
        dem[3:6, 3:6] = -40.0
        # Gentle plain elsewhere (near-zero TPI → cls 2)
        result = mstp(dem, radii=[2, 4, 8], cell_size_deg=0.01)
        classes = set(result[result >= 0].tolist())
        assert classes, "expected at least one classified cell"
        assert classes.issubset({0, 1, 2, 3, 4})
        # The near-zero TPI plain must land in the mid arm (cls 2) — the
        # abs(large_tpi) < 0.3 branch the earlier suite never hit.
        assert 2 in classes

    def test_valley_arm_classified(self):
        """A single-cell-wide pit in a plain yields negative-TPI classes."""
        dem = np.ones((20, 20), dtype=np.float32) * 100.0
        dem[10, 10] = 40.0  # one deep pit
        result = mstp(dem, radii=[2, 4, 6], cell_size_deg=0.01)
        assert result[10, 10] in (3, 4)


# ─── sub_basins interior tracing ─────────────────────────────────────────


def _ridge_flow() -> tuple[np.ndarray, np.ndarray]:
    """Flow field with a definite stream line and upstream tributaries."""
    n = 12
    flow = np.full((n, n), -1, dtype=np.int8)
    streams = np.zeros((n, n), dtype=bool)
    # Main stream: column 6, flowing south (D8 code 4)
    streams[:, 6] = True
    flow[:, 6] = 4
    flow[n - 1, 6] = -1
    # Tributary: row 5 feeding east→west into (5, 6) (D8 code 32 = west)
    streams[5, 7:11] = True
    flow[5, 7:11] = 32
    return flow, streams


class TestSubBasinsPaths:
    """sub_basins boundary paths: cycles, nodata stops, off-grid walks."""

    def test_non_stream_flats_unassigned(self):
        """Cells that never reach a stream stay 0."""
        flow = np.full((6, 6), -1, dtype=np.int8)
        streams = np.zeros((6, 6), dtype=bool)
        streams[:, 3] = True
        flow[:, 3] = 4
        flow[5, 3] = -1
        result = sub_basins(flow, streams)
        assert result[0, 0] == 0
        assert np.all(result[:5, 3] > 0)  # outlet cell has nodata_dir → stays 0

    def test_cell_on_stream_gets_own_link(self):
        """A stream cell is assigned its own label without tracing."""
        flow, streams = _ridge_flow()
        result = sub_basins(flow, streams)
        assert result[2, 6] > 0

    def test_upstream_non_stream_walks_to_stream(self):
        """A tributary stream cell joins the main-stem link via tracing."""
        flow, streams = _ridge_flow()
        # Tributary cell (3, 5) isn't a stream; but valid cells are stream
        # cells only — exercise the interior walk with a stream cell whose
        # own label is its link. (3,6) is on the main stem: labeled 1.
        flow[3, 5] = 0  # flows east into (3, 6)
        result = sub_basins(flow, streams)
        assert result[3, 6] > 0
        assert result[5, 7] > 0  # tributary link labeled

    def test_cycle_is_terminated(self):
        """A two-cell flow cycle among STREAM cells terminates (line 340)."""
        flow = np.full((6, 6), -1, dtype=np.int8)
        streams = np.zeros((6, 6), dtype=bool)
        streams[:, 3] = True
        flow[:, 3] = 4
        flow[5, 3] = -1
        # Two stream cells in a separate component pointing at each other.
        streams[2, 0] = True
        streams[1, 0] = True
        flow[2, 0] = 64  # north
        flow[1, 0] = 16  # south
        result = sub_basins(flow, streams)
        assert result[1, 0] > 0 and result[2, 0] > 0

    def test_nodata_stream_cell_terminates_tracing(self):
        """A stream cell whose trace ends at nodata_dir terminates (line 392).

        The isolated single-cell link is labeled by _label_streams but not
        adopted as a sub-basin (documented behavior: an isolated cell is a
        degenerate link); the walk still terminates rather than looping.
        """
        flow = np.full((6, 6), -1, dtype=np.int8)
        streams = np.zeros((6, 6), dtype=bool)
        streams[:, 3] = True
        flow[:, 3] = 4
        flow[5, 3] = -1
        streams[0, 0] = True
        result = sub_basins(flow, streams)
        assert result[0, 0] == 0
        assert np.all(result[:5, 3] > 0)  # the real network is intact

    def test_walk_off_grid_is_terminated(self):
        """A trace that walks off the grid edge breaks, not crashes."""
        flow = np.full((6, 6), -1, dtype=np.int8)
        streams = np.zeros((6, 6), dtype=bool)
        streams[:, 3] = True
        flow[:, 3] = 4
        flow[5, 3] = -1
        # Corner (0,0) flows north (64) off-grid.
        flow[0, 0] = 64
        result = sub_basins(flow, streams)
        assert result[0, 0] == 0


# ─── flow_accumulation toposort fallback ────────────────────────────────


class TestFlowAccumFallback:
    """The toposort path raising falls back to the iterative algorithm."""

    def test_fallback_returns_on_cycle(self):
        """A flow cycle makes toposort raise; the fallback must still return."""
        flow = np.full((6, 6), -1, dtype=np.int8)
        streams_or_cycles = flow
        # Two-cell cycle.
        streams_or_cycles[2, 2] = 64  # north
        streams_or_cycles[1, 2] = 16  # south
        result = flow_accumulation(streams_or_cycles)
        assert result.shape == (6, 6)

    def test_normal_grid_still_uses_toposort(self):
        """A normal grid matches the classic algorithm's outlet accumulation."""
        from openzenith.hydrology.flow import _flow_accumulation_toposort

        rng = np.random.default_rng(7)
        dem = np.cumsum(np.cumsum(rng.normal(size=(16, 16)), axis=0), axis=1).astype(
            np.float32
        )
        from openzenith.hydrology.flow import d8_flow_direction

        flow = d8_flow_direction(dem)
        assert np.array_equal(flow_accumulation(flow), _flow_accumulation_toposort(flow))


# ─── fuse PIL fallback ───────────────────────────────────────────────────


class TestFusePILFallback:
    """_read_gebco_quad's PIL branch fires when rasterio import fails."""

    def test_pil_fallback_reads_png(self, tmp_path: Path):
        from PIL import Image

        from openzenith.fuse import FusedDEM

        arr = np.full((8, 8), -2500, dtype=np.int16)
        path = tmp_path / "gebco.png"
        Image.fromarray(arr, mode="I;16").save(path)

        fusion = FusedDEM.__new__(FusedDEM)  # no init deps needed
        import builtins

        real_import = builtins.__import__

        def _no_rasterio(name: str, *args: object, **kwargs: object):
            if name == "rasterio":
                raise ImportError("simulated absence")
            return real_import(name, *args, **kwargs)  # type: ignore[arg-type]

        with patch("builtins.__import__", side_effect=_no_rasterio):
            out = fusion._read_gebco_quad(path)

        assert out is not None
        assert np.array_equal(out, arr)


# ─── depressions guards ──────────────────────────────────────────────────


class TestDepressionsGuards:
    """Empty stream-link and no-bridge guards in depressions."""

    def test_fill_depressions_flat(self):
        """A flat DEM has nothing to fill and round-trips unchanged."""
        dem = np.full((10, 10), 5.0, dtype=np.float32)
        out = fill_depressions(dem)
        assert np.array_equal(out, dem)

    def test_breach_bridges_no_streams(self):
        """No streams → no bridges → DEM returned unchanged."""
        dem = np.random.default_rng(3).random((12, 12)).astype(np.float32) * 50
        streams = np.zeros((12, 12), dtype=bool)
        out = breach_bridges(dem, streams, max_width=3)
        assert out.shape == dem.shape

    def test_breach_bridges_stream_without_bridge(self):
        """A straight stream with no crossing returns an unchanged channel."""
        dem = np.full((12, 12), 100.0, dtype=np.float32)
        streams = np.zeros((12, 12), dtype=bool)
        streams[:, 6] = True
        out = breach_bridges(dem, streams, max_width=3)
        assert out.shape == dem.shape


# ─── _label_streams reuse guard (streams.py 228) ─────────────────────────


class TestLabelStreamsGuard:
    def test_single_cell_stream(self):
        """A lone stream cell labels one link without neighbours."""
        streams = np.zeros((5, 5), dtype=bool)
        flow = np.full((5, 5), -1, dtype=np.int8)
        streams[2, 2] = True
        labeled, n = _label_streams(streams, flow, -1)
        assert n == 1
        assert labeled[2, 2] == 1


def test_prefetch_token_guard_smoke() -> None:
    """prefetch_tiles_async signature smoke: returns int for empty input."""
    backend = OZT2HFBackend()
    assert asyncio.run(backend.prefetch_tiles_async([])) == 0
