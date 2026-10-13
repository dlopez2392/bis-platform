#!/usr/bin/env bash
# Prints what a CI job's local Supabase stack looked like, so a red run can
# tell a Kong/PostgREST fault from a test defect. ci.yml runs it twice:
#
#   --baseline  in verify, right after `pnpm check`, pass or fail: the
#               numbers a GREEN run leaves, to compare a red one against;
#   --failure   the last step of verify and of e2e, on failure only.
#
# Why (2026-10-13): bursts of Kong's own 502, "An invalid response was
# received from the upstream server", came back with Kong's upstream
# keep-alive already off (ci-local-supabase.sh, KONG). The hypothesis is
# Kong running out of ephemeral ports to PostgREST, every closed connection
# held in TIME_WAIT (ci-local-supabase.sh, KONG'S PORTS). These are the
# numbers that confirm or kill it: TIME_WAIT to PostgREST (:3000) in Kong's
# network namespace against the port range there; whether a container
# restarted or was OOM-killed; Kong's error lines (a "connect() ... failed
# (99: Cannot assign requested address)" is exhaustion, an "upstream
# prematurely closed" is not); PostgREST's errors; the runner's memory.
#
# THE REPOSITORY IS PUBLIC, and so is this output. So: only named fields of
# `docker inspect`, never a container's environment (PostgREST's holds its
# JWT secret); only the error lines of each log, bounded, never a whole log;
# and anything shaped like a JWT, an sb_ key or a URL's password redacted.
#
# It NEVER fails the job further. A diagnostic that turns a green verify red
# on a runner where `ss` or `sudo` misbehaves would be a new flake, so
# nothing here exits non-zero: an unreadable value is printed as such.
#
# Container names are resolved as ci-local-supabase.sh resolves them, from
# config.toml's project_id. Needs only bash, docker, sudo, nsenter and ss
# (all on GitHub's ubuntu runners); each step's timeout-minutes bounds it.
#
# Tested by apps/web/ci/ci-stack-diagnostics.test.ts.

{ set +x; } 2>/dev/null
set +e

mode=""
if [ "$#" -eq 1 ] && { [ "$1" = "--failure" ] || [ "$1" = "--baseline" ]; }; then
  mode="$1"
else
  echo "::warning::ci-stack-diagnostics.sh takes --failure or --baseline, once. It printed nothing."
  exit 0
fi

project_id="$(sed -nE 's/^project_id *= *"([^"]+)".*/\1/p' packages/db/supabase/config.toml 2>/dev/null)"
kong="supabase_kong_${project_id}"
rest="supabase_rest_${project_id}"
db="supabase_db_${project_id}"

# JWTs (three base64url parts after eyJ), Supabase's sb_ keys, and the
# password in any scheme://user:password@ URL.
redact() {
  sed -E \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/<redacted>/g' \
    -e 's/sb_(secret|publishable)_[A-Za-z0-9_-]+/<redacted>/g' \
    -e 's#([a-z][a-z0-9+.-]*://[^:/@ ]+):[^@ ]+@#\1:<redacted>@#g'
}

pid_of() {
  local pid
  pid="$(docker inspect -f '{{.State.Pid}}' "$1" 2>/dev/null | tr -d '[:space:]')"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && printf '%s' "$pid"
}
kong_pid="$(pid_of "$kong")"
rest_pid="$(pid_of "$rest")"

# Runs a command in a container's network namespace, as root.
in_ns() { local pid="$1"; shift; [ -n "$pid" ] && sudo nsenter -t "$pid" -n "$@"; }

# A count of lines, or "unreadable" when the command itself failed.
count_lines() {
  local out
  if out="$("$@" 2>/dev/null)"; then
    if [ -z "$out" ]; then echo 0; else printf '%s\n' "$out" | wc -l | tr -d '[:space:]'; fi
  else
    echo unreadable
  fi
}

kong_ports() {
  local tw tw_rest reuse range label
  if [ -z "$kong_pid" ]; then
    echo "Kong ($kong) is not running: no network namespace to read."
    tw=unreadable reuse=unreadable range=unreadable
  else
    tw="$(count_lines in_ns "$kong_pid" ss -H -tan state time-wait '( dport = :3000 )')"
    reuse="$(in_ns "$kong_pid" sysctl -n net.ipv4.tcp_tw_reuse 2>/dev/null | tr -d '[:space:]')"
    range="$(in_ns "$kong_pid" sysctl -n net.ipv4.ip_local_port_range 2>/dev/null | tr -s '[:space:]' ' ' | sed -E 's/^ //; s/ $//; s/ /-/')"
    echo "TIME_WAIT to PostgREST (:3000) in Kong's network namespace: $tw"
    echo "Kong's network namespace: tcp_tw_reuse=${reuse:-unreadable} ip_local_port_range=${range:-unreadable}"
    echo "ss -s in Kong's network namespace:"
    in_ns "$kong_pid" ss -s 2>&1 | redact || echo "(could not read ss -s in Kong's network namespace)"
  fi
  if [ -n "$rest_pid" ]; then
    tw_rest="$(count_lines in_ns "$rest_pid" ss -H -tan state time-wait '( sport = :3000 )')"
    echo "TIME_WAIT from :3000 in PostgREST's network namespace: $tw_rest"
  else
    echo "PostgREST ($rest) is not running: no network namespace to read."
  fi
  if [ "$mode" = "--failure" ]; then label="failure"; else label="after pnpm check"; fi
  echo "::notice title=Kong ports ($label)::TIME_WAIT to :3000: ${tw}, ip_local_port_range=${range:-unreadable}, tcp_tw_reuse=${reuse:-unreadable}"
}

if [ "$mode" = "--baseline" ]; then
  kong_ports
  exit 0
fi

echo "::group::Containers: name, restarts, OOM-killed, started at"
for c in "$kong" "$rest" "$db"; do
  docker inspect -f '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}} {{.State.StartedAt}}' "$c" 2>/dev/null \
    || echo "$c: not running, or docker could not read it"
done
echo "::endgroup::"

echo "::group::Kong's ports"
kong_ports
echo "::endgroup::"

echo "::group::Kong: [error], [crit] and connect() lines of the last 15 minutes (the last 50)"
# nginx writes its error log to stderr, hence 2>&1 before the filter.
docker logs --since 15m "$kong" 2>&1 | grep -E '\[error\]|\[crit\]|connect\(\)' | tail -n 50 | redact
echo "::endgroup::"

echo "::group::PostgREST: error and fatal lines of its last 100"
docker logs --tail 100 "$rest" 2>&1 | grep -iE 'error|fatal' | tail -n 50 | redact
echo "::endgroup::"

echo "::group::Runner: free -m and ss -s"
free -m 2>&1 || echo "(could not read free -m)"
ss -s 2>&1 || echo "(could not read ss -s)"
echo "::endgroup::"

exit 0
