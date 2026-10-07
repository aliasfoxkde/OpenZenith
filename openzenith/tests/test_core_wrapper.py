"""Tests for the ``openzenith_core`` subprocess wrapper (``core/python``).

Two families live here:

* Binary-free tests of the wrapper's own contract — path resolution and every
  error path. These stub ``subprocess.run`` rather than shelling out, so they run
  on any host.
* Round-trips through the real CLI binary. Those go through the ``core_cli``
  fixture and are skipped when ``cargo build --release`` has not been run inside
  ``core/``, so a CI checkout without the binary stays green.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import pytest

if TYPE_CHECKING:
    from types import ModuleType

BUILD_INSTRUCTION = r"cargo build --release"
#: Placeholder resolution target for tests that never touch a real process.
_STUB_CLI = Path("/opt/openzenith-core-stub/openzenith_core_cli")


def _checkout_cli(oz_core: ModuleType) -> Path:
    """Return the in-place build path that ``_cli_path`` falls back to."""
    return (
        Path(oz_core.__file__).parent.parent.parent / "target" / "release" / "openzenith_core_cli"
    )


@pytest.fixture(autouse=True)
def _isolate_resolution(oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch):
    """Isolate the module-level binary cache and env var between tests."""
    monkeypatch.delenv("OPENZENITH_CORE_CLI", raising=False)
    oz_core._CLI = None
    yield
    oz_core._CLI = None


def _stub_run(
    oz_core: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    *,
    returncode: int = 0,
    stdout: bytes = b"",
    stderr: bytes = b"",
    error: Exception | None = None,
) -> list[tuple[tuple, dict]]:
    """Replace ``subprocess.run`` with a recorder; return what each call saw.

    Resolution is pinned to a placeholder path too, so these tests exercise the
    wrapper's own contract on a host with no build at all.
    """
    seen: list[tuple[tuple, dict]] = []

    def fake_run(argv, **kwargs):
        seen.append((argv, kwargs))
        if error is not None:
            raise error
        return subprocess.CompletedProcess(argv, returncode, stdout, stderr)

    monkeypatch.setattr(oz_core, "_cli_path", lambda: _STUB_CLI)
    monkeypatch.setattr(oz_core.subprocess, "run", fake_run)
    return seen


# ── Binary resolution ──────────────────────────────────────────────────────────


def test_env_var_path_wins(oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """An existing ``OPENZENITH_CORE_CLI`` is used verbatim and cached."""
    fake = tmp_path / "somewhere-else" / "openzenith_core_cli"
    fake.parent.mkdir(parents=True)
    fake.touch()
    monkeypatch.setenv("OPENZENITH_CORE_CLI", str(fake))

    assert oz_core._cli_path() == fake
    # The resolved path is cached, so a second call does not re-scan.
    cached = oz_core._CLI
    assert cached == fake


def test_nonexistent_env_var_is_ignored(
    oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """A set-but-absent ``OPENZENITH_CORE_CLI`` silently falls through.

    The env var is only honoured when the file exists, so a typo in it degrades
    to the checkout build — or, with nothing on disk, to the generic not-found
    error — and never reports the variable the caller actually set.
    """
    monkeypatch.setenv("OPENZENITH_CORE_CLI", str(tmp_path / "typo" / "cli"))
    # Relocate the module so the checkout fallback misses too: this pins the
    # not-found branch on a host that *does* have a build.
    monkeypatch.setattr(
        oz_core, "__file__", str(tmp_path / "relocated" / "openzenith_core" / "__init__.py")
    )

    with pytest.raises(RuntimeError, match=BUILD_INSTRUCTION):
        oz_core._cli_path()


def test_env_var_falls_through_to_checkout_build(
    oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, core_cli: Path
):
    """With the env var bogus and a build present, the build is what runs."""
    monkeypatch.setenv("OPENZENITH_CORE_CLI", str(tmp_path / "typo" / "cli"))

    assert oz_core._cli_path() == _checkout_cli(oz_core) == core_cli


def test_not_found_error_names_the_build_step(
    oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """No env var and no checkout build raises the documented RuntimeError.

    ``_cli_path`` derives its fallback from the module's own ``__file__``, so
    relocating that global moves the fallback path with it — the only way to
    reach this branch on a host that has a build.
    """
    monkeypatch.setattr(
        oz_core, "__file__", str(tmp_path / "relocated" / "openzenith_core" / "__init__.py")
    )

    with pytest.raises(RuntimeError, match=BUILD_INSTRUCTION) as excinfo:
        oz_core._cli_path()
    assert "OPENZENITH_CORE_CLI" in str(excinfo.value)


def test_resolution_order_env_before_checkout(
    oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, core_cli: Path
):
    """The env var beats the in-place checkout build."""
    fake = tmp_path / "env" / "openzenith_core_cli"
    fake.parent.mkdir(parents=True)
    fake.touch()
    monkeypatch.setenv("OPENZENITH_CORE_CLI", str(fake))

    assert oz_core._cli_path() == fake
    assert fake != core_cli


# ── Error paths (no binary needed) ────────────────────────────────────────────


def test_binary_vanishing_after_resolution_is_reported(
    oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """A resolved binary that disappears raises the build instruction."""
    vanished = tmp_path / "vanished" / "openzenith_core_cli"
    monkeypatch.setattr(oz_core, "_cli_path", lambda: vanished)
    missing = FileNotFoundError(2, "No such file or directory", str(vanished))
    _stub_run(oz_core, monkeypatch, error=missing)

    with pytest.raises(RuntimeError, match=f"not found at .+{BUILD_INSTRUCTION}"):
        oz_core.d8_flow_direction([[1.0, 0.0]])


def test_nonzero_exit_surfaces_stderr(oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch):
    """A CLI error (JSON on stderr, exit 1) becomes a RuntimeError with both."""
    stderr = b'{"error": "data length 1 != rows*cols 1*2"}\n'
    _stub_run(oz_core, monkeypatch, returncode=1, stderr=stderr)

    with pytest.raises(RuntimeError, match=r"exit 1.+data length 1"):
        oz_core.d8_flow_direction([[1.0]])


def test_timeout_becomes_runtime_error(oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch):
    """``subprocess.TimeoutExpired`` is re-raised as the wrapper's own error."""
    _stub_run(oz_core, monkeypatch, error=subprocess.TimeoutExpired(cmd="cli", timeout=300))

    with pytest.raises(RuntimeError, match=r"timed out \(command=d8\)"):
        oz_core.d8_flow_direction([[1.0, 0.0]])


