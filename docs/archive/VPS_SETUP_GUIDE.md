# VPS Setup Guide for OpenZenith

**Date:** 2026-05-01  
**Purpose:** Self-host elevation tiles to eliminate HuggingFace dependency  
**Target:** Sub-50ms tile response globally, zero external dependency

---

## Overview

This guide covers setting up a VPS to serve pre-generated elevation tiles for OpenZenith. The VPS will replace the HuggingFace dependency for DEM tiles, providing faster and more reliable tile serving.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PROPOSED ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User Request                                                       │
│       │                                                             │
│       ▼                                                             │
│  Cloudflare Pages (API routes) ─────────────────────────────────┐  │
│       │                                                             │  │
│       ├── /api/elevation     → VPS (or CF if unavailable)         │  │
│       ├── /api/dem-tile/*    → VPS (nginx static files)            │  │
│       └── /api/other/*       → Cloudflare (unchanged)              │  │
│                                                                      │  │
│  VPS (your server)                                                  │  │
│  └─ /var/www/openzenith/tiles/                                      │  │
│     └─ dem/z{0-14}/{x}/{y}.png  (~30-120GB)                        │  │
│                                                                      │  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Storage Requirements

### Realistic Storage Estimates

Based on actual land coverage (~29% of world):

| Zoom | Land Tiles | Size | Cumulative |
|------|------------|------|------------|
| z0-7 | ~10,000 | ~50 MB | 50 MB |
| z8 | ~19,000 | ~80 MB | 130 MB |
| z9 | ~76,000 | ~320 MB | 450 MB |
| z10 | ~305,000 | ~1.3 GB | 1.7 GB |
| z11 | ~1.2M | ~5.2 GB | 6.9 GB |
| z12 | ~4.9M | ~21 GB | **28 GB** |
| z13 | ~19.5M | ~85 GB | 113 GB |

### Storage Strategy with R2 + VPS

Since you're using Cloudflare R2 (10GB free) + HuggingFace, your architecture is:

```
Request → CF Pages → CF Cache → R2 Cache → VPS (hot tiles) → HuggingFace (origin)
```

**VPS role:** Cache hot tiles (most-requested regions), not full world.

| Tier | Coverage | Storage | Purpose |
|------|----------|---------|---------|
| Hot (VPS) | Top 10% by usage | ~5-10 GB | Instant response |
| Warm (R2) | Pre-generated | ~30 GB | Fast fallback |
| Cold (HuggingFace) | Full world | Unlimited | Origin |

This means VPS storage could be **as low as 20-50 GB** if you only cache popular regions!

---

## Part 2: Provider Recommendations

### VPS Options Compared

| Provider | Plan | vCPU | RAM | Storage | Price/mo | Verdict |
|---------|------|------|-----|---------|----------|---------|
| **OVH US** | VPS Model 3 | 8 | 24 GB | 200 GB NVMe | **$19.97** | ⭐ **Best Overall** |
| OVH US | VPS Model 2 | ? | ? | ? | $9.99 | Good budget |
| OVH US | VPS Model 1 | ? | ? | ? | $6.46 | Entry level |
| Hetzner | CPX31 | 4 | 16 GB | 160 GB SSD | $17.49 | Good EU alternative |
| Contabo | VPS M | 8 | 30 GB | 400 GB | $14.99 | Best storage per $ |
| Time4VPS | Linux 4 | 4 | 8 GB | 200 GB | $7.99 | Cheapest |

### Dedicated Server Options (OVH Eco)

| Provider | Plan | vCPU | RAM | Storage | Price/mo | Verdict |
|---------|------|------|-----|---------|----------|---------|
| **OVH Eco** | Rise-1 | 4 | 16 GB | ? | $77 | ⭐ Best dedicated value |
| OVH Eco | Rise-M1 | 4 | 32 GB | ? | $118 | More RAM |
| OVH Eco | Rise-L1 | 8 | 64 GB | ? | $177 | High performance |
| OVH Eco | Rise-XL1 | 8 | 128 GB | ? | $354 | Maximum |

### ⭐ Recommended: OVH VPS Model 3 ($19.97/mo)

**Why OVH over others:**
- **8 vCPU** (vs 4 in Hetzner) - better parallel processing
- **24 GB RAM** (vs 16 in Hetzner) - more cache for tiles
- **200 GB NVMe** (vs 160 in Hetzner) - enough for z0-13 tiles
- **1.5 Gbps public bandwidth** - fast tile delivery
- **US location** - good latency for US users
- **Daily backup included** - peace of mind

**Storage breakdown:**
- z0-13 tiles: ~110 GB (if full world)
- Or: Hot tiles only: ~10-30 GB (if selective caching)
- Leaves room for OS, logs, growth

**Cost:**
- Monthly: $19.97
- Yearly: ~$240
- 3-Year: ~$647 (15% discount available)

### When to Choose OVH Eco Dedicated

Only consider dedicated if:
1. You want to **replace Cloudflare R2** entirely
2. You need **>500 GB storage** (full z0-14)
3. You expect **millions of requests/day**
4. You want **full offline capability**

For most cases: **VPS is sufficient**.

### Quick Order Links

- **OVH US VPS:** https://us.ovhcloud.com/vps/
- **OVH Eco Dedicated:** https://eco.us.ovhcloud.com/

---

## Part 3: Server Setup Checklist

### 3.1 Server Provisioning

```bash
# 1. Choose provider (see Part 2 for recommendations)
# 2. Deploy Ubuntu 22.04 LTS
# 3. SSH in as root
```

### 3.2 Initial Server Setup

```bash
# Update system
apt update && apt upgrade -y

# Create admin user
adduser admin
usermod -aG sudo admin

# Setup SSH key (do this before disabling password auth!)
mkdir -p /home/admin/.ssh
chmod 700 /home/admin/.ssh
cat << 'EOF' >> /home/admin/.ssh/authorized_keys
# Your public key here
ssh-rsa AAAA...
EOF
chown -R admin:admin /home/admin/.ssh

# Harden SSH
sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# Setup firewall
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (for nginx)
ufw allow 443/tcp   # HTTPS (optional, if serving directly)
ufw enable

# Install essentials
apt install -y curl wget git htop tree nginx certbot
```

### 3.3 Directory Structure

```bash
# Create directory structure
mkdir -p /var/www/openzenith/tiles/dem
mkdir -p /var/www/openzenith/tiles/elevation-color
mkdir -p /var/www/openzenith/data/satellites
mkdir -p /var/www/openzenith/data/cache
mkdir -p /opt/openzenith/tile-generator

# Set permissions
chown -R www-data:www-data /var/www/openzenith
chmod -R 755 /var/www/openzenith
```

---

## Part 4: Nginx Configuration

### 3.1 Basic Nginx Config

```bash
cat > /etc/nginx/sites-available/openzenith-tiles << 'EOF'
server {
    listen 80;
    server_name tiles.yourdomain.com;  # Or use IP
    
    # Root directory for tiles
    root /var/www/openzenith/tiles;
    
    # Serve tiles directly without PHP/Python
    location / {
        # Enable caching
        expires 7d;
        add_header Cache-Control "public, immutable";
        
        # CORS headers for cross-origin requests
        add_header Access-Control-Allow-Origin "*";
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS";
        
        # Try file, return 204 if not found (for ocean tiles)
        try_files $uri $uri/ =204;
    }
    
    # DEM tile endpoint
    location /dem/ {
        alias /var/www/openzenith/tiles/dem/;
        expires 1y;
        add_header X-Tile-Type "dem";
    }
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript;
    
    # Logging
    access_log /var/log/nginx/openzenith-access.log;
    error_log /var/log/nginx/openzenith-error.log;
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/openzenith-tiles /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 3.2 HTTPS (Recommended)

```bash
# Install certbot
apt install -y certbot python3-certbot-nginx

# Get certificate (if you have a domain)
certbot --nginx -d tiles.yourdomain.com

# Auto-renewal is automatic
```

---

## Part 5: Tile Generation

### 4.1 Tile Generation Script

```bash
cat > /opt/openzenith/tile-generator/generate_tiles.py << 'PYEOF'
#!/usr/bin/env python3
"""
Tile Generator for OpenZenith
Generates Terrarium PNG tiles from SRTM/GEBCO data.

Usage:
  python3 generate_tiles.py --zoom 0-12 --output /var/www/openzenith/tiles/dem
"""

import os
import sys
import argparse
import math
from concurrent.futures import ThreadPoolExecutor, as_completed

# Dependencies: numpy, pillow

try:
    import numpy as np
    from PIL import Image
except ImportError:
    print("Installing dependencies...")
    os.system("pip3 install numpy pillow")
    import numpy as np
    from PIL import Image


NODATA = -32768

def lat_lon_to_tile(lat, lon, zoom):
    """Convert lat/lon to tile coordinates."""
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1/math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y

def tile_to_lat_lon(z, x, y):
    """Convert tile coordinates to lat/lon bounds."""
    n = 2 ** z
    lon_min = x / n * 360.0 - 180.0
    lon_max = (x + 1) / n * 360.0 - 180.0
    lat_max = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat_min = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lat_min, lat_max, lon_min, lon_max

def encode_terrarium_png(elevations, width=256, height=256):
    """Encode elevation data as Terrarium PNG."""
    # Create RGB image
    img = Image.new('RGB', (width, height))
    pixels = []
    
    for i, elev in enumerate(elevations):
        if elev == NODATA or elev < -32768 or elev > 32767:
            # Ocean/unknown - all zeros
            r = g = b = 0
        else:
            # Terrarium encoding
            value = int(elev + 32768)
            r = (value >> 16) & 0xFF
            g = (value >> 8) & 0xFF
            b = value & 0xFF
        pixels.append((r, g, b))
    
    img.putdata(pixels)
    
    # Save to buffer
    import io
    buf = io.BytesIO()
    img.save(buf, format='PNG', compress_level=1)
    return buf.getvalue()

def sample_elevation_from_srtm(lat, lon):
    """
    Sample elevation from SRTM data.
    For production, use pre-downloaded SRTM tiles or AWS terrain tiles.
    """
    # Placeholder - in production, fetch from:
    # - Local SRTM files
    # - AWS Terrain Tiles
    # - Pre-generated tile database
    return NODATA

def generate_tile(z, x, y, output_dir):
    """Generate a single tile."""
    # Determine which SRTM tiles we need
    lat_min, lat_max, lon_min, lon_max = tile_to_lat_lon(z, x, y)
    
    # Sample elevation grid (256x256)
    elevations = []
    for row in range(256):
        lat = lat_max - (row + 0.5) * (lat_max - lat_min) / 256
        for col in range(256):
            lon = lon_min + (col + 0.5) * (lon_max - lon_min) / 256
            elev = sample_elevation_from_srtm(lat, lon)
            elevations.append(elev)
    
    # Generate PNG
    png_data = encode_terrarium_png(elevations)
    
    # Save to disk
    tile_path = f"{output_dir}/z{z}/{x}/{y}.png"
    os.makedirs(os.path.dirname(tile_path), exist_ok=True)
    
    with open(tile_path, 'wb') as f:
        f.write(png_data)
    
    return tile_path

def generate_zoom_level(z, output_dir, max_workers=4):
    """Generate all tiles for a zoom level."""
    n = 2 ** z
    total = n * n
    
    print(f"Generating zoom {z}: {n}x{n} = {total} tiles")
    
    # Generate in batches
    generated = 0
    errors = 0
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for x in range(n):
            for y in range(n):
                future = executor.submit(generate_tile, z, x, y, output_dir)
                futures.append(future)
        
        for f in as_completed(futures):
            try:
                f.result()
                generated += 1
            except Exception as e:
                errors += 1
                print(f"Error: {e}")
            
            if (generated + errors) % 100 == 0:
                print(f"  Progress: {generated + errors}/{total}")
    
    print(f"  Done: {generated} generated, {errors} errors")
    return generated, errors

def main():
    parser = argparse.ArgumentParser(description='Generate terrain tiles')
    parser.add_argument('--zoom', default='0-12', help='Zoom range (e.g., 0-12)')
    parser.add_argument('--output', default='/var/www/openzenith/tiles/dem', help='Output directory')
    parser.add_argument('--workers', type=int, default=4, help='Parallel workers')
    args = parser.parse_args()
    
    # Parse zoom range
    if '-' in args.zoom:
        z_start, z_end = map(int, args.zoom.split('-'))
    else:
        z_start = z_end = int(args.zoom)
    
    os.makedirs(args.output, exist_ok=True)
    
    total_tiles = 0
    total_errors = 0
    
    for z in range(z_start, z_end + 1):
        gen, err = generate_zoom_level(z, args.output, args.workers)
        total_tiles += gen
        total_errors += err
    
    print(f"\nTotal: {total_tiles} tiles generated, {total_errors} errors")

if __name__ == '__main__':
    main()
PYEOF

chmod +x /opt/openzenith/tile-generator/generate_tiles.py
```

### 4.2 Alternative: Use AWS Terrain Tiles (Easier)

Instead of generating from scratch, download pre-generated AWS terrain tiles:

```bash
# Create download script
cat > /opt/openzenith/tile-generator/download_aws.sh << 'EOF'
#!/bin/bash
# Download AWS Terrain Tiles for zoom 0-12
# These are the same tiles used by mapbox, maplibre, etc.

OUTPUT_DIR="/var/www/openzenith/tiles/dem"
ZOOMS="0 1 2 3 4 5 6 7 8 9 10 11 12"

for Z in $ZOOMS; do
    echo "Downloading zoom $Z..."
    
    # Create directory
    mkdir -p "$OUTPUT_DIR/z$Z"
    
    # Calculate number of tiles at this zoom
    TILES=$((2 ** Z))
    
    # Download tile by tile (this is SLOW, use parallel)
    for X in $(seq 0 $((TILES - 1))); do
        for Y in $(seq 0 $((TILES - 1))); do
            URL="https://s3.amazonaws.com/elevation-tiles-prod/terrarium/$Z/$X/$Y.png"
            FILE="$OUTPUT_DIR/z$Z/$X/$Y.png"
            
            if [ ! -f "$FILE" ]; then
                curl -s "$URL" -o "$FILE" &
            fi
            
            # Limit parallelism
            if [ $(jobs -r | wc -l) -ge 16 ]; then
                wait
            fi
        done
        wait
    done
done

echo "Download complete!"
EOF

chmod +x /opt/openzenith/tile-generator/download_aws.sh
```

### 4.3 Better: Parallel Download Script

```bash
cat > /opt/openzenith/tile-generator/download_parallel.sh << 'EOF'
#!/bin/bash
# Parallel AWS Terrain Tile Downloader

OUTPUT_DIR="/var/www/openzenith/tiles/dem"
MAX_JOBS=32

download_tile() {
    Z=$1
    X=$2
    Y=$3
    DIR="$OUTPUT_DIR/z$Z/$X"
    FILE="$DIR/$Y.png"
    
    mkdir -p "$DIR"
    
    if [ ! -f "$FILE" ] || [ ! -s "$FILE" ]; then
        curl -s "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/$Z/$X/$Y.png" -o "$FILE"
    fi
}

export -f download_tile
export OUTPUT_DIR

# Download specific zoom range (e.g., 0-12)
for Z in 0 1 2 3 4 5 6 7 8 9 10 11 12; do
    TILES=$((2 ** Z))
    echo "Zoom $Z: $TILES tiles"
    
    for X in $(seq 0 $((TILES - 1))); do
        for Y in $(seq 0 $((TILES - 1))); do
            download_tile $Z $X $Y &
            
            if [ $(jobs -r | wc -l) -ge $MAX_JOBS ]; then
                wait
            fi
        done
    done
    wait
done

echo "Download complete!"
EOF
```

---

## Part 6: API Integration

### 5.1 Proxy Configuration

Modify Cloudflare Pages function to proxy to VPS:

```typescript
// api/src/app/api/dem-tile/[z]/[x]/[y]/route.ts

// Add VPS as source before HuggingFace
const VPS_TILE_URL = process.env.VPS_TILE_URL || "https://tiles.yourdomain.com";

async function getTileFromVPS(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  try {
    const url = `${VPS_TILE_URL}/dem/${z}/${x}/${y}.png`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      return await resp.arrayBuffer();
    }
  } catch {
    // VPS unavailable
  }
  return null;
}

export async function GET(...) {
  // Layer 1: Cloudflare Cache (unchanged)
  // Layer 2: R2 (unchanged)
  // Layer 3: VPS (NEW)
  try {
    const vpsTile = await getTileFromVPS(zoom, tileX, tileY);
    if (vpsTile) {
      return new Response(vpsTile, {
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "image/png",
          "X-Dem-Tile-Source": "vps",
          "X-Cache": "MISS",
        },
      });
    }
  } catch {
    // Fall through to HuggingFace
  }
  
  // Layer 4: HuggingFace (original logic)
  ...
}
```

### 5.2 Environment Variable

```bash
# In Cloudflare Pages settings (or wrangler.toml):
VPS_TILE_URL=https://tiles.yourdomain.com
```

---

## Part 7: Satellite TLE Sync

### 6.1 CelesTrak Sync Script

```bash
cat > /opt/openzenith/tile-generator/sync_satellites.sh << 'EOF'
#!/bin/bash
# Sync satellite TLE data from CelesTrak

OUTPUT_DIR="/var/www/openzenith/data/satellites"
mkdir -p "$OUTPUT_DIR"

# Sync every 6 hours via cron
# 0 */6 * * * /opt/openzenith/tile-generator/sync_satellites.sh

