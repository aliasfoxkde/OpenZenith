# OpenZenith

Free, fast, global elevation data API. Query any point on Earth for elevation from NASA SRTM 30m.

**Live:** [https://openzenith.pages.dev](https://openzenith.pages.dev) | **API Docs:** [/api/docs](https://openzenith.pages.dev/api/docs) | **Demo Map:** [/demo](https://openzenith.pages.dev/demo)

---

## Features

- **Elevation API** - Query elevation by latitude/longitude, returns height in meters with bilinear interpolation
- **Tile Server** - Slippy map tiles (z/x/y) serving raw Int16 elevation data, compatible with MapLibre and Leaflet
- **Interactive Map** - Hillshade visualization with click-to-query elevation, built on MapLibre GL
- **Self-Hostable** - Deploy anywhere with the data on HuggingFace or your own storage backend
- **No Authentication** - Free and open, no API keys, no rate limits, no sign-up required
- **Edge-Deployed** - Runs on Cloudflare Pages edge runtime for low latency worldwide

## Quick Start

### Query elevation

```bash
curl "https://openzenith.pages.dev/api/elevation?lat=28.0&lon=86.9"
```

Response:
```json
{"elevation":8848,"unit":"meters","location":{"lat":28.0,"lon":86.9},"source":"srtm30m","srtmTile":"N28E086.tif","resolution":30}
```

### JavaScript

```js
const res = await fetch('/api/elevation?lat=48.8566&lon=2.3522');
const { elevation } = await res.json();
console.log(elevation); // 35
```

### Python

```python
import urllib.request, json
url = "https://openzenith.pages.dev/api/elevation?lat=48.8566&lon=2.3522"
data = json.loads(urllib.request.urlopen(url).read())
print(data["elevation"])  # 35
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/elevation?lat={lat}&lon={lon}` | Elevation at a point |
| `GET /api/tile/{z}/{x}/{y}` | Raw Int16 binary tile (256x256) |
| `GET /api/health` | Service health and status |
| `GET /api/docs` | Interactive API documentation |
| `GET /api/openapi.json` | OpenAPI 3.0.3 specification |

See [docs/USAGE.md](docs/USAGE.md) for detailed API documentation.

## Data Source

- **Dataset:** NASA SRTM GL1 v3 (Shuttle Radar Topography Mission)
- **Resolution:** 1 arc-second (~30 meters)
- **Coverage:** 56S - 60N latitude, ~80% of Earth's land surface
- **Tiles:** 14,296 files, 1x1 degree, 3601x3601 pixels each
- **Format:** Int16 binary, signed 16-bit integer in meters, -32768 = nodata

## Tech Stack

- **Framework:** Next.js 15 with App Router
- **Runtime:** Cloudflare Pages (Edge Runtime)
- **Storage:** HuggingFace Datasets (merged binary chunks)
- **Map:** MapLibre GL with terrarium-encoded elevation tiles
- **Compression:** Deflate (fflate) for chunk decompression

## Self-Hosting

OpenZenith can be deployed on any platform that supports Next.js:

1. Clone the repository
2. Install dependencies: `cd api && npm install`
3. Build: `npm run build`
4. Run: `npm start`

### Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `STORAGE_BACKEND` | `huggingface` | Storage backend: `huggingface` or `http` |
| `HF_REPO` | `aliasfox/srtm30m-merged` | HuggingFace dataset repository |
| `USE_MERGED` | `true` | Use merged files instead of individual chunks |
| `TILES_BASE_URL` | - | Custom HTTP backend base URL |

### Cloudflare Pages Deployment

1. Connect your GitHub repo to Cloudflare Pages
2. Set build command: `npx @cloudflare/next-on-pages`
3. Set output directory: `.vercel/output/static`
4. Set environment variables (see table above)
5. Deploy!

## Project Structure

```
api/
  src/
    app/              # Next.js App Router pages and API routes
      api/
        elevation/    # Elevation endpoint
        tile/[z]/[x]/[y]/ # Tile endpoint
        health/        # Health check
        docs/          # Interactive API docs page
        openapi.json/  # OpenAPI spec endpoint
      demo/            # Interactive elevation map
      page.tsx         # Landing page
      layout.tsx       # Root layout
    lib/
      elevation.ts     # Core elevation lookup with bilinear interpolation
      srtm/            # SRTM tile math and coordinate conversions
      storage/         # Chunk backend (HuggingFace, HTTP) and caching
  scripts/             # Data extraction and upload scripts
  wrangler.toml        # Cloudflare Pages configuration
```

## Documentation

- [USAGE.md](docs/USAGE.md) - Detailed API usage guide
- [CHANGELOG.md](docs/CHANGELOG.md) - Version history and changes

## License

MIT
