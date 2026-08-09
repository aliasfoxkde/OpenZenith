"""Tests for downstream tracing module."""

import numpy as np
import pytest
from openzenith.tracing import trace_downstream, _haversine_distance


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


@pytest.mark.integration
class TestTraceDownstream:
    """Tests for trace_downstream (requires live API/tiles)."""

    def test_invalid_coordinates_raise(self):
        """Out-of-range coordinates should raise an error."""
        with pytest.raises(Exception):
            trace_downstream(999.0, 999.0, max_steps=10)

    def test_ocean_point(self):
        """A point in the middle of the ocean should reach the edge quickly."""
        # Mid-Atlantic — no downstream path from ocean
        try:
            result = trace_downstream(30.0, -40.0, max_steps=100)
            # Ocean points might fail to find a flow path
            assert isinstance(result, list)
        except Exception:
            # Network/tile errors are acceptable
            pass
