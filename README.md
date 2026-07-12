# softphone

[![ghcr](https://github.com/thadeu/softphone/actions/workflows/ghcr.yml/badge.svg)](https://github.com/thadeu/softphone/actions/workflows/ghcr.yml)
[![release](https://img.shields.io/github/v/release/thadeu/softphone?sort=semver)](https://github.com/thadeu/softphone/releases)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-thadeu%2Fsoftphone-blue)](https://github.com/thadeu/softphone/pkgs/container/softphone)

Browser softphone for FreeSWITCH via Verto (`mod_verto`). Static SPA (React + Vite), served by nginx in production.

## Requirements

- [Bun](https://bun.sh)
- FreeSWITCH with `mod_verto` (WSS)
- Docker (optional)

## Quick start

```bash
make install
make dev
```

Open the app, set WebSocket URL (e.g. `wss://fs.example.com:8082`), extension, domain, password.

## Make targets

```bash
make install        # bun install
make dev            # vite --host
make build          # production build → dist/
make preview        # vite preview
make lint           # eslint
make start          # build + serve dist
make docker-build   # docker build ghcr.io/thadeu/softphone:latest
make docker-up      # compose up --build -d → :8080
make docker-down
make docker-logs
make docker-push
```

## Docker

```bash
make docker-up
# http://localhost:8080
```

Or pull the published image:

```bash
docker run --rm -p 8080:80 ghcr.io/thadeu/softphone:latest
```

Image: `ghcr.io/thadeu/softphone`

CI builds and pushes on tags `v*` (and `workflow_dispatch`). See `.github/workflows/ghcr.yml`.

## Voodu

```hcl
deployment "softphone" "web" {
  image = "ghcr.io/thadeu/softphone:latest"
  replicas = 1
}
```

Or keep Procfile/build mode and point ingress at the web process.

## Verto notes

- Signaling: JSON-RPC over WebSocket (`login`, `verto.invite`, `verto.answer`, `verto.bye`, `verto.info`)
- Media: WebRTC (browser ↔ FreeSWITCH)
- Auth failures often surface as `-32001` — check directory user/domain/password
- Page must be HTTPS (or localhost) for mic + WSS in production
