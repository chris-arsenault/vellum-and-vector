#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dotnet publish "$ROOT_DIR/backend/Atlas.Api/Atlas.Api.csproj" -c Release -r linux-x64 \
  --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
  -o "$ROOT_DIR/.artifacts/publish"
cp "$ROOT_DIR/.artifacts/publish/Atlas.Api" "$ROOT_DIR/.artifacts/publish/bootstrap"
chmod 0755 "$ROOT_DIR/.artifacts/publish/bootstrap"