@pytest.mark.parametrize(
    ("stdout", "fragment"),
    [
        (b"not json at all", "invalid JSON"),
        (b'{"rows": 2, "cols": 1, "da', "invalid JSON"),
        (b"", "invalid JSON"),
    ],
)
def test_malformed_stdout_is_reported(
    oz_core: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    stdout: bytes,
    fragment: str,
):
    """Garbage on stdout cannot be mistaken for a result grid.

    The reported snippet is capped, so a corrupt CLI cannot flood the log
    through this path.
    """
    _stub_run(oz_core, monkeypatch, stdout=stdout)

    with pytest.raises(RuntimeError, match=fragment) as excinfo:
        oz_core.d8_flow_direction([[1.0, 0.0]])
    assert "stdout (first 500 bytes)" in str(excinfo.value)


def test_payload_is_json_on_stdin(oz_core: ModuleType, monkeypatch: pytest.MonkeyPatch):
    """The wrapper sends one JSON object with rows/cols/nodata/data on stdin."""
    seen = _stub_run(
        oz_core,
        monkeypatch,
        stdout=json.dumps({"rows": 1, "cols": 2, "data": [0, -1]}).encode(),
    )

    out = oz_core.d8_flow_direction([[5.0, 5.0]], nodata=-32768.0)

    assert out == [[0, -1]]
    argv, kwargs = seen[0]
    assert argv[1] == "d8"
    assert json.loads(kwargs["input"]) == {
        "rows": 1,
        "cols": 2,
        "nodata": -32768.0,
        "data": [5.0, 5.0],
    }
    assert kwargs["timeout"] == 300


# ── Round-trips against the real binary ───────────────────────────────────────


