#!/bin/bash

set -e

MAX_PAGES=1

URL="https://api.github.com/users/$USERNAME/starred?per_page=100"

COUNTER=1
while [ "$URL" ]; do
  RES=$(curl -i -Ss -H "Accept: application/vnd.github.v3.star+json" -H "Authorization: token $GITHUB_TOKEN" "$URL")
  
  # via https://michaelheap.com/follow-github-link-header-bash/
  HEADERS=$(echo "$RES" | sed '/^\r$/q')
  URL=$(echo "$HEADERS" | sed -n -E 's/link:.*<(.*)>; rel="next".*/\1/p')
  echo "$RES" | sed '1,/^\r$/d'
  
  if [[ $MAX_PAGES -ne 0 && $COUNTER -eq $MAX_PAGES ]]; then break; fi
  
  let COUNTER=COUNTER+1
done
    