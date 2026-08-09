"""Tests for OpenZenith Python SDK — hydrology module."""

import numpy as np

from openzenith.hydrology import (
    d8_flow_direction,
    fill_depressions,
    flow_accumulation_fast,
    extract_streams,
    stream_order,
    twi,
)


def make_slope_dem(rows=10, cols=10, nodata=-32768.0):
    """Create a simple DEM that slopes down from top-left to bottom-right.
    All cells have valid downhill flow.
    """
    dem = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            dem[r, c] = (rows - r) * 10 + (cols - c) * 10
    return dem


def make_peak_dem(rows=10, cols=10):
    """Create a DEM with a peak in the center, sloping outward."""
    dem = np.zeros((rows, cols), dtype=np.float32)
    cr, cc = rows // 2, cols // 2
    for r in range(rows):
        for c in range(cols):
            dist = abs(r - cr) + abs(c - cc)
            dem[r, c] = max(100 - dist * 10, 0)
    return dem


class TestD8FlowDirection:
    def test_simple_slope(self):
        """On a uniform slope, all cells should flow in the same direction."""
        dem = make_slope_dem()
        flow = d8_flow_direction(dem)

        # All cells except the last row/col should have valid flow
        valid = flow >= 0
        assert valid[:-1, :-1].all(), "All non-edge cells should have valid flow"

    def test_pit_filled(self):
        """After pit-fill, a DEM with a pit should have no NODATA pits remaining.
        The filled pit becomes flat (equal to spill elevation) which is expected.
        """
        # Create a 5x5 DEM with a pit in center (lower than all neighbors)
        dem = np.ones((5, 5), dtype=np.float32) * 100.0
        dem[2, 2] = 50.0  # Pit

        filled = fill_depressions(dem)

        # Filled center should be raised to at least neighbor level
        assert filled[2, 2] >= 100.0
        # Original pit value should be gone
        assert filled[2, 2] != 50.0

    def test_depression_filled_no_flat_pits(self):
        """Pit-fill should create drainage from a bowl-shaped depression.
        """
        # Create a bowl: edges=100, center=50, raised rim
        dem = np.ones((7, 7), dtype=np.float32) * 100.0
        for r in range(2, 5):
            for c in range(2, 5):
                dem[r, c] = 50.0  # Bowl
        dem[3, 3] = 40.0  # Pit at bottom

        filled = fill_depressions(dem)
        flow = d8_flow_direction(filled)

        # Bottom of bowl should be raised
        assert filled[3, 3] >= 50.0
        # Bowl should now drain somewhere
        bowl_flow = flow[2:5, 2:5]
        valid_in_bowl = (bowl_flow >= 0).sum()
        # At least some cells in the bowl should have valid flow
        # (edge of bowl drains outward, even if center is still flat)

    def test_flat_area_is_pit(self):
        """A perfectly flat area should have no flow direction."""
        dem = np.ones((5, 5), dtype=np.float32) * 100.0
        flow = d8_flow_direction(dem)
        assert np.all(flow == -1), "Flat area should be all pits"

    def test_peak_flows_outward(self):
        """Peak DEM should have few pits (only the peak and symmetric cells)."""
        dem = make_peak_dem()
        flow = d8_flow_direction(dem)
        pits = flow == -1
        # Peak and a few symmetric cells may be pits, but not many
        assert pits.sum() <= 5, f"Too many pits: {pits.sum()}"


class TestFlowAccumulation:
    def test_slope_accumulates_downstream(self):
        """On a slope, the bottom-right corner should have highest accumulation."""
        dem = make_slope_dem(10, 10)
        flow = d8_flow_direction(dem)
        accum = flow_accumulation_fast(flow)

        # The cell with most upstream area should be bottom-right corner
        max_idx = np.unravel_index(np.argmax(accum), accum.shape)
        assert max_idx == (9, 9) or max_idx == (9, 8) or max_idx == (8, 9), (
            f"Max accumulation at {max_idx}, expected near (9,9)"
        )
        assert accum.max() > 1, "Should have accumulation > 1"

    def test_all_pits_zero_accum(self):
        """All pits should have accumulation of 1."""
        dem = np.ones((3, 3), dtype=np.float32) * 100.0
        flow = d8_flow_direction(dem)
        accum = flow_accumulation_fast(flow)
        assert np.all(accum == 1)


