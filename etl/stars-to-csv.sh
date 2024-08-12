#!/bin/bash

set -e

echo "full_name,description,language,topics,license_name,stargazers_count,forks_count,homepage,html_url,open_issues_count,name,owner_name,owner_avatar_url,created_at,starred_at,updated_at,pushed_at,fork,archived"

jq -r '.[] 
| {starred_at} + .repo 
| . + { 
    owner_name: .owner.login, 
    owner_avatar_url: .owner.avatar_url,
    license_name: .license.name,
    topics: (.topics|join(", "))
}
| { full_name, description, language, topics, license_name, stargazers_count, forks_count, homepage, html_url, open_issues_count, name, owner_name, owner_avatar_url, created_at, starred_at, updated_at, pushed_at, fork, archived }
| [ .full_name, .description, .language, .topics, .license_name, .stargazers_count, .forks_count, .homepage, .html_url, .open_issues_count, .name, .owner_name, .owner_avatar_url, .created_at, .starred_at, .updated_at, .pushed_at, .fork, .archived ]
| @csv
' $1