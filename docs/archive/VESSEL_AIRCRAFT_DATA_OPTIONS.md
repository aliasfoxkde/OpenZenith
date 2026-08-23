# Vessel & Military Aircraft Data — Investigation & Options

**Date:** 2026-04-19  
**Status:** Documented for future action  
**Hardware Note:** A single RTL-SDR dongle (~$30) can receive both ADS-B (1090 MHz) and AIS (162 MHz)

---

## Current Status

| Data Source | Type | Status | Aircraft/Vessels |
|-------------|------|--------|-----------------|
| OpenSky Network | ADS-B | ✅ Working | 10,800+ aircraft (authenticated, SWR 15min) |
| AISstream.io | AIS (WebSocket) | ⚠️ Dead | WebSocket connects, subscription accepted, **ZERO data received** |
| ADSB Exchange | ADS-B + Military | ❌ Blocked | CF 403 on tiles, API 402 ($30/yr subscription) |
| FIRMS (NASA) | Wildfire | ✅ Working | 3,000+ fires/day |

### AISstream Diagnosis (2026-04-19)
- WebSocket to `wss://stream.aisstream.io/v0/stream` **connects successfully**
- Subscription message with valid API key **accepted** (no error)
- **Zero PositionReport messages received** across multiple bounding boxes:
  - Mediterranean `[0,35]→[5,40]`
  - English Channel `[-5,49]→[3,52]`
  - Rotterdam `[4,51]→[5,52]`
- Waited up to 20 seconds per connection, multiple attempts
- **Conclusion:** Free tier appears deprecated, expired, or service severely degraded
- **Key:** `6f699e3655fd824a0f6a03eda802d19526305d0e` (set in `.env.local` + wrangler secret)

### ADSB Exchange Data Architecture (reverse-engineered)

**Tile grid:**
- Grid size: 3° × 3° cells (confirmed via `receiver.json`)
- ~7,260 standard tiles + 60 special high-density tiles
- Index range: 1000–8259
- Computed as: `index = floor((lat+90)/3) * 121 + floor((lon+180)/3) + 1000`

**URL patterns:**
- Civil: `https://globe.adsbexchange.com/data/globe_{index:04d}.json`
- Military: `https://globe.adsbexchange.com/data/globeMil_{index:04d}.json`
- Config: `https://globe.adsbexchange.com/data/receiver.json` (accessible, no CF)

**Data format per tile:**
```json
{
  "now": 1776630280,
  "globeIndex": 6238,
  "aircraft": [
    [hex, type, flight, r:, t:, [lat, lon, alt, ...], ...]
  ],
  "global_ac_count_withpos": 42000,
  "simload": 7200,
  "refresh": 1000
}
```

**Tile content is zstd-compressed binary** (falls back to JSON). The JS detects via `data.binCraft` flag and uses `arraybufferRequest` with a decompression worker.

**Cloudflare protection:**
- `receiver.json` → 200 (NOT behind CF challenge)
- `globe_*.json` → 403 (CF "Under Attack" mode, requires JS challenge)
- `globeMil_*.json` → 403 (same)
- API v2 (`/api/aircraft/v2/`) → 402 ("Please purchase a key")
- No amount of header spoofing bypasses CF — requires actual browser JS execution

---

## Option A: Physical Feeder (AISHub + ADSB Exchange)

### Overview
Run an RTL-SDR receiver on a Raspberry Pi to feed AIS data to AISHub and ADS-B data to ADSB Exchange. In exchange, both services give you API access to their aggregated global data.

### Hardware Required
| Item | Cost | Notes |
|------|------|-------|
| RTL-SDR USB dongle (Nooelec NESDR Smart) | ~$30 | Receives 1090 MHz (ADS-B) and 162 MHz (AIS) |
| ADS-B antenna (1090 MHz) | ~$15-25 | 1090 MHz dipole or spider antenna |
| AIS antenna (162 MHz) | ~$15-25 | VHF marine antenna |
| Raspberry Pi 4 (or 5) | ~$40-60 | Can run both decoders simultaneously |
| MicroSD card | ~$10 | 16GB+ |
| Power supply | ~$10 | USB-C for Pi 4/5 |
| **Total** | **~$120-170** | One-time cost |

