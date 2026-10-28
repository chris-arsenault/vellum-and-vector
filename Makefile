.PHONY: ci lint format format-check typecheck test test-architecture test-perf test-browser terraform-fmt-check build dev canonry-fixtures

ci: lint format-check typecheck test terraform-fmt-check

lint:
	pnpm lint

format:
	pnpm format

format-check:
	pnpm exec prettier --check packages '*.json' '*.ts' '*.yaml'
	cd frontend && pnpm exec prettier --check src '*.ts' '*.json' index.html

typecheck:
	pnpm typecheck

test:
	pnpm --dir frontend run test

# Expected to fail until the generation code adopts the typed-array structures; its output
# is the conversion list. Not part of ci.
test-architecture:
	pnpm exec vitest run -c vitest.architecture.config.ts

# One run of each data structure against its substitute; numbers land in test-results/.
test-perf:
	ATLAS_PERF=1 pnpm exec vitest run -c vitest.architecture.config.ts

test-browser:
	pnpm --dir frontend run test:browser

terraform-fmt-check:
	terraform fmt -check -recursive infrastructure/terraform/

build:
	pnpm build

dev:
	pnpm dev

canonry-fixtures:
	dotnet run --project tools/canonry-reference/CanonryReference.csproj -c Release -- packages/generation/fixtures/canonry-foundation.json packages/generation/src/canonry/contracts.generated.json
