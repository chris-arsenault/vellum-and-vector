.PHONY: ci lint format format-check typecheck test test-architecture test-perf test-browser terraform-fmt-check build dev rust-check test-rust contracts wasm-engine build-lan test-postgis local-up local-down local-world local-real local-resume local-profile

WASM_RUST_TOOLCHAIN := nightly-2026-11-14
WASM_BINDGEN_VERSION = $(shell awk '/^name = "wasm-bindgen"$$/ { getline; gsub(/"/, "", $$3); print $$3; exit }' Cargo.lock)

ci: lint format-check typecheck test test-architecture rust-check terraform-fmt-check

lint:
	pnpm lint

format:
	pnpm format

format-check:
	pnpm exec prettier --check packages '*.json' '*.ts' '*.yaml'
	cd frontend && pnpm exec prettier --check src '*.ts' '*.json' index.html

typecheck: wasm-engine
	pnpm typecheck

test: wasm-engine
	pnpm --dir frontend run test

# Generation uses the typed-array structures and bands, not object, Map or comparator
# substitutes; a finding names the site and its replacement.
test-architecture:
	pnpm exec vitest run -c vitest.architecture.config.ts
	cargo +stable clippy --workspace --lib -- -D clippy::disallowed_types
	cargo +stable test --workspace --doc

contracts:
	cargo run -p atlas-host --bin export_contracts
	pnpm exec prettier --write packages/map/src/generated.ts packages/map/src/generatedEditing.ts packages/map/src/generatedStructure.ts packages/atlas-context/src/generated.ts

wasm-engine:
	@command -v em++ >/dev/null || { echo 'Activate Emscripten SDK 6.0.10 before building the browser engine.' >&2; exit 1; }
	@version=$$(wasm-bindgen --version 2>/dev/null); \
	  if [ "$$version" != "wasm-bindgen $(WASM_BINDGEN_VERSION)" ]; then \
	    echo "Browser engine requires wasm-bindgen $(WASM_BINDGEN_VERSION) from Cargo.lock. Found: $${version:-missing}." >&2; \
	    exit 1; \
	  fi
	cargo +$(WASM_RUST_TOOLCHAIN) build -Zbuild-std=std,panic_abort -p atlas-host --bin atlas_browser --release --target wasm32-unknown-emscripten
	mkdir -p packages/engine/dist
	cp target/wasm32-unknown-emscripten/release/atlas_browser.js target/wasm32-unknown-emscripten/release/atlas_browser.wasm target/wasm32-unknown-emscripten/release/atlas_browser.d.ts packages/engine/dist/

test-rust:
	cargo test --workspace

rust-check:
	cargo +stable fmt --all --check
	cargo +stable clippy --workspace --all-targets -- -D warnings
	cargo +$(WASM_RUST_TOOLCHAIN) check -Zbuild-std=std,panic_abort --workspace --lib --target wasm32-unknown-emscripten
	cargo +stable test --workspace

# One run of each data structure against its substitute; numbers land in test-results/.
test-perf:
	ATLAS_PERF=1 pnpm exec vitest run -c vitest.architecture.config.ts

browser-fixture:
	cargo run -p atlas-host --example browser_fixture

test-browser:
	pnpm --dir frontend run test:browser

terraform-fmt-check:
	terraform fmt -check -recursive infrastructure/terraform/

build:
	pnpm build

# Run on Linux with CMake and a C++ compiler for bundled GEOS; Docker packages outputs.
build-lan: wasm-engine
	cargo build -p atlas-host --release --bin atlas_server
	mkdir -p atlas/dist
	cp target/release/atlas_server atlas/dist/atlas_server
	pnpm --dir frontend run build

test-postgis:
	cargo test -p atlas-host --features integration-tests --test postgres_maps

dev:
	pnpm dev

# Local atlas for verification (docs/local-atlas.md): database and native server on loopback,
# one kept world, real-scale maps opened from it. AT is in world metres, e.g. AT=500000,375000.
local-up:
	scripts/local-atlas.sh up

local-down:
	scripts/local-atlas.sh down

local-world:
	scripts/local-atlas.sh world

local-real:
	scripts/local-atlas.sh real --at $(AT) --hex $(or $(HEX),100m) --across $(or $(ACROSS),50) --kind $(or $(KIND),ground)

local-resume:
	scripts/local-atlas.sh resume $(JOB)

local-profile:
	scripts/local-atlas.sh profile $(or $(SECONDS),30)