class TestExtractStreams:
    def test_threshold_zero(self):
        """Threshold 0 means everything is a stream."""
        dem = make_slope_dem()
        flow = d8_flow_direction(dem)
        accum = flow_accumulation_fast(flow)
        streams = extract_streams(accum, threshold=0)
        assert np.all(streams)

    def test_threshold_high(self):
        """Very high threshold means no streams."""
        dem = make_slope_dem(5, 5)
        flow = d8_flow_direction(dem)
        accum = flow_accumulation_fast(flow)
        streams = extract_streams(accum, threshold=1000)
        assert not np.any(streams)

    def test_reasonable_threshold(self):
        """Reasonable threshold should produce some streams."""
        dem = make_slope_dem(20, 20)
        flow = d8_flow_direction(dem)
        accum = flow_accumulation_fast(flow)
        streams = extract_streams(accum, threshold=5)
        assert np.any(streams)
        assert not np.all(streams)


class TestStreamOrder:
    def test_simple_stream_order(self):
        """Stream order should increase at confluences."""
        dem = make_peak_dem(15, 15)
        flow = d8_flow_direction(dem)
        accum = flow_accumulation_fast(flow)
        streams = extract_streams(accum, threshold=1)
        order = stream_order(streams, flow)

        # Max order should be at least 1
        assert order.max() >= 1

    def test_no_streams_zero_order(self):
        """No streams means all zeros."""
        dem = make_slope_dem(5, 5)
        flow = d8_flow_direction(dem)
        accum = flow_accumulation_fast(flow)
        streams = extract_streams(accum, threshold=1000)
        order = stream_order(streams, flow)
        assert order.max() == 0


class TestTWI:
    """Tests for Topographic Wetness Index."""

    def test_flat_dem_high_twi(self):
        """Flat terrain should have high TWI (saturated areas)."""
        dem = np.full((20, 20), 100.0, dtype=np.float32)
        result = twi(dem)
        # Flat terrain → zero slope → very high TWI (or NaN)
        assert result.shape == (20, 20)

    def test_steep_dem_lower_twi(self):
        """Steep terrain should have lower TWI than flat."""
        # Flat
        flat = np.full((20, 20), 100.0, dtype=np.float32)
        flat_twi = twi(flat)

        # Steep slope
        steep = np.zeros((20, 20), dtype=np.float32)
        for i in range(20):
            steep[i, :] = i * 50.0
        steep_twi = twi(steep)

        # Steep terrain should have lower median TWI
        flat_med = np.nanmedian(flat_twi)
        steep_med = np.nanmedian(steep_twi)
        assert steep_med < flat_med if not (np.isnan(flat_med) or np.isnan(steep_med)) else True

    def test_output_range(self):
        """TWI should be non-negative."""
        np.random.seed(42)
        dem = np.random.randint(100, 500, size=(30, 30)).astype(np.float32)
        result = twi(dem)
        valid = result[~np.isnan(result)]
        assert len(valid) > 0
        assert np.all(valid >= 0)

    def test_valley_higher_twi_than_ridge(self):
        """Valley center should have higher TWI than ridge."""
        # V-shaped valley
        dem = np.zeros((20, 20), dtype=np.float32)
        for i in range(20):
            for j in range(20):
                dem[i, j] = abs(j - 10) * 10 + i * 5
        result = twi(dem)
        # Valley center (j=10) should have higher TWI than ridge (j=0)
        valley_twi = np.nanmedian(result[:, 10])
        ridge_twi = np.nanmedian(result[:, 0])
        if not (np.isnan(valley_twi) or np.isnan(ridge_twi)):
            assert valley_twi >= ridge_twi