### Software Setup
```bash
# ADS-B (readsb → ADSB Exchange)
sudo bash -c "$(wget -q -O - https://github.com/wiedehopf/readsb/raw/master/scripts/readsb-install.sh)"

# AIS (aiscatcher → AISHub)
# Or use rtl_ais for simple AIS decoding
sudo apt install rtl-sdr aiscatcher
```

### AISHub Feed
- **Signup:** Contact via aishub.net (signup page was 404, may need email)
- **Feed format:** UDP AIS NMEA sentences to AISHub's IP:port
- **API access:** `https://data.aishub.net/ws.php?username=U&output=json&format=1&compress=0&latmin=E&latmax=F&lonmin=G&lonmax=H`
- **Rate limit:** 1 request per minute (or returns nothing)
- **Data:** Real-time vessel positions aggregated from all AISHub feeders globally
- **Output formats:** JSON, XML, CSV
- **Compression:** None, ZIP, GZIP, BZIP2

### ADSB Exchange Feed
- **Signup:** Already have account (micheal.l.c.kinney@gmail.com)
- **Feed format:** readsb Beast/MLAT output
- **API access:** Feed grants access to API and globe tile data
- **Benefit:** 40,000+ aircraft including military, with 1-second refresh
- **Config:** Set MLAT override in readsb config to feed to ADSB Exchange

### Integration with OpenZenith

**AISHub API route** (`/api/vessels`):
```typescript
// Replace AISstream with AISHub polling
const AISHUB_USERNAME = process.env.AISHUB_USERNAME;
const url = `https://data.aishub.net/ws.php?username=${AISHUB_USERNAME}&output=json&format=1&latmin=${south}&latmax=${north}&lonmin=${west}&lonmax=${east}`;
// Rate limit: poll every 60 seconds (their limit)
// Cache: 60 seconds server-side
```

**ADSB Exchange tile proxy** (`/api/military`):
```typescript
// Option 1: Direct API access (if feeding grants API key)
const resp = await fetch(`https://adsbexchange.com/api/aircraft/v2/lat/${lat}/lon/${lon}/dist/${dist}`, {
  headers: { "api-auth": ADSB_EXCHANGE_KEY }
});

// Option 2: Fetch globe tiles (need to pass CF challenge somehow)
// Could use a headless browser on the Pi itself to proxy tiles
```

### Pros
- One-time hardware cost (~$120-170)
- Free ongoing API access to both services
- Global vessel coverage (AISHub aggregated)
- Military aircraft data (ADSB Exchange)
- Contributes to open-source tracking community
- Full control over your own data feed

### Cons
- Requires physical hardware setup
- Needs always-on device (Raspberry Pi)
- Antenna placement matters (better on roof/near window)
- AISHub signup process unclear (404 on signup page)
- ADSB Exchange feeding may not grant full API access (unclear terms)
- Maintenance burden (keep Pi running, update software)
- Coverage limited by your location (your feeder only covers your area)

---

## Option B: Paid API Subscriptions

### B1: AISstream.io (vessels)
| Plan | Cost | Features |
|------|------|----------|
| Free | $0 | Currently non-functional (no data) |
| Unknown | ? | No public pricing found; was in BETA |

**Verdict:** Free tier appears dead. Not recommended without confirming paid tier exists.

### B2: MarineTraffic (vessels)
| Plan | Cost | Features |
|------|------|----------|
| Starter | ~€29/mo | 100 vessel queries/day |
| Professional | ~€99/mo | 10,000 queries/day, historical |
| Enterprise | Custom | Unlimited, dedicated support |

**API:** `https://services.marinetraffic.com/api/vesselmasterdata/v:4/uuid:{UUID}/...`

