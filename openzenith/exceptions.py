"""Exception hierarchy for the OpenZenith SDK.

Deliberately a leaf module — it imports nothing from the package — so any
submodule can raise these without a circular import. (The hierarchy used to
live in ``__init__.py``, which is unreachable from leaf modules; that was the
documented reason each tile module carried its own private ``TileError`` and
``RestError`` stood outside the hierarchy entirely.)

Catch :class:`OpenZenithError` to handle any SDK failure, or the specific
subclass for the failure you can act on.
"""

from __future__ import annotations


class OpenZenithError(Exception):
    """Base exception for OpenZenith SDK errors."""


class NetworkError(OpenZenithError):
    """Raised when a network request fails."""


class RestError(NetworkError):
    """Raised when an OpenZenith API call fails.

    Attributes:
        status: HTTP status code of the response, or ``0`` when the request
            never produced one (DNS failure, timeout, connection reset).
        message: Server-supplied message when the body carried one, otherwise
            a synthesized description of the failure.
        url: Full request URL that produced the error.

    """

    def __init__(self, status: int, message: str, url: str):
        """Record the status, message and request URL for the failed call."""
        super().__init__(message)
        self.status = status
        self.message = message
        self.url = url


class DataError(OpenZenithError):
    """Raised when data validation fails."""


class TileError(OpenZenithError):
    """Raised for OZT tile encode/decode problems.

    ``tile_format`` and ``tile_format_v2`` re-export this name, so existing
    ``except TileError`` code keeps working — and, unlike the old per-module
    classes, a handler now catches tile errors from either module.
    """


class TileDecodeError(TileError):
    """Raised when tile bytes are structurally undecodable.

    Bad magic, unknown version, truncated payloads, impossible shapes — the
    failures where the bytes cannot be trusted. Encode-time validation and
    compressor availability stay on the parent :class:`TileError`.
    """


class TileNotFoundError(TileError):
    """Raised when a required tile file or resource does not exist.

    Backends that treat a missing tile as normal data (``fetch_tile`` returns
    ``None``) do not raise this; it is for callers that require the tile.
    """
