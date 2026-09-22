#!/bin/sh
set -eu

DB="${LACRIMA_DB:-/data/lacrima.db}"
REPO="https://github.com/meki20/lacrima.git"
API="https://api.github.com/repos/meki20/lacrima/releases?per_page=1"

sql() { sqlite3 "$DB" "$1"; }
now() { date +%s000; }

release() {
  reply="$(curl -sSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: Lacrima-updater' -w '\n%{http_code}' "$API" || true)"
  code="$(printf '%s' "$reply" | tail -n 1)"
  body="$(printf '%s' "$reply" | sed '$d')"
  checked="$(now)"
  if [ "$code" != 200 ]; then
    sql "update app_updates set last_checked_at=$checked, last_status='Could not check GitHub. Try again shortly.' where singleton=1;"
    return 1
  fi
  tag="$(printf '%s' "$body" | jq -r '.[0].tag_name // empty')"
  if [ -z "$tag" ]; then
    sql "update app_updates set last_checked_at=$checked, latest_tag=null, latest_name=null, latest_url=null, latest_published_at=null, last_status='No releases have been published yet.' where singleton=1;"
    return 1
  fi
  name="$(printf '%s' "$body" | jq -r '.[0].name // .[0].tag_name')"
  url="$(printf '%s' "$body" | jq -r '.[0].html_url // empty')"
  published="$(printf '%s' "$body" | jq -r '.[0].published_at // empty')"
  published_at="$(date -d "$published" +%s 2>/dev/null || true)"
  [ -n "$published_at" ] && published_at="${published_at}000" || published_at=null
  sql "update app_updates set last_checked_at=$checked, latest_tag=$(quote "$tag"), latest_name=$(quote "$name"), latest_url=$(quote "$url"), latest_published_at=$published_at, last_status=$(quote "Latest release: $tag.") where singleton=1;"
  printf '%s' "$tag"
}

quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

gitcmd() {
  if git -C /workspace ls-files --eol | grep -q 'w/crlf'; then
    git -C /workspace -c core.autocrlf=true "$@"
  else
    git -C /workspace "$@"
  fi
}

apply() {
  tag="$1"
  if [ "$(gitcmd config --get remote.origin.url || true)" != "$REPO" ]; then
    sql "update app_updates set requested_at=null, last_status='The checkout remote is not the Lacrima repository.' where singleton=1;"
    return
  fi
  if [ -n "$(gitcmd status --porcelain)" ]; then
    sql "update app_updates set requested_at=null, last_status='Update skipped: the checkout has local changes.' where singleton=1;"
    return
  fi
  branch="$(gitcmd branch --show-current)"
  if [ -z "$branch" ]; then
    sql "update app_updates set requested_at=null, last_status='Update skipped: the checkout is detached.' where singleton=1;"
    return
  fi
  updated="$(now)"
  sql "update app_updates set requested_at=null, last_status='Pulling and rebuilding Lacrima.' where singleton=1;"
  if gitcmd pull --ff-only origin "$branch" && docker compose --project-directory /workspace --project-name lacrima --profile serve up -d --build lacrima; then
    sql "update app_updates set last_updated_at=$updated, last_applied_tag=$(quote "$tag"), last_status='Lacrima was updated and restarted.' where singleton=1;"
  else
    sql "update app_updates set last_status='Update failed. Check the lacrima-updater container logs.' where singleton=1;"
  fi
}

while true; do
  if sql 'select 1 from app_updates where singleton=1;' >/dev/null 2>&1; then
    sql "update app_updates set updater_heartbeat=$(now) where singleton=1;"
    row="$(sql 'select auto_update, update_time, requested_at, coalesce(last_auto_day, ""), coalesce(last_applied_tag, "") from app_updates where singleton=1;')"
    auto="$(printf '%s' "$row" | cut -d'|' -f1)"
    time="$(printf '%s' "$row" | cut -d'|' -f2)"
    requested="$(printf '%s' "$row" | cut -d'|' -f3)"
    last_day="$(printf '%s' "$row" | cut -d'|' -f4)"
    applied="$(printf '%s' "$row" | cut -d'|' -f5)"
    day="$(date +%F)"
    if [ -n "$requested" ]; then
      apply "$(release || true)"
    elif [ "$auto" = 1 ] && [ "$(date +%H:%M)" = "$time" ] && [ "$last_day" != "$day" ]; then
      tag="$(release || true)"
      sql "update app_updates set last_auto_day=$(quote "$day") where singleton=1;"
      [ -n "$tag" ] && [ "$tag" != "$applied" ] && apply "$tag"
    fi
  fi
  sleep 20
done
