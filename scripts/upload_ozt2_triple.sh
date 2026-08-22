#!/bin/bash
# Launch 3 independent background uploaders for z11
# Each processes 1/3 of remaining x-dirs
set -e

STATE="/tmp/ozt2_triple_done.json"
START=$(date +%s)

mark_done() {
    local key="$1"
    python3 -c "
import json, sys
f = '$STATE'
try:
    d = set(json.load(open(f)))
except:
    d = set()
d.add('$key')
json.dump(sorted(list(d)), open(f, 'w'))
"
}

upload_xdir() {
    local zoom="$1"
    local xn="$2"
    local xd_path="$3"
    local repo_id="${4:-aliasfox/srtm30m-ozt2-v2}"

    for attempt in 1 2 3 4; do
        t0=$(date +%s)
        if python3 -c "
import os, sys
from huggingface_hub import HfApi
api = HfApi(token=os.environ.get('HF_TOKEN'))
api.upload_large_folder(repo_id='$repo_id', folder_path='$xd_path', repo_type='dataset')
" 2>/dev/null; then
            elapsed=$(($(date +%s) - t0))
            echo "[$(date +%H:%M:%S)] OK   z${zoom}/${xn}: ${attempt} attempt(s), ${elapsed}s"
            mark_done "z${zoom}/${xn}"
            return 0
        fi
        echo "[$(date +%H:%M:%S)] RETRY z${zoom}/${xn}: attempt $attempt failed"
        sleep 5
    done
    echo "[$(date +%H:%M:%S)] FAIL z${zoom}/${xn}"
    return 1
}

export -f upload_xdir
export -f mark_done
export STATE
export HF_TOKEN

# Wait for rate limit (brief stagger on start)
sleep 2
echo "[$(date +%H:%M:%S)] Uploader started (PID $$)"
echo "State file: $STATE"
echo ""

# The shell loop reads from \$1 which is the x-dir list passed as args
while [ -n "$1" ]; do
    zoom=$(echo "$1" | cut -d/ -f1)
    xn=$(echo "$1" | cut -d/ -f2)
    xd_path="$2"
    shift 2
    upload_xdir "$zoom" "$xn" "$xd_path"
done
