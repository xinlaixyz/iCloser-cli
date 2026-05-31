# icloser Agent Shell — Makefile
# 跨平台构建自动化

VERSION := $(shell node -e "console.log(require('./package.json').version)")
OUT := out

.PHONY: all install test build clean package macos-pkg homebrew

all: install test

# ── Development ──────────────────────────────────

install:
	npm install

build:
	npx tsc

test:
	npx vitest run

smoke:
	node scripts/release-smoke.mjs

clean:
	rm -rf dist out

dev:
	npx tsx src/index.ts

# ── Offline Package (all platforms) ─────────────

package: build test
	node scripts/build-package.mjs

# ── macOS ───────────────────────────────────────

macos-pkg: build test
	@if [ "$$(uname -s)" != "Darwin" ]; then \
		echo "Error: must run on macOS to build .pkg"; exit 1; \
	fi
	bash scripts/build-macos-pkg.sh

homebrew-test:
	brew install --build-from-source ./homebrew/icloser.rb

# ── Quick Start ─────────────────────────────────

start:
	node dist/index.js

setup:
	node dist/index.js setup
