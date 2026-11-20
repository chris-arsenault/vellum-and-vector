#!/usr/bin/env bash
# Local atlas for verification: the production database image and the native server, on
# loopback only. One atlas and kept world serve every worktree: its state lives in the main
# checkout's git-ignored `.artifacts/local-atlas/`. See docs/local-atlas.md.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
main="$(cd "$(git -C "$root" rev-parse --git-common-dir)/.." && pwd)"
home="${ATLAS_LOCAL_HOME:-$main/.artifacts/local-atlas}"
mkdir -p "$home"
database=vellum-local-atlas-db
volume=vellum-local-atlas
database_port="${ATLAS_LOCAL_DATABASE_PORT:-54338}"
# On a Sulion development node only ports 26000-26010 on the node's LAN address reach a
# browser on the LAN; elsewhere the atlas stays on loopback.
if [[ -n "${SULION_PTY_ID:-}" ]]; then
  lan_address="$(ip -4 -brief addr show scope global 2>/dev/null | awk '{ sub(/\/.*/, "", $3) } $3 ~ /^192\.168\./ { print $3; exit }')"
fi
host="${ATLAS_LOCAL_HOST:-${lan_address:-127.0.0.1}}"
port="${ATLAS_LOCAL_PORT:-$([[ -n "${lan_address:-}" ]] && echo 26010 || echo 44138)}"
# The harness reaches the server at the same address.
export ATLAS_LOCAL_HOST="$host" ATLAS_LOCAL_PORT="$port"

# Passwords for the loopback-only database are made once and kept beside the world.
credentials() {
  mkdir -p "$home"
  if [[ ! -f "$home/credentials.env" ]]; then
    (
      umask 077
      for name in POSTGRES MAP MAP_READER GENERATION; do
        echo "ATLAS_LOCAL_${name}_PASSWORD=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
      done >"$home/credentials.env"
    )
  fi
  set -a
  # shellcheck source=/dev/null
  . "$home/credentials.env"
  set +a
}

database_up() {
  if [[ "$(docker inspect -f '{{.State.Running}}' "$database" 2>/dev/null)" == true ]]; then
    return
  fi
  if docker inspect "$database" >/dev/null 2>&1; then
    docker start "$database" >/dev/null
  else
    docker build -q -t vellum-database:local "$root/database" >/dev/null
    docker run -d --name "$database" \
      -e POSTGRES_PASSWORD="$ATLAS_LOCAL_POSTGRES_PASSWORD" \
      -e ATLAS_MAP_PASSWORD="$ATLAS_LOCAL_MAP_PASSWORD" \
      -e ATLAS_MAP_READER_PASSWORD="$ATLAS_LOCAL_MAP_READER_PASSWORD" \
      -e ATLAS_GENERATION_PASSWORD="$ATLAS_LOCAL_GENERATION_PASSWORD" \
      -p "127.0.0.1:$database_port:5432" \
      -v "$volume:/var/lib/postgresql" \
      vellum-database:local >/dev/null
  fi
  for _ in $(seq 60); do
    docker exec "$database" pg_isready -U postgres -d vellum_maps >/dev/null 2>&1 && return
    sleep 1
  done
  echo "The database did not become ready; see: docker logs $database" >&2
  exit 1
}

server_down() {
  if [[ -f "$home/server.pid" ]]; then
    local pid
    pid="$(cat "$home/server.pid")"
    kill "$pid" 2>/dev/null || true
    # Wait for it to exit, so its port is free for the next server.
    for _ in $(seq 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    rm -f "$home/server.pid"
  fi
}

# Kibibytes of one /proc status or meminfo field, or 0.
kib() {
  awk -v key="$2:" '$1 == key { print $2; found = 1 } END { if (!found) print 0 }' "$1" 2>/dev/null || echo 0
}

# How the server ended, from its wait status: a signal is 128 + its number.
ending() {
  local status=$1
  case "$status" in
    0) echo "exited cleanly" ;;
    143) echo "stopped by SIGTERM (local-down or local-up)" ;;
    137) echo "killed by SIGKILL: the out-of-memory killer or a kill -9 from outside" ;;
    134) echo "aborted (SIGABRT): a failed allocation or an aborting panic; see the lines above" ;;
    139) echo "crashed with a segmentation fault (SIGSEGV), often a stack overflow" ;;
    *) if ((status > 128)); then echo "killed by signal $((status - 128))"; else echo "exited with status $status"; fi ;;
  esac
}

# Runs the server and writes, into the server log, its resident memory each time it grows
# by another GiB and how it ended, so a server that dies without a word still leaves both.
supervise() {
  "$@" &
  local child=$! peak=0 step=0 rss hwm status
  echo "$child" >"$home/server.pid"
  trap 'kill "$child" 2>/dev/null' TERM
  while kill -0 "$child" 2>/dev/null; do
    rss=$(kib "/proc/$child/status" VmRSS)
    hwm=$(kib "/proc/$child/status" VmHWM)
    ((hwm > peak)) && peak=$hwm
    if ((rss / 1048576 > step)); then
      step=$((rss / 1048576))
      echo "{\"event\":\"server.memory\",\"at\":\"$(date -u +%FT%TZ)\",\"residentGiB\":$step,\"availableGiB\":$(($(kib /proc/meminfo MemAvailable) / 1048576))}"
    fi
    sleep 2
  done
  wait "$child"
  status=$?
  echo "{\"event\":\"server.exit\",\"at\":\"$(date -u +%FT%TZ)\",\"pid\":$child,\"status\":$status,\"ending\":\"$(ending "$status")\",\"peakResidentGiB\":$((peak / 1048576)),\"availableGiB\":$(($(kib /proc/meminfo MemAvailable) / 1048576))}"
}

