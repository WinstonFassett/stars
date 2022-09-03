# stars

Daily export of my GitHub starred repos in [stars.csv](stars.csv)

Browse with GitHub's [Flat Viewer](https://github.com/githubocto/flat-viewer) at [`flatgithub.com/WinstonFassett/stars`](https://flatgithub.com/WinstonFassett/stars?filename=stars.csv&sort=%20starred_at%2Cdesc)

## ETL

GitHub Action [get-stars.yml](.github/workflows/get-stars.yml) runs:

 - [get-stars.sh](etl/get-stars.sh) uses `curl` to extract starred repositories 
 - [stars-to-csv.sh](etl/stars-to-csv.sh) converts output to CSV using `jq`