class TestAgainstRealBinary:
    """Each wrapper function driven end-to-end through the built CLI."""

    @pytest.fixture(autouse=True)
    def _require_binary(self, core_cli: Path) -> None:
        """Skip the whole class when the CLI has not been built."""

    def test_d8_exact_directions(self, oz_core: ModuleType):
        """A hand-checked 3x3 grid pins every direction value.

        The west column and north row sit at 100 m, the centre at 5 m, and the
        two lower corners at 0 m. The centre has three equally steep neighbours,
        and ties go to the first compass direction tried, which is why it drains
        E rather than S.
        """
        dem = [[100.0, 100.0, 100.0], [100.0, 5.0, 0.0], [100.0, 0.0, 100.0]]

        assert oz_core.d8_flow_direction(dem) == [[1, 2, 2], [0, 0, -1], [0, -1, 4]]

    def test_d8_nodata_is_a_pit(self, oz_core: ModuleType):
        """A cell at the sentinel, and a cell beside nothing lower, are pits."""
        dem = [[-32768.0, 100.0], [50.0, 40.0]]

        assert oz_core.d8_flow_direction(dem) == [[-1, 2], [0, -1]]

    def test_flow_accumulation_exact(self, oz_core: ModuleType):
        """A three-cell chain accumulates 1 -> 2 -> 3; pits and flats stay 1.

        The two -1 cells never contribute downstream, and the bottom cell's own
        S direction points off-grid, yet its accumulated total still arrives.
        """
        flow_dir = [[-1, 2, -1], [-1, 2, -1], [-1, -1, -1]]

        assert oz_core.flow_accumulation(flow_dir) == [[1, 1, 1], [1, 2, 1], [1, 3, 1]]

    def test_stream_order_confluence(self, oz_core: ModuleType):
        """Two order-1 streams meeting must make an order-2 confluence."""
        assert oz_core.stream_order([[1, 0], [1, 1]], [[2, -1], [-1, 4]]) == [[1, 0], [2, 1]]

    def test_viewshed_smoke(self, oz_core: ModuleType):
        """Observer is visible; nodata and off-grid observers see nothing."""
        hill = [
            [0.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 1.0, 0.0],
            [0.0, 1.0, 10.0, 1.0],
            [0.0, 0.0, 1.0, 0.0],
        ]

        visible = oz_core.viewshed(hill, 2, 2, observer_height=1.75, cell_size=1.0)
        assert visible[2][2] == 1
        assert {v for row in visible for v in row} <= {0, 1}

        assert oz_core.viewshed(hill, 99, 0) == [[0] * 4] * 4
        assert oz_core.viewshed([[-32768.0]], 0, 0) == [[0]]

    def test_viewshed_max_distance_is_forwarded(self, oz_core: ModuleType):
        """``max_distance_cells`` reaches the CLI and shrinks the visible set.

        The ray count is capped by the distance limit, so a tight limit leaves
        most cells unsampled — the inequality below is the contract, not the
        absolute counts.
        """
        grid = [[0.0] * 16 for _ in range(16)]
        grid[8][8] = 10.0

        full = oz_core.viewshed(grid, 8, 8, cell_size=1.0)
        clipped = oz_core.viewshed(grid, 8, 8, cell_size=1.0, max_distance_cells=2)

        assert sum(map(sum, full)) > sum(map(sum, clipped)) >= 1

    def test_gradient_round_trip_is_lossless(self, oz_core: ModuleType):
        """Predict -> reconstruct reproduces the grid bit for bit.

        All elevations are integers and the residuals stay inside int16, so both
        passes are exact f32 arithmetic — an epsilon here would hide a real
        mismatch.
        """
        dem = np.arange(64, dtype=np.float32).reshape(8, 8) * 3.0

        residuals = oz_core.gradient_predict(dem.tolist())
        reconstructed = np.array(oz_core.gradient_reconstruct(residuals), dtype=np.float32)

        assert np.array_equal(reconstructed, dem)

    def test_gradient_round_trip_carries_nodata_verbatim(self, oz_core: ModuleType):
        """The nodata cell becomes the sentinel residual and reads back as such.

        Placed at the bottom-right corner there are no cells downstream of it
        (the predictor reads only up-left ingredients), so this pins the
        sentinel pass-through on its own; the downstream-exactness contract has
        its own test below.
        """
        dem = [[100.0, 104.0, 101.0], [98.0, 99.0, 97.0], [95.0, 96.0, -32768.0]]

        residuals = oz_core.gradient_predict(dem)
        assert residuals[2][2] == -32768

        reconstructed = oz_core.gradient_reconstruct(residuals)
        assert reconstructed[2][2] == -32768.0
        assert reconstructed[0] == [100.0, 104.0, 101.0]
        assert reconstructed[1] == [98.0, 99.0, 97.0]
        assert reconstructed[2][:2] == [95.0, 96.0]

    def test_gradient_round_trip_is_exact_downstream_of_nodata(self, oz_core: ModuleType):
        """Predict -> reconstruct is exact for every cell, sentinel or not.

        Regression pin for the fixed Rust-side predictor defect
        (``core/src/ozt2.rs`` ``gradient_predict``): the predictor used to
        build its gradient from the three up-left neighbours without excluding
        nodata ingredients, so every cell downstream of a sentinel decoded to
        garbage (measured on the parity DEM: 15 of 256 cells, e.g. (1,15)
        expected 336 got -25). The predictor now falls back to a reduced
        neighbour set around sentinels, and reconstruct re-derives the same
        fallback from the cells it has already decoded — so the round trip is
        bit-exact everywhere.
        """
        dem = [[100.0, 104.0, -32768.0], [98.0, 99.0, 97.0], [95.0, 96.0, 94.0]]

        residuals = oz_core.gradient_predict(dem)
        assert residuals[0][2] == -32768  # sentinel passes through verbatim

        reconstructed = oz_core.gradient_reconstruct(residuals)
        # (1,2) reads the sentinel as its "above" ingredient and (2,2) reads
        # the reconstructed (1,2) — both used to decode wrong.
        assert reconstructed == dem
