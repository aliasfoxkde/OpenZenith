#!/usr/bin/env python3
"""Purge all objects from the openzenith-dem R2 bucket.

Tiles were uploaded with wrong key structure (tiles/{x}/{y}/{z}.png
instead of tiles/{z}/{x}/{y}.png), making them unreachable by the API.
The site uses HuggingFace as its tile backend, so R2 data is unused.
This script deletes everything to get back under the 10GB free tier limit.
"""

import boto3
import json
import sys
import time

CREDS_PATH = "/home/mkinney/.config/openzenith/r2-credentials.json"
BATCH_SIZE = 1000  # S3 delete_objects limit


def main():
    with open(CREDS_PATH) as f:
        creds = json.load(f)

    s3 = boto3.client(
        "s3",
        endpoint_url=creds["endpoint"],
        aws_access_key_id=creds["access_key_id"],
        aws_secret_access_key=creds["secret_access_key"],
        region_name="auto",
    )

    bucket = creds["bucket"]
    total_deleted = 0
    total_errors = 0
    batch_num = 0
    continuation_token = None

    print(f"Purging all objects from R2 bucket: {bucket}")
    print(f"Batch size: {BATCH_SIZE}")
    print("---")

    while True:
        # List objects
        kwargs = {"Bucket": bucket, "MaxKeys": BATCH_SIZE}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        try:
            resp = s3.list_objects_v2(**kwargs)
        except Exception as e:
            print(f"ERROR listing objects: {e}", file=sys.stderr)
            time.sleep(5)
            continue

        objects = resp.get("Contents", [])
        if not objects:
            break

        # Build delete request
        delete_keys = [{"Key": obj["Key"]} for obj in objects]

        # Delete batch
        try:
            del_resp = s3.delete_objects(
                Bucket=bucket,
                Delete={"Objects": delete_keys, "Quiet": False},
            )
            deleted = len(del_resp.get("Deleted", []))
            errors = del_resp.get("Errors", [])
            total_deleted += deleted
            total_errors += len(errors)
            batch_num += 1

            size_mb = sum(obj["Size"] for obj in objects) / (1024 * 1024)
            print(
                f"Batch {batch_num}: deleted {deleted:,} objects "
                f"({size_mb:.1f} MB) | total: {total_deleted:,}"
            )

            if errors:
                for err in errors[:3]:
                    print(f"  ERROR: {err['Key']}: {err['Message']}", file=sys.stderr)
        except Exception as e:
            print(f"ERROR deleting batch: {e}", file=sys.stderr)
            total_errors += len(objects)
            time.sleep(5)

        if not resp.get("IsTruncated"):
            break

        continuation_token = resp.get("NextContinuationToken")

    print("---")
    print(f"Done. Deleted {total_deleted:,} objects. Errors: {total_errors}")


if __name__ == "__main__":
    main()
