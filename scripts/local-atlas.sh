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
port="${ATLAS_LOCAL_PORT:-44138}"

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

server_up() {
  command -v cmake >/dev/null || { echo "Put CMake on PATH to build the native server" >&2; exit 1; }
  (cd "$root" && cargo build --release -p atlas-host --bin atlas_server)
  server_down
  local url="postgresql://%s:%s@127.0.0.1:$database_port/%s"
  mkdir -p "$home/map-assets" "$home/generation-resources" "$home/scratch"
  # shellcheck disable=SC2059
  ATLAS_BIND="127.0.0.1:$port" \
    ATLAS_MAP_DATABASE_URL="$(printf "$url" atlas_maps "$ATLAS_LOCAL_MAP_PASSWORD" vellum_maps)" \
    ATLAS_MAP_READER_URL="$(printf "$url" atlas_map_reader "$ATLAS_LOCAL_MAP_READER_PASSWORD" vellum_maps)" \
    ATLAS_GENERATION_DATABASE_URL="$(printf "$url" atlas_generation "$ATLAS_LOCAL_GENERATION_PASSWORD" vellum_generation)" \
    ATLAS_MAP_ASSETS="$home/map-assets" \
    ATLAS_GENERATION_RESOURCES="$home/generation-resources" \
    ATLAS_GENERATION_SCRATCH="$home/scratch" \
    ATLAS_FRONTEND="$root/frontend/dist" \
    nohup "$root/target/release/atlas_server" >"$home/server.log" 2>&1 &
  echo $! >"$home/server.pid"
  for _ in $(seq 60); do
    curl -s -o /dev/null "http://127.0.0.1:$port/" && { echo "Local atlas at http://127.0.0.1:$port/"; return; }
    kill -0 "$(cat "$home/server.pid")" 2>/dev/null || break
    sleep 1
  done
  echo "The server did not start; see $home/server.log" >&2
  exit 1
}

case "${1:-}" in
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
  *)
    echo "Usage: $0 up|down|reset" >&2
    exit 2
    ;;
esac