# Download active satellites
curl -s "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json" \
  -o "$OUTPUT_DIR/satellites_active.json"

# Download stations (ISS, etc.)
curl -s "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json" \
  -o "$OUTPUT_DIR/satellites_stations.json"

# Download GPS
curl -s "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps&FORMAT=json" \
  -o "$OUTPUT_DIR/satellites_gps.json"

# Update timestamp
date > "$OUTPUT_DIR/last_sync.txt"

echo "Satellite sync complete: $(date)"
EOF

chmod +x /opt/openzenith/tile-generator/sync_satellites.sh

# Add to crontab
(crontab -l 2>/dev/null; echo "0 */6 * * * /opt/openzenith/tile-generator/sync_satellites.sh") | crontab -
```

---

## Part 8: Monitoring & Maintenance

### 7.1 Systemd Service

```bash
cat > /etc/systemd/system/openzenith-tiles.service << 'EOF'
[Unit]
Description=OpenZenith Tile Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/openzenith
ExecStart=/usr/sbin/nginx -g "daemon off;" -c /etc/nginx/nginx.conf
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl enable openzenith-tiles
systemctl start openzenith-tiles
```

### 7.2 Health Check

```bash
# Create health check endpoint
cat > /var/www/openzenith/health.html << 'EOF'
OK
EOF

