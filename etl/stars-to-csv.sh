#!/bin/bash

set -e

echo "name, starred_at, full_name, owner_name, owner_avatar_url, description, homepage, stargazers_count, forks_count, open_issues_count, license_name, topics, created_at, updated_at, pushed_at, archived"

jq -r '.[] 
| {starred_at} + .repo 
| . + { 
    license_name: .license.name,
    owner_name: .owner.login, 
    owner_avatar_url: .owner.avatar_url,
}
| { name, starred_at, full_name, owner_name, owner_avatar_url, description, homepage, stargazers_count, forks_count, open_issues_count, license_name, topics, created_at, updated_at, pushed_at, archived }
| [ .name, .starred_at, .full_name, .owner_name, .owner_avatar_url, .description, .homepage, .stargazers_count, .forks_count, .open_issues_count, .license_name, (.topics|join(", ")), .created_at, .updated_at, .pushed_at, .archived ]
| @csv
' $1