"""Tests for openzenith.rest — REST client over the deployed API.

HTTP is stubbed at the ``requests.Session`` boundary: each test asserts on the
URL, query parameters or JSON body the client would send and on the parsed
response it hands back, with no network access.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
import requests

from openzenith import rest
from openzenith.elevation import latlon_to_tile
from openzenith.rest import (
    DEFAULT_BASE_URL,
    ELEVATION_BATCH_MAX_POINTS,
    RestError,
    ZenithClient,
)

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _stub_response(payload=None, status=200, text=""):
    """Build a stub Response with a fixed status code and JSON body."""
    resp = MagicMock()
    resp.status_code = status
    resp.text = text if text else ("" if payload is None else json.dumps(payload))

    def _json():
        """Mirror Response.json: a non-JSON body raises ValueError."""
        if payload is None:
            raise ValueError("not JSON")
        return payload

    resp.json.side_effect = _json
    return resp


def _stub_client(timeout=15.0):
    """Return (client, session) with the session replaced by a stub."""
    session = MagicMock(spec=requests.Session)
    client = ZenithClient(base_url="https://api.test", timeout=timeout, session=session)
    return client, session


# ─── Construction / lifecycle ─────────────────────────────────────────────────


class TestClientConstruction:
    """Base URL resolution, timeout and session ownership."""

    def test_default_base_url(self, monkeypatch):
        monkeypatch.delenv(rest.BASE_URL_ENV, raising=False)
        client = ZenithClient(session=MagicMock(spec=requests.Session))
        assert client.base_url == DEFAULT_BASE_URL

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv(rest.BASE_URL_ENV, "https://staging.test/api/")
        client = ZenithClient(session=MagicMock(spec=requests.Session))
        assert client.base_url == "https://staging.test/api"

    def test_explicit_base_url_wins_over_env(self, monkeypatch):
        monkeypatch.setenv(rest.BASE_URL_ENV, "https://staging.test")
        client = ZenithClient(base_url="https://local.test/", session=MagicMock())
        assert client.base_url == "https://local.test"

    def test_empty_base_url_rejected(self, monkeypatch):
        monkeypatch.setenv(rest.BASE_URL_ENV, "   ")
        with pytest.raises(ValueError, match="non-empty"):
            ZenithClient(session=MagicMock())

    def test_timeout_passed_to_transport(self):
        client, session = _stub_client(timeout=7.5)
        session.get.return_value = _stub_response({"ok": True})
        client.elevation(1.0, 2.0)
        assert session.get.call_args.kwargs["timeout"] == 7.5

    def test_close_closes_owned_session_only(self):
        borrowed = MagicMock(spec=requests.Session)
        ZenithClient(session=borrowed).close()
        borrowed.close.assert_not_called()

        with patch("requests.Session") as session_cls:
            ZenithClient().close()
        session_cls.return_value.close.assert_called_once()

    def test_context_manager_closes_owned_session(self):
        with patch("requests.Session") as session_cls, ZenithClient() as client:
            assert client.base_url == DEFAULT_BASE_URL
        session_cls.return_value.close.assert_called_once()


# ─── Error handling ───────────────────────────────────────────────────────────


class TestErrorHandling:
    """RestError carries status plus the server's message where one exists."""

    def test_flat_error_body(self):
        client, session = _stub_client()
        session.get.side_effect = [
            _stub_response({"error": "Invalid coordinates"}, status=400),
            _stub_response({"grid": []}),
        ]
        with pytest.raises(RestError) as exc:
            client.slope_aspect(40.7, -74.0)
        assert exc.value.status == 400
        assert exc.value.message == "Invalid coordinates"
        assert exc.value.url == "https://api.test/api/slope"
        assert str(exc.value) == "Invalid coordinates"

    def test_nested_error_body(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response(
            {
                "ok": False,
                "error": {"code": "ELEVATION_UNAVAILABLE", "message": "sources unreachable"},
                "requestId": "oz-abc",
            },
            status=502,
        )
        with pytest.raises(RestError) as exc:
            client.elevation(40.7, -74.0)
        assert exc.value.status == 502
        assert exc.value.message == "ELEVATION_UNAVAILABLE: sources unreachable"

    def test_non_json_error_body_uses_status_text(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response(None, status=502, text="bad gateway")
        with pytest.raises(RestError) as exc:
            client.elevation(0.0, 0.0)
        assert exc.value.status == 502
        assert "HTTP 502" in exc.value.message
        assert "bad gateway" in exc.value.message

    def test_transport_failure_is_status_zero(self):
        client, session = _stub_client()
        session.get.side_effect = requests.ConnectionError("refused")
        with pytest.raises(RestError) as exc:
            client.elevation(0.0, 0.0)
        assert exc.value.status == 0
        assert "refused" in exc.value.message

    def test_non_json_success_body(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response(None, status=200, text="<html>")
        with pytest.raises(RestError) as exc:
            client.elevation(0.0, 0.0)
        assert exc.value.status == 200
        assert "non-JSON" in exc.value.message

    def test_error_message_helper_shapes(self):
        assert rest._error_message({"error": "boom"}, "fb") == "boom"
        assert rest._error_message({"error": {"message": "boom"}}, "fb") == "boom"
        assert rest._error_message({"error": {"code": "X", "message": "boom"}}, "fb") == "X: boom"
        assert rest._error_message({"other": 1}, "fb") == "fb"
        assert rest._error_message(None, "fb") == "fb"


# ─── query ────────────────────────────────────────────────────────────────────


class TestQuery:
    """GET /api/query — unified point query."""

    def test_defaults_send_lat_lon_only(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"location": {"lat": 40.7, "lon": -74.0}})
        got = client.query(40.7, -74.0)
        assert session.get.call_args.args[0] == "https://api.test/api/query"
        assert session.get.call_args.kwargs["params"] == {"lat": 40.7, "lon": -74.0}
        assert got["location"] == {"lat": 40.7, "lon": -74.0}

    def test_include_units_and_forecast_days(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"weather": None})
        client.query(
            40.7, -74.0, include=["elevation", "weather"], units="imperial", forecast_days=5
        )
        assert session.get.call_args.kwargs["params"] == {
            "lat": 40.7,
            "lon": -74.0,
            "include": "elevation,weather",
            "units": "imperial",
            "forecast_days": 5,
        }

    def test_unknown_include_rejected_locally(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="Unknown include"):
            client.query(40.7, -74.0, include=["elevation", "stocks"])
        session.get.assert_not_called()

    def test_out_of_range_coordinates_rejected_locally(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="lat"):
            client.query(95.0, 0.0)
        session.get.assert_not_called()


# ─── elevation ────────────────────────────────────────────────────────────────


class TestElevation:
    """GET /api/elevation — point elevation."""

    def test_gets_path_and_params(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response(
            {
                "requestId": "oz-abc",
                "elevation": 10.5,
                "surface_type": "land",
                "unit": "meters",
                "location": {"lat": 40.7128, "lon": -74.006},
                "source": "ozt2",
                "tile": "",
                "resolution": 30,
                "ok": True,
            }
        )
        got = client.elevation(40.7128, -74.006)
        assert session.get.call_args.args[0] == "https://api.test/api/elevation"
        assert session.get.call_args.kwargs["params"] == {"lat": 40.7128, "lon": -74.006}
        assert got["elevation"] == 10.5
        assert got["source"] == "ozt2"
        assert got["resolution"] == 30

    def test_module_level_alias_is_elevation_at(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"elevation": 3.0})
        assert rest.elevation_at(1.0, 2.0, client=client)["elevation"] == 3.0
        assert session.get.call_args.args[0] == "https://api.test/api/elevation"

    def test_optional_params_are_sent_when_set(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"elevation": 10.5})
        client.elevation(40.7, -74.0, datum="ellipsoid", interpolation="nearest", units="feet")
        assert session.get.call_args.kwargs["params"] == {
            "lat": 40.7,
            "lon": -74.0,
            "datum": "ellipsoid",
            "interpolation": "nearest",
            "units": "feet",
        }

    def test_partial_params_do_not_send_defaults(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"elevation": 10.5})
        client.elevation(40.7, -74.0, units="feet")
        assert session.get.call_args.kwargs["params"] == {
            "lat": 40.7,
            "lon": -74.0,
            "units": "feet",
        }

    def test_module_level_alias_forwards_options(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"elevation": 10.5})
        rest.elevation_at(40.7, -74.0, datum="egm96", units="meters", client=client)
        assert session.get.call_args.kwargs["params"] == {
            "lat": 40.7,
            "lon": -74.0,
            "datum": "egm96",
            "units": "meters",
        }

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"datum": "NAVD88"},
            {"interpolation": "cubic"},
            {"units": "fathoms"},
            {"datum": "egm96", "interpolation": "bicubic"},
        ],
    )
    def test_rejects_unknown_values_before_the_request(self, kwargs):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="must be one of"):
            client.elevation(40.7, -74.0, **kwargs)
        session.get.assert_not_called()


