#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
mkdir -p .artifacts/e2e
TEST_DATABASE="vellum-vector-test-${BASHPID}"
API_PID=""
WEB_PID=""
cleanup() {
  if [[ -n "$API_PID" ]]; then kill "$API_PID" 2>/dev/null || true; fi
  if [[ -n "$WEB_PID" ]]; then kill "$WEB_PID" 2>/dev/null || true; fi
  docker stop "$TEST_DATABASE" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker run --rm -d --name "$TEST_DATABASE" -e POSTGRES_PASSWORD=atlas-test -p 127.0.0.1::5432 postgis/postgis:16-3.5 >/dev/null
for attempt in {1..60}; do
  if docker exec "$TEST_DATABASE" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
# Only this disposable test database receives automated administrator setup.
docker exec "$TEST_DATABASE" psql -U postgres -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS btree_gist;'
for migration in db/migrations/*.sql; do
  docker exec -i "$TEST_DATABASE" psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
done
DATABASE_BINDING="$(docker port "$TEST_DATABASE" 5432/tcp)"
DATABASE_PORT="${DATABASE_BINDING##*:}"
dotnet build backend/Atlas.Api/Atlas.Api.csproj -c Release --nologo
DATABASE_URL="Host=127.0.0.1;Port=${DATABASE_PORT};Username=postgres;Password=atlas-test;Database=postgres" \
  ASPNETCORE_ENVIRONMENT=Development ATLAS_AUTH_MODE=local ATLAS_RUN_WORKER=1 \
  dotnet backend/Atlas.Api/bin/Release/net8.0/Atlas.Api.dll --urls http://127.0.0.1:5010 > .artifacts/e2e/api.log 2>&1 &
API_PID=$!
cd frontend
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 26001 --strictPort > ../.artifacts/e2e/web.log 2>&1 &
WEB_PID=$!
wait -n "$API_PID" "$WEB_PID"
