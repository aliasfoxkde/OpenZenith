"""Tests for the package-level lazy export surface (openzenith/__init__.py).

The lazy ``__getattr__`` re-exports are public API: every name must resolve,
every lazy name must be listed in ``__all__`` (drift check), and unknown
attributes must raise AttributeError.
"""

import re
from pathlib import Path

import pytest

import openzenith

_SOURCE = Path(openzenith.__file__).read_text(encoding="utf-8")

# Names served through the module-level __getattr__ lazy-import chain.
LAZY_NAMES = sorted(set(re.findall(r'if name == "([A-Za-z_]\w*)":', _SOURCE)))


def test_lazy_name_registry_is_nonempty():
    """Guard against the regex silently matching nothing after a refactor."""
    assert len(LAZY_NAMES) > 100


@pytest.mark.parametrize("name", LAZY_NAMES)
def test_lazy_name_resolves(name):
    """Every lazy export resolves to a real callable/class."""
    obj = getattr(openzenith, name)
    assert callable(obj), f"{name} resolved to non-callable {type(obj)}"


@pytest.mark.parametrize("name", LAZY_NAMES)
def test_lazy_name_is_documented_in_all(name):
    """Lazy exports must appear in __all__ — the public API contract."""
    assert name in openzenith.__all__, f"{name} is lazily importable but not in __all__"


def test_all_entries_resolve():
    """Everything advertised in __all__ actually resolves."""
    for name in openzenith.__all__:
        assert hasattr(openzenith, name), f"__all__ entry {name!r} does not resolve"


def test_unknown_attribute_raises():
    """__getattr__ falls through to the standard AttributeError."""
    missing = "definitely_not_an_export"
    with pytest.raises(AttributeError, match="no attribute"):
        getattr(openzenith, missing)


def test_lazy_import_is_cached_after_first_access():
    """Second access returns the same object (module attribute is set)."""
    first = openzenith.d8_flow_direction
    second = openzenith.d8_flow_direction
    assert first is second