# In nginx config, add:
location /health {
    alias /var/www/openzenith/health.html;
    add_header Content-Type text/plain;
}
```

### 7.3 Disk Space Monitoring

```bash
cat > /opt/openzenith/check_disk.sh << 'EOF'
#!/bin/bash
# Alert if disk usage > 80%

THRESHOLD=80
USAGE=$(df /var/www/openzenith | tail -1 | awk '{print $5}' | sed 's/%//')

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    echo "WARNING: Disk usage at ${USAGE}%" | mail -s "OpenZenith Disk Alert" admin@example.com
fi
EOF

# Run daily via cron
(crontab -l 2>/dev/null; echo "0 0 * * * /opt/openzenith/check_disk.sh") | crontab -
```

---

## Part 9: Cost Summary

### Monthly Costs

| Item | Option A | Option B | Option C |
|------|----------|----------|----------|
| VPS (50GB/160GB/800GB) | $10-17 | $17-25 | $25-50 |
| Domain (optional) | $0-12 | $0-12 | $0-12 |
| SSL Certificate | $0 | $0 | $0 |
| **Total** | **$10-29/mo** | **$17-37/mo** | **$25-62/mo** |

### One-Time Costs

| Item | Cost |
|------|------|
| Tile generation (compute) | $5-20 (if using cloud) |
| Initial tile download (30GB-120GB) | ~$5-20 bandwidth |
| **Total** | **$10-40 one-time** |

### Recommended Starting Point

**Hetzner CPX31 (~$17/month)**
- 4 vCPU, 16GB RAM, 160GB SSD
- NVMe storage (fast tile serving)
- 20TB bandwidth included
- EU location (good Cloudflare peering)

---

## Part 10: Quick Start Script

```bash
#!/bin/bash
# Quick VPS Setup for OpenZenith
# Run as root

