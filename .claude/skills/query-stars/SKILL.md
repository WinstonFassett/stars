---
skill: query-stars
description: Query GitHub starred repositories from stars.csv using efficient CLI tools
tags: [stars, github, search, csv, query]
---

# Query Stars Skill

Query Winston's GitHub starred repositories from `stars.csv` using efficient CLI commands.

## CSV Location

The CSV file is at the repository root: `stars.csv`

## Available Columns

- `full_name` - Owner/repo name (e.g., "microsoft/vscode")
- `description` - Repository description
- `language` - Primary language
- `topics` - Comma-separated topics
- `license_name` - License type
- `stargazers_count` - Number of stars
- `forks_count` - Number of forks
- `homepage` - Project homepage URL
- `html_url` - GitHub URL
- `owner_name` - Repository owner
- `starred_at` - When Winston starred it
- `created_at` - When repo was created
- `updated_at` - Last update
- `pushed_at` - Last push
- `fork` - Whether it's a fork
- `archived` - Whether it's archived

## Query Commands

All commands assume you're in the repository root where `stars.csv` exists.

### Search by keyword (name or description)

```bash
# Case-insensitive search in full_name and description
grep -i "keyword" stars.csv | head -20
```

### Filter by language

```bash
# Find all TypeScript repos (language field is quoted)
grep '"TypeScript"' stars.csv | head -20

# Rust repos
grep '"Rust"' stars.csv | head -20

# Python repos
grep '"Python"' stars.csv | head -20
```

### Filter by topic

```bash
# Find repos with "agent" topic
grep -i 'agent' stars.csv | head -20
```

### Get most starred repos

```bash
# Top 20 most starred (requires sorting)
tail -n +2 stars.csv | sort -t',' -k6 -rn | head -20
```

### Get recently starred

```bash
# Most recently starred (CSV is already sorted by starred_at desc)
head -20 stars.csv
```

### Count repos by language

```bash
# Count and sort by language
tail -n +2 stars.csv | awk -F',' '{print $3}' | sort | uniq -c | sort -rn
```

### Get specific columns

```bash
# Show just name, language, and star count
awk -F',' '{print $1","$3","$6}' stars.csv | head -20
```

### Combine filters

```bash
# TypeScript repos with "agent" in description, sorted by stars
grep -i 'agent' stars.csv | grep ',TypeScript,' | sort -t',' -k6 -rn | head -10
```

## Performance Notes

- The CSV is ~4MB, loaded fresh from disk for each query
- Simple grep/awk operations complete in <100ms
- Sorting operations may take a few hundred ms
- For complex queries, consider piping through multiple filters
- Use `head` to limit results and improve response time

## Examples

### Find AI agent frameworks

```bash
grep -iE 'agent|framework' stars.csv | grep -E 'TypeScript|JavaScript' | head -10
```

### Find Rust projects

```bash
grep ',Rust,' stars.csv | sort -t',' -k6 -rn | head -15
```

### Find recently starred projects with many stars

```bash
head -50 stars.csv | sort -t',' -k6 -rn | head -10
```

## Tips for Agents

1. Always `cd` to the repository root before querying
2. Use `head` to limit output - the CSV has thousands of entries
3. Pipe multiple filters for complex queries
4. The CSV is sorted by `starred_at` descending (most recent first)
5. For numeric sorting, use `sort -t',' -k<column> -rn`
6. For case-insensitive search, use `grep -i`
