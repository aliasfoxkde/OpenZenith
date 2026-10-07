"""Shared fixtures for the SDK test suite.

``openzenith_core`` — the Python subprocess wrapper over the Rust terrain CLI —
ships from ``core/python/`` as its own distribution (see ``core/pyproject.toml``)
and is therefore not a dependency of the ``openzenith`` package. Its directory is
put on ``sys.path`` here so the wrapper tests and the Rust/Python parity tests can
import it straight from a checkout.

Whether the CLI *binary* exists is a separate question: it only appears after
``cargo build --release`` inside ``core/``, which a CI checkout does not do, so
every test that executes it goes through the ``core_cli`` fixture and is skipped
(with the wrapper's own error text as the reason) when it is absent.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
#: Directory holding the uninstalled ``openzenith_core`` wrapper package.
CORE_PYTHON = REPO_ROOT / "core" / "python"
#: CLI binary produced by ``cargo build --release`` inside ``core/``.
CORE_CLI = REPO_ROOT / "core" / "target" / "release" / "openzenith_core_cli"

if CORE_PYTHON.is_dir():
    sys.path.insert(0, str(CORE_PYTHON))

if TYPE_CHECKING:
    from collections.abc import Iterator
    from types import ModuleType


@pytest.fixture(scope="session")
def oz_core() -> Iterator[ModuleType]:
    """Return the ``openzenith_core`` wrapper module, imported from ``core/python``."""
    import openzenith_core

    yield openzenith_core


@pytest.fixture(scope="session")
def core_cli(oz_core: ModuleType) -> Iterator[Path]:
    """Path to the built CLI binary; skip the test when it has not been built."""
    # Re-resolve rather than trust the module cache: an earlier test may have
    # pointed OPENZENITH_CORE_CLI at a fake path and been interrupted.
    oz_core._CLI = None
    try:
        path = oz_core._cli_path()
    except RuntimeError as exc:
        pytest.skip(str(exc))
    yield path
    oz_core._CLI = None
