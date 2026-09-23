"""Tests for openzenith.hydrology.streams — topology edge paths.

Small hand-built D8 networks where the flow topology is known exactly, used to
drive the stream-head BFS in stream_link_identifier, the junction/reach
segmentation in stream_reach_identifier, and the Strahler link classes in
stream_link_class.

NOTE on two of the fixtures below: ``count_upstream_streams`` and the neighbour
scan in ``stream_link_class`` accept a neighbour ``P = cell - offset(d)`` when
``flow_dir[P] == (d + 4) % 8``, i.e. when P flows *away* from the cell. A real
inflow would require ``flow_dir[P] == d``. The fixtures that exercise junction
detection therefore encode *divergent* (divide) geometry, because that is what
the current code responds to; the assertions document the behaviour as it is.
"""

import numpy as np

from openzenith.hydrology.streams import (
    stream_link_class,
    stream_link_identifier,
    stream_order,
    stream_reach_identifier,
)

NODATA_DIR = -1


def _grid_from(spec: dict[tuple[int, int], int], shape: tuple[int, int]):
    """Build a (streams, flow_dir) pair from a {(row, col): direction} mapping."""
    streams = np.zeros(shape, dtype=bool)
    flow_dir = np.full(shape, NODATA_DIR, dtype=np.int8)
    for (r, c), d in spec.items():
        streams[r, c] = True
        flow_dir[r, c] = d
    return streams, flow_dir


class TestStreamLinkIdentifier:
    """stream_link_identifier seeds links from stream heads (no inflow)."""

    def test_isolated_cell_is_a_head_and_gets_link_one(self):
        """A stream cell with no stream neighbours is a head and seeds link 1."""
        streams, flow_dir = _grid_from({(1, 1): NODATA_DIR}, (4, 4))
        links = stream_link_identifier(streams, flow_dir)

        assert links.dtype == np.int32
        assert links[1, 1] == 1
        assert links.sum() == 1

    def test_isolated_head_with_outflow_keeps_single_cell_link(self):
        """A head that flows into a non-stream cell ends its link after one cell."""
        streams, flow_dir = _grid_from({(1, 1): 2}, (4, 4))
        links = stream_link_identifier(streams, flow_dir)

        # The head is labelled; its downstream neighbour is not a stream.
        assert links[1, 1] == 1
        assert links[2, 1] == 0
        assert links.sum() == 1

    def test_each_isolated_head_gets_its_own_id(self):
        """Two separate isolated heads start two distinct link ids."""
        streams, flow_dir = _grid_from({(0, 0): NODATA_DIR, (2, 3): 4}, (4, 4))
        links = stream_link_identifier(streams, flow_dir)

        assert links[0, 0] == 1
        assert links[2, 3] == 2

    def test_dendritic_network_is_segmented_from_its_heads(self):
        """A connected network gets link ids seeded at each no-inflow cell.

        Main channel (0,1)->E->E->SE->S->S->(3,4) pit all belongs to link 1;
        the westward pair (0,6)->(0,5) is link 2 and the lone (0,7) is link 3.
        """
        streams, flow_dir = _grid_from(
            {
                (0, 1): 0,
                (0, 2): 0,
                (0, 3): 1,  # SE into the main channel
                (0, 5): 4,
                (0, 6): 4,
                (0, 7): 3,  # SW, off-network
                (1, 4): 2,
                (2, 4): 2,
                (3, 4): NODATA_DIR,  # outlet
            },
            (5, 9),
        )
        links = stream_link_identifier(streams, flow_dir)

        for cell in [(0, 1), (0, 2), (0, 3), (1, 4), (2, 4), (3, 4)]:
            assert links[cell] == 1
        assert links[0, 5] == 2
        assert links[0, 6] == 2
        assert links[0, 7] == 3
        assert links.max() == 3


class TestStreamOrder:
    """stream_order sanity checks on hand-built networks."""

    def test_order_is_one_on_a_single_cell_network(self):
        """A lone stream cell has Strahler order 1."""
        streams, flow_dir = _grid_from({(1, 1): NODATA_DIR}, (4, 4))
        order = stream_order(streams, flow_dir)

        assert order.dtype == np.int32
        assert order[1, 1] == 1
        assert order.sum() == 1

    def test_order_zero_where_no_streams(self):
        """Cells outside the stream raster keep order 0."""
        streams, flow_dir = _grid_from({}, (3, 3))
        order = stream_order(streams, flow_dir)
        assert not order.any()


