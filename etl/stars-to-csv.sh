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
# Collapse any in-field line separators (CR, LF, U+2028 LS, U+2029 PS) to a
# single space so every record is one physical line — repo descriptions
# occasionally carry these and they trip up editors/tools (VS Code flags U+2028).
| map_values(if type == "string" then gsub("[\r\n\u2028\u2029]+"; " ") else . end)
| [ .full_name, .description, .language, .topics, .license_name, .stargazers_count, .forks_count, .homepage, .html_url, .open_issues_count, .name, .owner_name, .owner_avatar_url, .created_at, .starred_at, .updated_at, .pushed_at, .fork, .archived ]
| @csv
' $1
