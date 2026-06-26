# stars

Daily export of my GitHub starred repos in [stars.csv](stars.csv)

**Browse them:** [winstonfassett.github.io/stars](https://winstonfassett.github.io/stars/) — a faceted browse/search UI over the dataset (Astro + Svelte 5, source in [`site/`](site/)).

Or use GitHub's [Flat Viewer](https://github.com/githubocto/flat-viewer) at [`flatgithub.com/WinstonFassett/stars`](https://flatgithub.com/WinstonFassett/stars?filename=stars.csv&sort=%20starred_at%2Cdesc)

## ETL

GitHub Action [get-stars.yml](.github/workflows/get-stars.yml) runs:

 - [get-stars.sh](etl/get-stars.sh) uses `curl` to extract starred repositories 
 - [stars-to-csv.sh](etl/stars-to-csv.sh) converts output to CSV using `jq`

## Site

The browse UI lives in [`site/`](site/) — an Astro app with a Svelte 5 island. It reads
the repo-root `stars.csv` (copied to `public/data/` by the `syncdata` script on dev/build).
[deploy.yml](.github/workflows/deploy.yml) builds it and publishes to GitHub Pages. It runs
on pushes to `main` and, via `workflow_run`, after each daily `get-stars` run completes — so
fresh ETL data redeploys automatically. (The ETL commits with `GITHUB_TOKEN`, whose pushes
don't fire `on: push`, which is why deploy chains off the workflow rather than the commit.)

```sh
cd site
npm install
npm run dev   # via portless → http://stars-site.localhost:<port>/stars/
              # no portless? `npx astro dev` → http://localhost:4321/stars/
```

> One-time setup: in repo Settings → Pages, set **Source: GitHub Actions**.