### B3: VesselFinder (vessels)
| Plan | Cost | Features |
|------|------|----------|
| Basic | €9.99/mo | 100 requests/day |
| Advanced | €29.99/mo | 1,000 requests/day |
| Enterprise | Custom | Unlimited |

### B4: ADSB Exchange (military aircraft)
| Plan | Cost | Features |
|------|------|----------|
| Ad-free subscription | $30/yr | Full API access, no ads |
| Enterprise API | Custom | High-volume, dedicated |

**API:** `https://adsbexchange.com/api/aircraft/v2/lat/L/lon/L/dist/D`  
**Zero code changes needed** — just set `ADSB_EXCHANGE_KEY` wrangler secret.

### Pros
- No hardware, no maintenance
- Reliable, SLA-backed service
- Immediate access
- Full global coverage

### Cons
- Recurring cost ($30-100/mo depending on service)
- Rate limits on cheaper plans
- Vendor lock-in

---

## Option C: Hybrid Approach (Recommended Path)

### Phase 1: Fix vessel data (immediate, $0)
- Remove AISstream (non-functional)
- Add AISHub as the primary vessel source (requires feeder or waiting for API access)
- Keep vessel layer structure but show "No vessel data source" message
- Document that OpenSky provides 10,800 aircraft (adequate for now)

### Phase 2: ADSB Exchange ($30/yr, whenever convenient)
- Purchase ad-free subscription at https://store.adsbexchange.com/
- Set `ADSB_EXCHANGE_KEY` wrangler secret
- Zero code changes needed — route already handles 402→200 gracefully
- Immediately unlocks 40,000+ aircraft including military

### Phase 3: AISHub feeder (if interested in vessels)
- Purchase RTL-SDR + antenna (~$50-80)
- Set up Raspberry Pi
- Feed to AISHub → get global vessel API access
- Integrate AISHub API into `/api/vessels` route

---

## Key Contacts / URLs

| Service | URL | Notes |
|---------|-----|-------|
| AISHub | https://www.aishub.net | Feed-to-receive model |
| AISHub API | https://data.aishub.net/ws.php | Needs username |
| ADSB Exchange | https://adsbexchange.com | Feed or subscription |
| ADSB Store | https://store.adsbexchange.com | $30/yr subscription |
| AISstream | https://www.aisstream.io | Free tier non-functional |
| MarineTraffic | https://www.marinetraffic.com | Paid only |
| OpenSky | https://opensky-network.org | Free, working (10.8K aircraft) |

---

## Implementation Notes for Future Integration

### AISHub API Integration
```typescript
// api/src/app/api/vessels/route.ts
// Replace AISstream with AISHub polling
// Rate limit: 1 request per 60 seconds (strict)
// Response format: JSON array of vessel objects
// Fields: MMSI, LATITUDE, LONGITUDE, HEADING, SPEED, NAME, TYPE, TIMESTAMP
```

### ADSB Exchange API Integration
```typescript
// api/src/app/api/military/route.ts
// Already handles 402/403 gracefully
// Just needs: wrangler pages secret put ADSB_EXCHANGE_KEY
// Response: { ac: [...], count: N, total: N }
// Each aircraft: { hex, type, flight, lat, lon, alt, gs, track, ... }
```

### readsb Feed Setup (Raspberry Pi)
```bash
# Install readsb
sudo bash -c "$(wget -q -O - https://github.com/wiedehopf/readsb/raw/master/scripts/readsb-install.sh)"

# Configure for ADSB Exchange
# /etc/default/readsd
RECEIVER_OPTIONS=--net-only --net-beast-port 30005
MLAT_EXCHANGE_URL=https://adsbexchange.com/receiver/mlat

# Install aiscatcher for AIS
sudo apt install rtl-ais aiscatcher
```
