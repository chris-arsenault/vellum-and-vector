#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
bash scripts/build-backend.sh
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend run build
db-migrate
terraform -chdir=infrastructure/terraform init -reconfigure \
  -backend-config="bucket=${STATE_BUCKET:-tfstate-559098897826}" \
  -backend-config="region=${STATE_REGION:-us-east-1}" -backend-config="use_lockfile=true"
terraform -chdir=infrastructure/terraform apply -auto-approve
