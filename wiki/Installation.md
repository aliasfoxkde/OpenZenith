# Installation

## Python SDK Requirements

- **Python**: 3.10 or higher
- **Platform**: Linux x86_64 (primary), macOS, Windows with Linux compatibility

## pip Installation

### Basic Installation

```bash
pip install openzenith
```

### Full Installation (All Extras)

```bash
pip install openzenith[all]
```

This includes all optional dependencies:

| Extra | Packages |
|-------|----------|
| `compression` | `zstandard`, `brotli` — for OZT1/OZT2 tile compression |
| `download` | `huggingface_hub` — for HuggingFace dataset access |
| `analysis` | `aiohttp`, `numba`, `rasterio` — async client, JIT acceleration, GeoTIFF export |
| `dev` | `pytest`, `pytest-asyncio`, `ruff`, `hatchling` — testing and linting |

### Individual Extras

```bash
pip install openzenith[compression,download]  # specific extras
```

## Rust Binary (openzenith-core)

The Rust core library provides high-performance WASM bindings and CLI tools.

### Pre-built Releases

Download pre-built binaries from the [GitHub Releases](https://github.com/aliasfoxkde/OpenZenith/releases) page.

### Building from Source

```bash
# Clone the repository
git clone https://github.com/aliasfoxkde/OpenZenith.git
cd OpenZenith

# Build Rust binary
cargo build --release --manifest-path openzenith-core/Cargo.toml

# The binary will be at:
# openzenith-core/target/release/openzenith-core
```

### Installing via maturin (Python bindings)

```bash
pip install maturin
cd openzenith-core/python
maturin develop --release
```

## Node.js (API Development)

For developing or deploying the Next.js API locally:

```bash
cd api
npm install
```

### Node.js Version

- **Recommended**: Node.js 20.x LTS or higher
- **Minimum**: Node.js 18.x

## API Deployment (Cloudflare Pages)

See [Deployment](Deployment.md) for full Cloudflare Pages deployment instructions.

## Verifying Installation

```python
import openzenith as oz

# Check version
print(oz.__version__)

# Test elevation query
elevation = oz.get_elevation(40.7128, -74.0060)
print(f"Mount Everest elevation: {elevation} m")
```

Or via CLI:

```bash
openzenith info
openzenith query --lat 40.7128 --lon -74.0060
```

## Data Setup

The SDK can work with data from HuggingFace directly, but for local development you may want the full SRTM 30m dataset:

```bash
# Download tiles for a specific region
openzenith tiles --lat 40.7 --lon -74.0 --radius 0.5 --zoom 10

# Or download the full dataset (requires ~65GB)
# See Data-Sources.md for full instructions
```

## Troubleshooting

### Import Errors

If you see `ImportError: cannot import name 'OpenZenithError'` after upgrading, ensure you're using the latest version:

```bash
pip install --upgrade openzenith
```

### Numba Acceleration

For faster viewshed computation, install numba:

```bash
pip install numba
```

The SDK will automatically use Numba JIT compilation when available.

### HuggingFace Authentication

For access to private datasets or higher rate limits:

```bash
pip install huggingface_hub
huggingface-cli login
```