server_up() {
  command -v cmake >/dev/null || { echo "Put CMake on PATH to build the native server" >&2; exit 1; }
  (cd "$root" && cargo build --release -p atlas-host --bin atlas_server)
  server_down
  local url="postgresql://%s:%s@127.0.0.1:$database_port/%s"
  mkdir -p "$home/map-assets" "$home/generation-resources" "$home/scratch"
  # Earlier servers' logs are kept: the last run's final lines are the evidence of a crash.
  [[ -f "$home/server.log" ]] && cat "$home/server.log" >>"$home/server-history.log"
  echo "{\"event\":\"server.start\",\"at\":\"$(date -u +%FT%TZ)\"}" >"$home/server.log"
  # shellcheck disable=SC2059
  ATLAS_BIND="$host:$port" \
    ATLAS_MAP_DATABASE_URL="$(printf "$url" atlas_maps "$ATLAS_LOCAL_MAP_PASSWORD" vellum_maps)" \
    ATLAS_MAP_READER_URL="$(printf "$url" atlas_map_reader "$ATLAS_LOCAL_MAP_READER_PASSWORD" vellum_maps)" \
    ATLAS_GENERATION_DATABASE_URL="$(printf "$url" atlas_generation "$ATLAS_LOCAL_GENERATION_PASSWORD" vellum_generation)" \
    ATLAS_MAP_ASSETS="$home/map-assets" \
    ATLAS_GENERATION_RESOURCES="$home/generation-resources" \
    ATLAS_GENERATION_SCRATCH="$home/scratch" \
    ATLAS_FRONTEND="$root/frontend/dist" \
    RUST_BACKTRACE=1 \
    nohup bash -c "$(declare -f kib ending supervise); home='$home'; supervise '$root/target/release/atlas_server'" \
    >>"$home/server.log" 2>&1 &
  for _ in $(seq 10); do
    [[ -s "$home/server.pid" ]] && break
    sleep 0.2
  done
  for _ in $(seq 60); do
    curl -s -o /dev/null "http://$host:$port/" && { echo "Local atlas at http://$host:$port/"; return; }
    kill -0 "$(cat "$home/server.pid")" 2>/dev/null || break
    sleep 1
  done
  echo "The server did not start; see $home/server.log" >&2
  exit 1
}

# Samples the running server with perf for the given seconds and writes a flat report.
# The host keeps perf_event_paranoid restrictive, so perf runs in a container with
# CAP_PERFMON in the host PID namespace. CALL_GRAPH=dwarf records unwound stacks.
profile() {
  local seconds="${1:-30}" out
  out="$home/profiles/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$out"
  docker build -q -t vellum-profile:local "$root/scripts/profile" >/dev/null
  local graph=(-g)
  [[ "${CALL_GRAPH:-}" == dwarf ]] && graph=(--call-graph dwarf,16384)
  docker run --rm --pid=host --cap-add PERFMON --cap-add SYS_PTRACE \
    -v "$root:$root:ro" -v "$out:/out" vellum-profile:local sh -c '
      pid=$(for p in /proc/[0-9]*; do
        [ "$(cat "$p/comm" 2>/dev/null)" = atlas_server ] && echo "${p#/proc/}"
      done | head -1)
      [ -n "$pid" ] || { echo "No running atlas_server" >&2; exit 1; }
      perf record -F 199 "$@" -p "$pid" -o /out/perf.data -- sleep "$0" >/dev/null 2>&1
      perf report -i /out/perf.data --stdio --no-children --sort symbol \
        --percent-limit 0.5 -g none 2>/dev/null | grep -v "^#" | grep -v "^$" >/out/report.txt
      chown -R '"$(id -u):$(id -g)"' /out' "$seconds" "${graph[@]}"
  echo "$out/report.txt"
  head -25 "$out/report.txt"
}

case "${1:-}" in
  profile)
    profile "${2:-30}"
    ;;
  up)
    credentials
    database_up
    server_up
    ;;
  down)
    server_down
    docker stop "$database" >/dev/null 2>&1 || true
    ;;
  # Removes the kept world: the database volume and every stored file.
  reset)
    server_down
    docker rm -f "$database" >/dev/null 2>&1 || true
    docker volume rm "$volume" >/dev/null 2>&1 || true
    rm -rf "$home"
    ;;
  "" | -h | --help)
    echo "Usage: $0 up|down|reset|profile [seconds], or a harness command:" >&2
    cd "$root" && cargo run --quiet --release -p atlas-host --bin local_atlas
    ;;
  # Every other command is the Rust harness: world, real, region, resume, summary, ...
  *)
    cd "$root" && exec cargo run --quiet --release -p atlas-host --bin local_atlas -- "$@"
    ;;
esac
