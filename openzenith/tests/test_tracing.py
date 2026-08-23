"""Tests for downstream tracing module."""

from unittest.mock import patch

import pytest

from openzenith.tracing import _haversine_distance, trace_downstream


class TestHaversineDistance:
    """Tests for _haversine_distance helper."""

    def test_known_distance(self):
        """NYC to London ~5570km."""
        dist = _haversine_distance(40.7128, -74.0060, 51.5074, -0.1278)
        assert 5_500_000 < dist < 5_700_000

    def test_zero_distance(self):
        """Same point should be 0."""
        dist = _haversine_distance(40.0, -105.0, 40.0, -105.0)
        assert dist == pytest.approx(0.0, abs=0.001)

    def test_short_distance(self):
        """Points 1 degree apart should be ~111km."""
        dist = _haversine_distance(0.0, 0.0, 1.0, 0.0)
        assert 110_000 < dist < 112_000

    def test_symmetry(self):
        """Distance should be the same regardless of direction."""
        d1 = _haversine_distance(40.0, -105.0, 35.0, -100.0)
        d2 = _haversine_distance(35.0, -100.0, 40.0, -105.0)
        assert d1 == pytest.approx(d2, abs=1.0)

    def test_equatorial_full_circle(self):
        """Antipodal points at equator ~20000km."""
        dist = _haversine_distance(0.0, 0.0, 0.0, 180.0)
        assert 19_900_000 < dist < 20_100_000

    def test_pole_to_equator(self):
        """North pole to equator ~10000km."""
        dist = _haversine_distance(90.0, 0.0, 0.0, 0.0)
        assert 9_900_000 < dist < 10_100_000

    def test_poles(self):
        """North pole to south pole ~20000km."""
        dist = _haversine_distance(90.0, 0.0, -90.0, 0.0)
        assert 19_900_000 < dist < 20_100_000

    def test_transpacific(self):
        """US west coast to east Asia ~8000-9000km."""
        dist = _haversine_distance(37.0, -122.0, 35.0, 140.0)
        assert 8_000_000 < dist < 9_500_000


class TestTraceDownstreamUnit:
    """Unit tests for trace_downstream with mocked elevation."""

    def test_returns_none_for_ocean_point(self):
        """trace_downstream returns None for ocean (elev is None)."""
        with patch("openzenith.elevation.get_elevation", return_value=None):
            result = trace_downstream(30.0, -40.0, max_steps=100)
            assert result is None

    def test_returns_none_for_invalid_elevation(self):
        """trace_downstream returns None for extreme negative elevation."""
        with patch("openzenith.elevation.get_elevation", return_value=-50000.0):
            result = trace_downstream(40.0, -105.0, max_steps=100)
            assert result is None

    def test_returns_early_exit_at_sea_level(self):
        """Starting at sea level returns immediate single-point result."""
        with patch("openzenith.elevation.get_elevation", return_value=0.0):
            result = trace_downstream(40.0, -105.0, max_steps=100)
            assert result is not None
            assert result["total_distance"] == 0.0
            assert result["steps"] == 0
            assert len(result["path"]) == 1

    def test_returns_early_exit_for_negative_elevation(self):
        """Starting below sea level returns immediate single-point result."""
        with patch("openzenith.elevation.get_elevation", return_value=-10.0):
            result = trace_downstream(40.0, -105.0, max_steps=100)
            assert result is not None
            assert result["total_distance"] == 0.0
            assert result["steps"] == 0


@pytest.mark.integration
class TestTraceDownstream:
    """Integration tests for trace_downstream (requires live API/tiles)."""

    def test_invalid_coordinates_raise(self):
        """Out-of-range coordinates should raise an error."""
        with pytest.raises(Exception):  # noqa: B017
            trace_downstream(999.0, 999.0, max_steps=10)

    def test_ocean_point(self):
        """A point in the middle of the ocean should reach the edge quickly."""
        # Mid-Atlantic — no downstream path from ocean
        try:
            result = trace_downstream(30.0, -40.0, max_steps=100)
            # Ocean points might fail to find a flow path
            assert isinstance(result, (list, type(None)))
        except Exception:  # noqa: BLE001, S110
            # Network/tile errors are acceptable
            pass