# ─── elevation_batch ──────────────────────────────────────────────────────────


class TestElevationBatch:
    """POST /api/elevation/batch — capped multi-point elevation."""

    def test_post_body_and_results(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response(
            {"results": [{"id": None, "lat": 40.7, "lon": -74.0, "elevation": 10.5}]}
        )
        got = client.elevation_batch([(40.7, -74.0)])
        assert session.post.call_args.args[0] == "https://api.test/api/elevation/batch"
        assert session.post.call_args.kwargs["json"] == {
            "points": [{"lat": 40.7, "lon": -74.0}]
        }
        assert got == [{"id": None, "lat": 40.7, "lon": -74.0, "elevation": 10.5}]

    def test_dict_points_keep_id(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response({"results": []})
        client.elevation_batch([{"lat": 1.0, "lon": 2.0, "id": "a"}, {"lat": 3.0, "lon": 4.0}])
        assert session.post.call_args.kwargs["json"] == {
            "points": [{"lat": 1.0, "lon": 2.0, "id": "a"}, {"lat": 3.0, "lon": 4.0}]
        }

    def test_cap_enforced_locally(self):
        client, session = _stub_client()
        too_many = [(0.0, 0.0)] * (ELEVATION_BATCH_MAX_POINTS + 1)
        with pytest.raises(ValueError, match="1-2000 points"):
            client.elevation_batch(too_many)
        session.post.assert_not_called()

    def test_cap_boundary_is_accepted(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response({"results": []})
        at_cap = [(0.0, 0.0)] * ELEVATION_BATCH_MAX_POINTS
        client.elevation_batch(at_cap)
        assert len(session.post.call_args.kwargs["json"]["points"]) == ELEVATION_BATCH_MAX_POINTS

    def test_empty_points_rejected(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="1-2000"):
            client.elevation_batch([])
        session.post.assert_not_called()

    def test_point_out_of_range_rejected(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="lon"):
            client.elevation_batch([(0.0, 200.0)])
        session.post.assert_not_called()

    def test_body_without_results_array_raises(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response({"results": "not-a-list"})
        with pytest.raises(RestError, match="results array"):
            client.elevation_batch([(0.0, 0.0)])

    def test_server_error_propagates_message(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response(
            {"error": "Provide 1-2000 points as {points: [{lat, lon}]}"}, status=400
        )
        with pytest.raises(RestError) as exc:
            client.elevation_batch([(0.0, 0.0)])
        assert exc.value.status == 400
        assert "Provide 1-2000 points" in exc.value.message


# ─── geocode ──────────────────────────────────────────────────────────────────


class TestGeocode:
    """GET /api/geocode — forward geocoding (wire param is ``query``)."""

    def test_query_param_name_and_default_limit(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response(
            {
                "requestId": "oz-abc",
                "count": 1,
                "results": [{"display_name": "Tokyo", "lat": 35.6762, "lon": 139.6503}],
            }
        )
        got = client.geocode("Tokyo")
        assert session.get.call_args.args[0] == "https://api.test/api/geocode"
        assert session.get.call_args.kwargs["params"] == {"query": "Tokyo", "limit": 5}
        assert got["count"] == 1
        assert got["results"][0]["display_name"] == "Tokyo"

    def test_limit_clamped_to_server_range(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"results": [], "count": 0})
        client.geocode("Osaka", limit=99)
        assert session.get.call_args.kwargs["params"]["limit"] == 10

    def test_blank_query_rejected_locally(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="1-200"):
            client.geocode("   ")
        session.get.assert_not_called()


# ─── contours ─────────────────────────────────────────────────────────────────


class TestContours:
    """GET /api/contours/{z}/{x}/{y} — tile-shaped, zoom-derived interval."""

    def test_point_resolves_to_tile_path(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"type": "FeatureCollection", "features": []})
        got = client.contours(40.7, -74.0, zoom=10)
        x, y = latlon_to_tile(40.7, -74.0, 10)
        assert session.get.call_args.args[0] == f"https://api.test/api/contours/10/{x}/{y}"
        assert got["type"] == "FeatureCollection"

    def test_explicit_tile_indices(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response({"type": "FeatureCollection", "features": []})
        client.contours_tile(8, 3, 5)
        assert session.get.call_args.args[0] == "https://api.test/api/contours/8/3/5"

    def test_zoom_out_of_range(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="zoom must be 4-14"):
            client.contours(0.0, 0.0, zoom=20)
        session.get.assert_not_called()

    def test_tile_index_out_of_range(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match=r"\[0, 16\)"):
            client.contours_tile(4, 16, 0)
        session.get.assert_not_called()

    def test_bbox_merges_covering_tiles(self):
        client, session = _stub_client()
        session.get.return_value = _stub_response(
            {"type": "FeatureCollection", "features": [{"properties": {"elevation": 100}}]}
        )
        got = client.contours_bbox(0.0, 0.0, 5.0, 30.0, zoom=4)

        x0, y0 = latlon_to_tile(5.0, 0.0, 4)
        x1, y1 = latlon_to_tile(0.0, 30.0, 4)
        expected = {
            f"https://api.test/api/contours/4/{x}/{y}"
            for x in range(x0, x1 + 1)
            for y in range(y0, y1 + 1)
        }
        requested = [call.args[0] for call in session.get.call_args_list]
        assert len(expected) > 1
        assert set(requested) == expected
        assert len(got["features"]) == len(requested)
        assert got["type"] == "FeatureCollection"

    def test_bbox_ordering_validated(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="ordered"):
            client.contours_bbox(50.0, 0.0, 5.0, 30.0)
        session.get.assert_not_called()


# ─── profile ──────────────────────────────────────────────────────────────────


class TestProfile:
    """POST /api/profile — transect elevation."""

    def test_post_body_uses_num_points_key(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response(
            {
                "start": {"lat": 40.7, "lon": -74.0},
                "end": {"lat": 40.8, "lon": -73.9},
                "num_points": 3,
                "zoom": 10,
                "stats": {"min": 1, "max": 2, "total_gain": 1, "total_dist": 100},
                "profile": [
                    {"distance_m": 0.0, "elevation": 1.0, "lat": 40.7, "lon": -74.0},
                    {"distance_m": 50.0, "elevation": 2.0, "lat": 40.75, "lon": -73.95},
                    {"distance_m": 100.0, "elevation": 1.5, "lat": 40.8, "lon": -73.9},
                ],
            }
        )
        got = client.profile(40.7, -74.0, 40.8, -73.9, samples=3)
        assert session.post.call_args.args[0] == "https://api.test/api/profile"
        assert session.post.call_args.kwargs["json"] == {
            "lat1": 40.7,
            "lon1": -74.0,
            "lat2": 40.8,
            "lon2": -73.9,
            "num_points": 3,
            "zoom": 10,
        }
        assert got["num_points"] == 3
        assert [row["elevation"] for row in got["profile"]] == [1.0, 2.0, 1.5]
        assert got["stats"]["total_dist"] == 100

    def test_endpoint_out_of_range_rejected_locally(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="lat"):
            client.profile(0.0, 0.0, 95.0, 0.0)
        session.post.assert_not_called()


# ─── watershed + trace ────────────────────────────────────────────────────────


class TestHydrologyRoutes:
    """POST /api/watershed and POST /api/trace request bodies."""

    def test_watershed_body_and_shape(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response(
            {
                "center": [40.7, -74.0],
                "area_km2": 1.25,
                "pixels": 500,
                "min_elev": 0,
                "max_elev": 12,
                "mean_elev": 4,
                "zoom": 10,
                "cell_size_deg": 0.001,
                "boundary": [[40.7, -74.0]],
                "geojson": {"type": "FeatureCollection", "features": []},
            }
        )
        got = client.watershed(40.7, -74.0, zoom=11, radius_cells=50)
        assert session.post.call_args.args[0] == "https://api.test/api/watershed"
        assert session.post.call_args.kwargs["json"] == {
            "lat": 40.7,
            "lon": -74.0,
            "zoom": 11,
            "radius_cells": 50,
        }
        assert got["area_km2"] == 1.25
        assert got["geojson"]["type"] == "FeatureCollection"

    def test_watershed_module_level_alias(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response({"area_km2": 1.0})
        assert rest.watershed_at(40.7, -74.0, client=client)["area_km2"] == 1.0
        assert session.post.call_args.args[0] == "https://api.test/api/watershed"

    def test_trace_body_and_shape(self):
        client, session = _stub_client()
        session.post.return_value = _stub_response(
            {
                "start": [40.7, -74.0],
                "end": [40.6, -74.0],
                "start_elev": 10.0,
                "end_elev": 0.0,
                "total_distance": 11100,
                "steps": 2,
                "path": [[40.7, -74.0], [40.6, -74.0]],
                "elevations": [10.0, 0.0],
                "distances": [0.0, 11100.0],
                "geojson": {"type": "Feature", "geometry": {"type": "LineString"}},
            }
        )
        got = client.trace(40.7, -74.0, max_steps=50)
        assert session.post.call_args.args[0] == "https://api.test/api/trace"
        assert session.post.call_args.kwargs["json"] == {
            "lat": 40.7,
            "lon": -74.0,
            "zoom": 10,
            "max_steps": 50,
        }
        assert got["steps"] == 2
        assert got["geojson"]["geometry"]["type"] == "LineString"


# ─── slope + aspect ───────────────────────────────────────────────────────────


class TestSlopeAspect:
    """GET /api/slope and GET /api/aspect composed into one result."""

    def test_both_routes_queried_with_same_params(self):
        client, session = _stub_client()
        session.get.side_effect = [
            _stub_response({"stats": {"mean": 12.5}, "units": "degrees", "grid": [[1.0]]}),
            _stub_response({"direction_bins": {"N": 10.0}, "valid_cells": 1, "grid": [[45.0]]}),
        ]
        got = client.slope_aspect(40.7, -74.0, radius=25, zoom=9)

        paths = [call.args[0] for call in session.get.call_args_list]
        assert paths == ["https://api.test/api/slope", "https://api.test/api/aspect"]
        assert session.get.call_args.kwargs["params"] == {
            "lat": 40.7,
            "lon": -74.0,
            "radius": 25,
            "zoom": 9,
        }
        assert got["slope"]["units"] == "degrees"
        assert got["aspect"]["direction_bins"] == {"N": 10.0}

    def test_slope_failure_raises_rest_error(self):
        client, session = _stub_client()
        session.get.side_effect = [
            _stub_response({"error": "Missing required parameters: lat, lon"}, status=400),
            _stub_response({"grid": []}),
        ]
        with pytest.raises(RestError, match="Missing required parameters"):
            client.slope_aspect(40.7, -74.0)


# ─── shared client + package exports ─────────────────────────────────────────


class TestSharedClientAndExports:
    """Module-level functions route through one shared client."""

    def test_shared_client_used_for_module_functions(self, monkeypatch):
        client, session = _stub_client()
        monkeypatch.setattr(rest, "_SHARED_CLIENT", client)
        session.get.return_value = _stub_response({"elevation": 1.0})

        rest.elevation_at(1.0, 2.0)
        rest.query(1.0, 2.0)
        assert [call.args[0] for call in session.get.call_args_list] == [
            "https://api.test/api/elevation",
            "https://api.test/api/query",
        ]

    def test_every_module_function_reaches_its_route(self, monkeypatch):
        client, session = _stub_client()
        monkeypatch.setattr(rest, "_SHARED_CLIENT", client)
        session.get.return_value = _stub_response({"type": "FeatureCollection", "features": []})
        session.post.return_value = _stub_response({"results": []})

        assert rest.elevation_batch([(1.0, 2.0)]) == []
        rest.geocode("Kyoto")
        rest.contours(1.0, 2.0)
        rest.contours_bbox(1.0, 2.0, 1.05, 2.05, zoom=4)
        rest.profile(1.0, 2.0, 1.1, 2.1)
        rest.watershed_at(1.0, 2.0)
        rest.trace(1.0, 2.0)
        rest.slope_aspect(1.0, 2.0)

        x10, y10 = latlon_to_tile(1.0, 2.0, 10)
        x4, y4 = latlon_to_tile(1.0, 2.0, 4)
        assert (x4, y4) == latlon_to_tile(1.05, 2.05, 4)  # bbox fits in one tile
        gets = [call.args[0] for call in session.get.call_args_list]
        assert gets == [
            "https://api.test/api/geocode",
            f"https://api.test/api/contours/10/{x10}/{y10}",
            f"https://api.test/api/contours/4/{x4}/{y4}",
            "https://api.test/api/slope",
            "https://api.test/api/aspect",
        ]
        posts = [call.args[0] for call in session.post.call_args_list]
        assert posts == [
            "https://api.test/api/elevation/batch",
            "https://api.test/api/profile",
            "https://api.test/api/watershed",
            "https://api.test/api/trace",
        ]

    def test_lazy_shared_client_defaults_to_production_base(self, monkeypatch):
        monkeypatch.delenv(rest.BASE_URL_ENV, raising=False)
        monkeypatch.setattr(rest, "_SHARED_CLIENT", None)
        try:
            assert rest._shared_client().base_url == DEFAULT_BASE_URL
        finally:
            monkeypatch.setattr(rest, "_SHARED_CLIENT", None)

    def test_package_reexports_without_shadowing(self):
        import openzenith
        import openzenith.elevation as elevation_module

        assert openzenith.ZenithClient is ZenithClient
        assert openzenith.RestError is RestError
        assert openzenith.elevation_batch is rest.elevation_batch
        # The REST function must not shadow the local-tile module or the
        # hydrology function behind the same bare names.
        assert hasattr(elevation_module, "get_elevation")
        assert openzenith.watershed.__module__ != "openzenith.rest"


class TestLocalValidation:
    """Client-side rejections that never reach the transport."""

    def test_bbox_latitude_and_longitude_ranges(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="latitude"):
            client.contours_bbox(95.0, 0.0, 96.0, 1.0)
        with pytest.raises(ValueError, match="longitude"):
            client.contours_bbox(0.0, -200.0, 1.0, 5.0)
        session.get.assert_not_called()

    def test_bbox_zoom_range(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="zoom must be 4-14"):
            client.contours_bbox(0.0, 0.0, 1.0, 1.0, zoom=3)
        session.get.assert_not_called()

    def test_tile_zoom_range(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="zoom must be 4-14"):
            client.contours_tile(15, 0, 0)
        session.get.assert_not_called()

    def test_point_dict_requires_lat_and_lon(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="lat"):
            client.elevation_batch([{"lat": 1.0}])
        session.post.assert_not_called()

    def test_geocode_query_length_bound(self):
        client, session = _stub_client()
        with pytest.raises(ValueError, match="1-200"):
            client.geocode("x" * 201)
        session.get.assert_not_called()

    def test_post_transport_failure_is_status_zero(self):
        client, session = _stub_client()
        session.post.side_effect = requests.Timeout("timed out")
        with pytest.raises(RestError) as exc:
            client.watershed(1.0, 2.0)
        assert exc.value.status == 0
        assert "timed out" in exc.value.message
