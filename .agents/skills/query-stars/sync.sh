#!/usr/bin/env bash
# Fetch stars.csv into a local cache with an ETag conditional request.
# First run downloads ~4MB (~1-2s). Later runs return 304 in ~100ms
# unless the nightly export changed the file, in which case it re-downloads.
# Prints the cached CSV path on stdout.
set -euo pipefail

STARS_DIR="${STARS_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/stars}"
CSV="$STARS_DIR/stars.csv"
ETAG="$STARS_DIR/stars.etag"
URL="https://raw.githubusercontent.com/WinstonFassett/stars/main/stars.csv"

mkdir -p "$STARS_DIR"

curl -sfL --etag-save "$ETAG" --etag-compare "$ETAG" -o "$CSV" "$URL"

# A 304 leaves the file untouched; if the etag outlived the csv, refetch clean.
if [ ! -s "$CSV" ]; then
  rm -f "$ETAG"
  curl -sfL --etag-save "$ETAG" -o "$CSV" "$URL"
fi

echo "$CSV"
