"""Tests for openzenith.hydrology.channels — channel geometry and corridors.

Fixtures are hand-built grids so every expected value is derivable by hand.
The cell size is hard-coded in ``channels`` at 0.001 degrees, i.e.
``CELL_M = 0.001 * 111320.0 = 111.32`` metres per cell.
"""

import numpy as np
import pytest

from openzenith.hydrology.channels import (
    average_distributary_slope,
    cross_section,
    depth_to_water,
    elevation_above_stream,
    stream_gradients,
)

NODATA = -32768.0
CELL_M = 111.32


def _flow_west(rows: int, cols: int) -> np.ndarray:
    """Every cell holds an undefined D8 code (-1).

    ``cross_section`` coerces an undefined code to 0 (east), so the
    perpendicular section runs north-south at the stream column.
    """
    return np.full((rows, cols), -1, dtype=np.int8)


class TestCrossSection:
    """cross_section geometry on hand-built profiles."""

    def test_truncated_section_reports_zero_geometry(self):
        """Fewer than three valid samples short-circuits to the zero dict.

        The stream cell sits on the top row, so the sample one row north is
        off-grid and only two elevations survive.
        """
        dem = np.full((4, 9), 200.0, dtype=np.float32)
        result = cross_section(dem, 0, 4, _flow_west(4, 9), half_width=1)

        assert set(result) == {
            "distances_m",
            "elevations",
            "width_m",
            "max_depth_m",
            "cross_section_area_m2",
            "hydraulic_radius_m",
        }
        assert result["distances_m"] == [0.0, pytest.approx(CELL_M)]
        assert result["elevations"] == [200.0, 200.0]
        assert result["width_m"] == 0.0
        assert result["max_depth_m"] == 0.0
        assert result["cross_section_area_m2"] == 0.0
        assert result["hydraulic_radius_m"] == 0.0

    def test_banks_adjacent_to_center_collapse_width_and_area(self):
        """A section that drops >2 m on both sides of the centre has no banks.

        Both bank probes fire one cell out from the centre, so the left and
        right bank indices meet on the centre cell: zero width, zero wetted
        perimeter, and therefore a zero hydraulic radius.
        """
        dem = np.full((6, 9), 200.0, dtype=np.float32)
        dem[1, 4] = 80.0
        dem[2, 4] = 100.0
        dem[3, 4] = 80.0

        result = cross_section(dem, 2, 4, _flow_west(6, 9), half_width=1)

        assert result["elevations"] == [80.0, 100.0, 80.0]
        assert result["bank_elevation_m"] == pytest.approx(100.0)
        assert result["channel_center_elevation_m"] == pytest.approx(100.0)
        assert result["width_m"] == 0.0
        assert result["max_depth_m"] == 0.0
        assert result["cross_section_area_m2"] == 0.0
        assert result["hydraulic_radius_m"] == 0.0

    def test_wide_channel_width_depth_and_bank_elevation(self):
        """Width, max depth, and bank elevation are pinned for a wide channel.

        Section elevations (north to south): 200, 190, 96, 90, 96, 190, 200.
        The bank probe walks outward from the centre looking for a cell more
        than 2 m *below* the centre, so it never fires here and the banks stay
        at the section ends.
        """
        dem = np.full((9, 9), 200.0, dtype=np.float32)
        for row, elev in {0: 200, 1: 190, 2: 96, 3: 90, 4: 96, 5: 190, 6: 200}.items():
            dem[row, 4] = elev

        result = cross_section(dem, 3, 4, _flow_west(9, 9), half_width=3)

        assert result["distances_m"] == [
            pytest.approx(-3 * CELL_M),
            pytest.approx(-2 * CELL_M),
            pytest.approx(-CELL_M),
            0.0,
            pytest.approx(CELL_M),
            pytest.approx(2 * CELL_M),
            pytest.approx(3 * CELL_M),
        ]
        assert result["width_m"] == pytest.approx(6 * CELL_M)
        assert result["max_depth_m"] == pytest.approx(110.0)
        assert result["bank_elevation_m"] == pytest.approx(200.0)
        assert result["channel_center_elevation_m"] == pytest.approx(90.0)
        # Mean depth below the bank across the 7 section cells:
        # mean([0, 10, 104, 110, 104, 10, 0]) = 338/7 m over 6 cells of width.
        mean_depth = 338.0 / 7
        area = mean_depth * 6 * CELL_M
        assert result["cross_section_area_m2"] == pytest.approx(area, abs=0.05)
        wetted_perimeter = 6 * CELL_M + 2 * mean_depth
        assert result["hydraulic_radius_m"] == pytest.approx(area / wetted_perimeter, abs=0.01)

    def test_section_skips_nodata_cells(self):
        """NODATA cells are dropped from the section instead of reported."""
        dem = np.full((6, 9), 200.0, dtype=np.float32)
        dem[2, 4] = 100.0
        dem[1, 4] = NODATA

        result = cross_section(dem, 2, 4, _flow_west(6, 9), half_width=1)

        assert result["elevations"] == [100.0, 200.0]
        assert result["distances_m"] == [0.0, pytest.approx(CELL_M)]


