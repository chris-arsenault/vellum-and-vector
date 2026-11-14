#!/usr/bin/env bash
set -euo pipefail

# Shared CI jobs start from a clean checkout. Build the one browser target before
# frontend compilation or the existing Playwright scenarios need its bindings.
sudo apt-get update
sudo apt-get install -y cmake ninja-build
rustup toolchain install nightly --profile minimal --component rust-src
cargo install wasm-bindgen-cli --version 0.2.130 --locked
atlas_sdk_directory="${RUNNER_TEMP:?CI runner temporary directory}/emsdk-6.0.10"
curl -fsSL https://github.com/emscripten-core/emsdk/archive/refs/tags/6.0.10.tar.gz |
  tar -xz -C "$RUNNER_TEMP"
"$atlas_sdk_directory/emsdk" install 6.0.10
"$atlas_sdk_directory/emsdk" activate 6.0.10
source "$atlas_sdk_directory/emsdk_env.sh"
make wasm-engine
make browser-fixture