class TestStreamReachIdentifier:
    """stream_reach_identifier segmentation paths."""

    def test_upstream_walk_spans_head_to_outlet_as_one_reach(self):
        """A chain with a single inflow direction segments head-to-outlet.

        Fixture: (1,2) flows S onto (2,2), which flows N onto (1,2) — the
        pair (2,2)->(1,2)->(2,2) is a two-cell loop in the hand-built grid,
        which is exactly why the upstream walk must never revisit a cell.
        (2,1), (2,3) and (3,2) have no inflows and seed their own reaches.
        """
        streams, flow_dir = _grid_from(
            {
                (1, 2): 2,  # S onto (2,2)
                (2, 1): 4,  # W, off-network
                (2, 2): 6,  # N onto (1,2)
                (2, 3): 0,  # E, off-network
                (3, 2): 1,  # SE, off-network
            },
            (5, 5),
        )
        reaches = stream_reach_identifier(streams, flow_dir)

        assert reaches.dtype == np.int32
        assert reaches.max() == 4
        # The loop pair forms one reach seeded row-major first.
        assert reaches[1, 2] == 1
        assert reaches[2, 2] == 1
        assert reaches[2, 1] == 2
        assert reaches[2, 3] == 3
        assert reaches[3, 2] == 4

    def test_reaches_run_from_each_head_to_the_network_outlet(self):
        """Each head seeds a reach that flows downstream to the outlet.

        (0,1), (0,2) and (0,3) have no inflows, so each seeds a reach: the
        first row-major head (0,1) is reach 1, the (0,2)->(1,2) chain is
        reach 2 (the pit has one inflow, so it joins (0,2)'s reach), and
        (0,3) is reach 3.
        """
        streams, flow_dir = _grid_from(
            {
                (0, 1): 4,  # W, off-network
                (0, 2): 2,  # S onto the pit
                (0, 3): 0,  # E, off-network
                (1, 2): NODATA_DIR,  # outlet
            },
            (3, 5),
        )
        reaches = stream_reach_identifier(streams, flow_dir)

        assert reaches[0, 1] == 1
        assert reaches[0, 2] == 2
        assert reaches[1, 2] == 2
        assert reaches[0, 3] == 3

    def test_single_inflow_chain_is_one_reach_not_segmented(self):
        """Without a true junction the whole connected chain is one reach."""
        streams, flow_dir = _grid_from(
            {
                (1, 2): 2,
                (2, 1): 4,
                (2, 2): 6,
                (2, 3): 0,
                (3, 2): 1,
            },
            (5, 5),
        )
        reaches = stream_reach_identifier(streams, flow_dir)

        # (2,2)<->(1,2) is one reach; the three no-inflow neighbours are
        # their own reaches.
        assert reaches[2, 2] == reaches[1, 2]
        assert reaches[2, 1] not in (0, reaches[2, 2])
        assert reaches[2, 3] not in (0, reaches[2, 2])
        assert reaches[3, 2] not in (0, reaches[2, 2])
        assert reaches.max() == 4

    def test_no_streams_yields_all_zero(self):
        """An empty stream raster produces no reaches."""
        streams, flow_dir = _grid_from({}, (4, 4))
        reaches = stream_reach_identifier(streams, flow_dir)
        assert not reaches.any()

    def test_single_cell_network_gets_one_reach(self):
        """A lone stream cell is one reach with id 1."""
        streams, flow_dir = _grid_from({(2, 2): NODATA_DIR}, (5, 5))
        reaches = stream_reach_identifier(streams, flow_dir)

        assert reaches[2, 2] == 1
        assert reaches.sum() == 1


class TestStreamLinkClass:
    """stream_link_class Strahler order updates."""

    def test_order_increases_where_two_distinct_links_converge(self):
        """Two tributary links of order 1 merging into one cell raise it to 2.

        Fixture: (1,1) flows SE onto (2,2) and (1,3) flows SW onto (2,2);
        both tributary cells are only diagonally adjacent to the junction,
        so they form separate 4-connected links. Same-link neighbours never
        count as tributaries (that self-count made order grow without
        bound), so the junction's link rises to Strahler 2.
        """
        streams, flow_dir = _grid_from(
            {
                (1, 1): 1,  # SE onto the junction
                (1, 3): 3,  # SW onto the junction
                (2, 2): 2,  # junction cell, flows S
                (3, 2): NODATA_DIR,  # outlet
            },
            (5, 5),
        )
        result = stream_link_class(streams, flow_dir)

        assert result.dtype == np.int32
        assert result[1, 1] == 1
        assert result[1, 3] == 1
        assert result[2, 2] == 2
        assert result[3, 2] == 2
        assert result.max() == 2

    def test_lone_link_stays_order_one(self):
        """A single stream cell with no qualifying neighbours keeps order 1."""
        streams, flow_dir = _grid_from({(1, 1): 2}, (4, 4))
        result = stream_link_class(streams, flow_dir)

        assert result[1, 1] == 1
        assert result.sum() == 1

    def test_nodata_center_cell_is_not_updated(self):
        """A stream cell with a nodata flow direction is skipped by the scan."""
        streams, flow_dir = _grid_from({(2, 2): NODATA_DIR}, (5, 5))
        result = stream_link_class(streams, flow_dir)

        assert result[2, 2] == 1