class TestStreamGradients:
    """stream_gradients over labelled stream links."""

    def test_single_cell_link_has_no_gradient(self):
        """A one-cell link cannot form a pair, so every cell stays NaN."""
        dem = np.full((5, 5), 100.0, dtype=np.float32)
        streams = np.zeros((5, 5), dtype=bool)
        streams[2, 2] = True

        result = stream_gradients(dem, streams)

        assert result.dtype == np.float32
        assert np.isnan(result).all()

    def test_gradient_is_reported_on_the_upstream_cell_only(self):
        """A two-cell link reports |dz|/dx on its upstream cell only."""
        dem = np.full((5, 5), 100.0, dtype=np.float32)
        dem[2, 1] = 100.0
        dem[2, 2] = 90.0
        streams = np.zeros((5, 5), dtype=bool)
        streams[2, 1] = True
        streams[2, 2] = True

        result = stream_gradients(dem, streams)

        assert result[2, 1] == pytest.approx(10.0 / CELL_M, rel=1e-6)
        assert np.isnan(result[2, 2])
        assert np.isnan(result[0, 0])


class TestAverageDistributarySlope:
    """average_distributary_slope per labelled link."""

    def test_single_cell_link_has_no_slope(self):
        """A one-cell link has no endpoints, so its cell stays NaN."""
        dem = np.full((5, 5), 100.0, dtype=np.float32)
        streams = np.zeros((5, 5), dtype=bool)
        streams[2, 2] = True

        result = average_distributary_slope(dem, streams)

        assert result.dtype == np.float32
        assert np.isnan(result[2, 2])
        assert (result[~streams] == NODATA).all()

    def test_three_cell_link_shares_one_average_slope(self):
        """Every cell of a link carries the endpoint slope dz/length."""
        dem = np.full((5, 7), 100.0, dtype=np.float32)
        dem[2, 1] = 100.0
        dem[2, 2] = 95.0
        dem[2, 3] = 90.0
        streams = np.zeros((5, 7), dtype=bool)
        streams[2, 1:4] = True

        result = average_distributary_slope(dem, streams)

        expected = 10.0 / (3 * CELL_M)
        assert result[2, 1:4] == pytest.approx([expected] * 3, rel=1e-6)
        assert (result[~streams] == NODATA).all()


class TestElevationAboveStream:
    """elevation_above_stream offsets relative to the stream network."""

    def test_nodata_cells_are_skipped(self):
        """NODATA cells are excluded from the walk and reported as NODATA."""
        dem = np.full((5, 7), 100.0, dtype=np.float32)
        dem[2, 2:5] = 50.0
        dem[0, 0] = NODATA
        streams = np.zeros((5, 7), dtype=bool)
        streams[2, 2:5] = True

        result = elevation_above_stream(dem, streams)

        assert result.dtype == np.float32
        assert result[0, 0] == NODATA

    def test_cells_report_rise_above_their_nearest_stream_cell(self):
        """Every cell is measured against its nearest stream cell.

        Regression: the distance transform ran over the stream mask itself
        (channels.py:294), measuring each stream cell's distance to the
        nearest *non-stream* cell — so every off-stream cell sat in the
        distance-0 band and read 0.0.
        """
        dem = np.full((5, 7), 100.0, dtype=np.float32)
        dem[2, 2] = 50.0
        dem[2, 3] = 60.0
        dem[2, 4] = 70.0
        streams = np.zeros((5, 7), dtype=bool)
        streams[2, 2:5] = True

        result = elevation_above_stream(dem, streams)

        assert result.dtype == np.float32
        # A stream cell is its own nearest stream: zero rise.
        assert result[2, 2:5] == pytest.approx([0.0, 0.0, 0.0], abs=1e-6)
        # West of the stream the reference is (2, 2) at 50 m.
        assert result[2, 0] == pytest.approx(50.0, abs=1e-6)
        assert result[2, 1] == pytest.approx(50.0, abs=1e-6)
        # East of the stream the reference is (2, 4) at 70 m.
        assert result[2, 5] == pytest.approx(30.0, abs=1e-6)

    def test_no_streams_reports_nodata_everywhere(self):
        """An empty stream network has no reference level: all NODATA."""
        dem = np.full((4, 4), 100.0, dtype=np.float32)
        streams = np.zeros((4, 4), dtype=bool)

        result = elevation_above_stream(dem, streams)

        assert (result == NODATA).all()


class TestDepthToWater:
    """depth_to_water relative to the stream network."""

    def test_nodata_cells_are_skipped(self):
        """NODATA cells are excluded from the walk and reported as NODATA."""
        dem = np.full((5, 7), 100.0, dtype=np.float32)
        dem[2, 2:5] = 50.0
        dem[0, 0] = NODATA
        streams = np.zeros((5, 7), dtype=bool)
        streams[2, 2:5] = True

        result = depth_to_water(dem, streams)

        assert result.dtype == np.float32
        assert result[0, 0] == NODATA

    def test_depth_is_measured_to_the_nearest_stream_cell(self):
        """Water table sits at the nearest stream cell's elevation.

        Regression: as with elevation_above_stream, the distance transform
        ran over the stream mask (channels.py:345), so off-stream cells sat
        in the distance-0 band and read the lowest stream cell's depth
        everywhere.
        """
        dem = np.full((5, 7), 100.0, dtype=np.float32)
        dem[2, 2] = 50.0
        dem[2, 3] = 60.0
        dem[2, 4] = 70.0
        streams = np.zeros((5, 7), dtype=bool)
        streams[2, 2:5] = True

        result = depth_to_water(dem, streams)

        assert result.dtype == np.float32
        # Stream cells are their own water table: zero depth.
        assert result[2, 2:5] == pytest.approx([0.0, 0.0, 0.0], abs=1e-6)
        # West of the stream the water table is (2, 2) at 50 m.
        assert result[2, 1] == pytest.approx(50.0, abs=1e-6)
        # East of the stream it is (2, 4) at 70 m.
        assert result[2, 5] == pytest.approx(30.0, abs=1e-6)
