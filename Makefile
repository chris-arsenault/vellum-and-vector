.PHONY: ci lint format format-check typecheck test test-browser terraform-fmt-check build dev

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
	pnpm test
	pnpm --dir frontend run test

test-browser:
	pnpm --dir frontend run test:browser

terraform-fmt-check:
	terraform fmt -check -recursive infrastructure/terraform/

build:
	pnpm build

dev:
	pnpm dev
