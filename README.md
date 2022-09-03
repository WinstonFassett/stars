# stars

Exports of my Github starred repos. Currently CSV-only.

View Data at https://flatgithub.com/WinstonFassett/stars?filename=stars.csv

## ETL in Github Action

 - Extract all pages of stars using GH REST API using `curl`
 - Convert JSON to CSV using `jq`
