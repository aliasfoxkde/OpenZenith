#!/bin/bash
# Upload OZT2 tiles to Cloudflare R2 for WASM demo.
# Usage: ./scripts/upload_ozt2_to_r2.sh [--local-dir DIR] [--r2-bucket BUCKET] [--zoom z7-z11]
#
# Prerequisites:
#   1. Convert tiles: python scripts/convert_to_ozt2.py --input data/srtm30m-merged/ --output data/ozt2_tiles/ --zoom 7-11 --workers 8 --incremental --codec zstd
#   2. Install AWS CLI: pip install awscli
#   3. Configure R2: aws configure set aws_access_key_id KEY --profile r2 && aws configure set aws_secret_access_key SECRET --profile r2
#   4. Set R2 endpoint: export AWS_SHARED_CREDENTIALS_FILE=~/.aws/credentials

set -e

ZOOM_RANGE="${ZOOM_RANGE:-7-11}"
LOCAL_DIR="${LOCAL_DIR:-/nas/Temp/repos/OpenZenith/data/ozt2_tiles}"
R2_BUCKET="${R2_BUCKET:-openzenith-tiles}"
R2_PROFILE="${R2_PROFILE:-r2}"
WORKERS="${WORKERS:-8}"

echo "=== OpenZenith OZT2 → R2 Upload ==="
echo "  Local dir:  $LOCAL_DIR"
echo "  R2 bucket:  $R2_BUCKET"
echo "  Zoom range: $ZOOM_RANGE"
echo "  Workers:    $WORKERS"
echo

# Step 1: Convert tiles if output dir doesn't exist
if [ ! -d "$LOCAL_DIR" ]; then
    echo "Converting tiles..."
    python scripts/convert_to_ozt2.py \
        --input /nas/Temp/repos/OpenZenith/data/srtm30m-merged/ \
        --output "$LOCAL_DIR" \
        --zoom "$ZOOM_RANGE" \
        --workers "$WORKERS" \
        --incremental \
        --codec zstd
else
    echo "Tiles already exist at $LOCAL_DIR"
fi

# Step 2: Count tiles
TILE_COUNT=$(find "$LOCAL_DIR" -name "*.ozt2" | wc -l)
echo "Tiles to upload: $TILE_COUNT"
echo

# Step 3: Upload to R2 using AWS CLI
# R2 endpoint format: https://<account_id>.r2.cloudflarestorage.com
R2_ENDPOINT="${R2_ENDPOINT:-}"

if [ -z "$R2_ENDPOINT" ]; then
    echo "ERROR: R2_ENDPOINT not set."
    echo "Set it with: export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com"
    exit 1
fi

echo "Uploading to R2..."
time aws s3 sync \
    --delete \
    --profile "$R2_PROFILE" \
    --endpoint-url "$R2_ENDPOINT" \
    "$LOCAL_DIR/" "s3://$R2_BUCKET/ozt2/"

echo
echo "=== Upload complete ==="
echo "Tiles uploaded: $TILE_COUNT"
echo "R2 path: s3://$R2_BUCKET/ozt2/"