set -e

echo "=== OpenZenith VPS Setup ==="

# 1. Update
apt update && apt upgrade -y

# 2. Install
apt install -y curl wget git htop tree nginx python3-pip

# 3. Create directories
mkdir -p /var/www/openzenith/tiles/dem
mkdir -p /var/www/openzenith/data/satellites
chown -R www-data:www-data /var/www/openzenith

# 4. Nginx
cat > /etc/nginx/sites-available/openzenith << 'NGINX'
server {
    listen 80;
    server_name _;
    
    root /var/www/openzenith/tiles;
    expires 7d;
    add_header Cache-Control "public, immutable";
    add_header Access-Control-Allow-Origin "*";
    
    location / {
        try_files $uri $uri/ =204;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/openzenith /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# 5. Download tiles (background)
nohup /opt/openzenith/tile-generator/download_aws.sh > /var/log/tile_download.log 2>&1 &

echo "=== Setup Complete ==="
echo "Tile download running in background: tail -f /var/log/tile_download.log"
echo "Serve tiles at: http://$(curl -s ifconfig.me)/dem/z{x}/{y}/{z}.png"
```

---

## Appendix: Tile URL Mapping

```
VPS Tiles                           OpenZenith API
─────────────────────────────────────────────────────────
https://tiles.example.com/dem/z/x/y.png → /api/dem-tile/z/x/y
https://tiles.example.com/dem/5/15/10.png → /api/dem-tile/5/15/10
```

---

## Appendix: Troubleshooting

### Tile Not Found (404)
- Check directory structure: `/dem/z{z}/{x}/{y}.png`
- Verify nginx has correct `root` directive
- Check file permissions: `chown -R www-data:www-data /var/www/openzenith`

### Slow Tile Serving
- Enable nginx gzip (adds ~50ms latency but saves bandwidth)
- Consider CDN (Cloudflare) in front of VPS
- Use NVMe SSD, not HDD

### Disk Full
- Delete unused zoom levels (e.g., z13, z14)
- Enable compression on nginx
- Move old tiles to cheaper storage

### VPS Unreachable
- Check firewall: `ufw status`
- Check nginx: `systemctl status nginx`
- Check logs: `tail -f /var/log/nginx/error.log`
---

## Part 11: Budget Dedicated Options (Under $25/mo)

### Why Most Budget Dedicated Servers Use HDD

At the $20-25/month price point, **virtually ALL dedicated servers use HDD**:

| Provider | Model | Storage | Type | Speed |
|----------|-------|---------|------|-------|
| Kimsufi | KS-3 | 500 GB | HDD | Slow |
| So You Start | SYS-1 | 2 TB | HDD | Slow |
| Budget providers | Various | 1-4 TB | HDD | Slow |

### The Problem with HDD for Tile Serving

```
Tile Request Pattern:
  - 30KB files
  - Random access (any tile, any zoom)
  - 100s-1000s per second
  
HDD Performance:
  - ~100 IOPS random read
  - ~5,000 tiles/sec max
  
NVMe Performance:
  - ~100,000 IOPS random read  
  - ~50,000 tiles/sec max
```

**10x performance difference** for the exact workload OpenZenith has.

### If You MUST Have Dedicated Hardware

#### Kimsufi KS-3 (~$20/mo)

| Spec | Value |
|------|-------|
| vCPU | 4 |
| RAM | 8 GB |
| Storage | 500 GB HDD |
| Type | Dedicated |
| IP | 1 IPv4 |

**Pros:**
- Full root access, no noisy neighbors
- Can add multiple IPs
- Good for: archival, batch processing

**Cons:**
- HDD = slow for real-time tile serving
- Less RAM than VPS Model 3
- Fewer vCPUs

**Use case:** If you need >200GB storage AND dedicated hardware.

#### So You Start SYS-1 (~$25/mo)

| Spec | Value |
|------|-------|
| vCPU | 2 |
| RAM | 8 GB |
| Storage | 2 TB HDD |
| Type | Dedicated |

**Same tradeoffs as Kimsufi, just more storage.**

### Bottom Line

For OpenZenith tile serving:

| Option | Price | Storage | Speed | Verdict |
|--------|-------|---------|-------|---------|
| OVH VPS Model 3 | $19.97 | 200GB NVMe | Fast | ⭐ **Best** |
| Kimsufi KS-3 | ~$20 | 500GB HDD | Slow | Alternative |
| So You Start SYS-1 | ~$25 | 2TB HDD | Slow | Not recommended |

**If speed matters (it does for tiles): Get the VPS.**
**If storage size matters more than speed: Get Kimsufi KS-3.**

---

## Quick Decision Guide

```
Need >200GB storage AND speed doesn't matter?
  → Kimsufi KS-3 (~$20/mo, HDD)

Need speed AND ~200GB is enough?
  → OVH VPS Model 3 ($19.97/mo, NVMe)

Need >500GB AND speed?
  → Wait for larger VPS or dedicated upgrade
```

