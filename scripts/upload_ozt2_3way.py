#!/usr/bin/env python3
"""
3-way parallel OZT2 uploader using subprocess.
Splits x-dirs across 3 independent bash processes — no threading/GIL issues.
Each process runs sequentially, processes communicate via shared JSON state file.
"""
import subprocess
import sys
import json
import os
from pathlib import Path

HF_TOKEN = os.environ.get("HF_TOKEN")
REPO_ID = "aliasfox/srtm30m-ozt2-v2"

# Get list of done x-dirs
STATE_FILE = Path("/tmp/ozt2_3way_done.json")


def get_done():
    if STATE_FILE.exists():
        return set(json.loads(STATE_FILE.read_text()))
    return set()


def get_remaining():
    done = get_done()
    tile_dir = Path("data/ozt2_tiles")
    remaining = []
    for zdir in sorted(tile_dir.iterdir()):
        if not zdir.is_dir() or not zdir.name.startswith("z"):
            continue
        z = int(zdir.name[1:])
        for xd in sorted(zdir.iterdir()):
            if not xd.is_dir():
                continue
            key = f"z{z}/{xd.name}"
            if key in done:
                continue
            count = sum(1 for _ in xd.glob("*.ozt2"))
            if count == 0:
                continue
            remaining.append((z, xd.name, count, str(xd)))
    return remaining


def main():
    remaining = get_remaining()
    if not remaining:
        print("All done!")
        return

    total_tiles = sum(c for _, _, c, _ in remaining)
    print(f"Remaining: {len(remaining)} x-dirs, {total_tiles} tiles")
    print(f"State: {STATE_FILE}")

    # Split into 3 groups
    groups = [[], [], []]
    for i, xd in enumerate(remaining):
        groups[i % 3].append(xd)

    for i, g in enumerate(groups):
        g_tiles = sum(c for _, _, c, _ in g)
        print(f"  Worker {i}: {len(g)} x-dirs, {g_tiles} tiles")

    # Write each group's x-dirs to a temp file
    scripts = []
    for i, g in enumerate(groups):
        script_file = Path(f"/tmp/ozt2_worker_{i}.sh")
        with open(script_file, "w") as f:
            f.write("#!/bin/bash\n")
            f.write(f"HF_TOKEN={HF_TOKEN}\n")
            f.write(f"STATE={STATE_FILE}\n")
            f.write("""
mark_done() {
    python3 -c \\
        "import json; f=open('$STATE'); d=set(json.load(f)); f.close(); d.add('$1'); open('$STATE','w').write(json.dumps(sorted(list(d))))" 2>/dev/null
}
""")
            for z, xn, count, xd_path in g:
                f.write(f"""
[ -f /tmp/ozt2_worker_{i}.stop ] && echo "Stop signal received" && exit 0
echo "[$(date +%H:%M:%S)] Uploading z{z}/{xn} ({count} tiles)..."
for attempt in 1 2 3 4; do
    if python3 -c "
import os
from huggingface_hub import HfApi
api = HfApi(token=os.environ['HF_TOKEN'])
api.upload_large_folder(repo_id='{REPO_ID}', folder_path='{xd_path}', repo_type='dataset')
" 2>&1 | grep -v "WARNING\|Note:\|===\|super_squash"; then
        echo "[$(date +%H:%M:%S)] OK   z{z}/{xn}"
        mark_done "z{z}/{xn}"
        break
    else
        echo "[$(date +%H:%M:%S)] RETRY z{z}/{xn} (attempt $attempt)"
        sleep 5
    fi
done
""")
        scripts.append(script_file)

    # Launch 3 background processes
    procs = []
    for i, script_file in enumerate(scripts):
        print(f"Starting worker {i}...")
        p = subprocess.Popen(["bash", str(script_file)],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True)
        procs.append((i, p))

    print(f"All 3 workers running. Monitor with:")
    print(f"  cat {STATE_FILE}")
    print(f"Stop all with: touch /tmp/ozt2_worker_0.stop /tmp/ozt2_worker_1.stop /tmp/ozt2_worker_2.stop")

    # Monitor
    try:
        while True:
            done = len(get_done())
            remaining_now = len(remaining) - done
            if remaining_now <= 0:
                print(f"All {len(remaining)} x-dirs uploaded!")
                break
            print(f"[{len(get_done())}/{len(remaining)} done, {remaining_now} remaining]")
            import time
            time.sleep(30)

            # Check if any process died
            alive = 0
            for i, p in procs:
                if p.poll() is None:
                    alive += 1
                else:
                    print(f"  Worker {i} exited with code {p.returncode}")
            if alive == 0:
                print("All workers finished!")
                break
    except KeyboardInterrupt:
        print("\nInterrupted. Workers still running in background.")
        print(f"State saved to {STATE_FILE}")
        print(f"To resume: run this script again")
        print(f"To stop: touch /tmp/ozt2_worker_{{0,1,2}}.stop")


if __name__ == "__main__":
    main()
