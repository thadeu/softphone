IMAGE ?= ghcr.io/thadeu/softphone
TAG   ?= latest

.PHONY: help install dev build preview lint start test test-watch \
	docker-build docker-up docker-down docker-logs docker-push

help:
	@echo "targets:"
	@echo "  make install       bun install"
	@echo "  make dev           vite --host"
	@echo "  make build         production build"
	@echo "  make preview       vite preview"
	@echo "  make lint          eslint"
	@echo "  make test          vitest run"
	@echo "  make test-watch    vitest watch"
	@echo "  make start         build + serve dist"
	@echo "  make docker-build  docker build $(IMAGE):$(TAG) (host arch)"
	@echo "  make docker-up     compose up --build -d"
	@echo "  make docker-down   compose down"
	@echo "  make docker-logs   compose logs -f"
	@echo "  make docker-push   buildx push amd64+arm64 $(IMAGE):$(TAG)"

install:
	bun install

dev:
	bun run dev

build:
	bun run build

preview:
	bun run preview

lint:
	bun run lint

test:
	bun run test

test-watch:
	bun run test:watch

start:
	bun run start

docker-build:
	docker build -t $(IMAGE):$(TAG) .

docker-up:
	docker compose -f compose.yml up --build -d

docker-down:
	docker compose -f compose.yml down

docker-logs:
	docker compose -f compose.yml logs -f

docker-push:
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE):$(TAG) --push .
