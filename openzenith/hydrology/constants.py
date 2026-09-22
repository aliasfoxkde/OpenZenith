"""D8 flow-direction encoding shared across the hydrology package.

The arrays below are indexed by the direction code used by every flow-routing
routine in this package.

This module was split out of the former single-module ``openzenith.hydrology``;
the package ``__init__`` re-exports the unchanged public surface.
"""

import numpy as np

# D8 direction encoding: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
# Row/col offsets for each direction
D8_DR = np.array([0, 1, 1, 1, 0, -1, -1, -1], dtype=np.int16)
D8_DC = np.array([1, 1, 0, -1, -1, -1, 0, 1], dtype=np.int16)
D8_DISTANCE = np.array([1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2), 1.0, np.sqrt(2)])
