---
name: query-stars
description: Query Winston's GitHub starred repositories (~9.5k repos, refreshed nightly) via a locally cached stars.csv. Use when asked to find/search/filter starred repos, e.g. "which of my stars are agent frameworks", "what Rust repos did I star", "recently starred TS projects".
---

# Query Stars

Winston's starred repos live in `stars.csv` at the root of
`WinstonFassett/stars` — ~9,552 rows, ~4MB, rewritten nightly by a
GitHub Action.

## Get the data — NEVER clone the repo

The repo's git history contains a rewritten 4MB CSV per day; cloning
is wasteful. Instead, fetch the file once into a shared cache and
revalidate with an ETag conditional request:

```bash
bash <this-skill-dir>/sync.sh   # prints the cached CSV path
```

- First run: ~1-2s (4MB download)
- Every later run: ~100ms — a 304 when unchanged, a re-download only
  when the nightly export actually changed the file
- Cache lives at `${XDG_CACHE_HOME:-~/.cache}/stars/stars.csv` —
  shared across all projects and sessions

Equivalent inline form if `sync.sh` isn't reachable:

```bash
d="${XDG_CACHE_HOME:-$HOME/.cache}/stars"; mkdir -p "$d"
curl -sfL --etag-save "$d/stars.etag" --etag-compare "$d/stars.etag" \
  -o "$d/stars.csv" \
  https://raw.githubusercontent.com/WinstonFassett/stars/main/stars.csv
```

The repo is public — no auth needed. Set `STARS_CACHE_DIR` to override
the cache location.

## Columns

`full_name, description, language, topics, license_name,
stargazers_count, forks_count, homepage, html_url,
open_issues_count, name, owner_name, owner_avatar_url,
created_at, starred_at, updated_at, pushed_at, fork, archived`

Rows are sorted by `starred_at` descending (newest star first).

**Do not use `cut -d,`, `awk -F,`, or `sort -t,`** — `description` and
`topics` contain commas inside quoted fields. Use `grep` for substring
matching or `python3` (always present on macOS) for column-aware work.

## Query patterns

All examples assume `CSV=<path from sync.sh>`.

### Keyword search (name, description, topics)

```bash
grep -i "agent" "$CSV" | head -20
```

### Recently starred

```bash
head -21 "$CSV"   # already newest-first; +1 for header
```

### Column-aware queries (python3)

```bash
# Top starred
python3 -c "
import csv
rows = csv.DictReader(open('$CSV'))
for r in sorted(rows, key=lambda r: int(r['stargazers_count']), reverse=True)[:20]:
    print(r['stargazers_count'], r['full_name'], '-', (r['description'] or '')[:80])
"

# Filter by language
python3 -c "
import csv
for r in csv.DictReader(open('$CSV')):
    if r['language'] == 'Rust':
        print(r['full_name'], '-', (r['description'] or '')[:80])
" | head -20

# Language stats
python3 -c "
import csv
from collections import Counter
print(Counter(r['language'] for r in csv.DictReader(open('$CSV'))).most_common(20))
"
```

Whole-file scans run in <100ms. Compose filters inside the python
snippet (e.g. `r['language'] == 'TypeScript' and 'agent' in
(r['description'] or '').lower()`) rather than chaining greps.

## Performance budget

| Step | Cost |
|------|------|
| sync, cache fresh | ~100ms (ETag 304) |
| sync, cache stale/missing | ~1-2s (4MB) |
| any query | <100ms |
