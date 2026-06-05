# Deployment

KiteScout web (`web/`) runs on a Hostinger VPS (id `1601314`, IP `187.77.70.112`)
behind Traefik, which terminates TLS with Let's Encrypt.

## Live URLs

| URL | Service |
|---|---|
| https://kitescout.tech, https://www.kitescout.tech | KiteScout web app |
| https://map.kitescout.tech | cruise-map (static nginx) |

## Push-to-deploy

1. Push to `main` touching `web/**`.
2. GitHub Actions (`.github/workflows/docker-publish.yml`) builds `web/Dockerfile`
   and pushes `ghcr.io/0xaaronx0/kitescout:latest` (the GHCR package is **public**).
3. The workflow's `deploy` job calls the Hostinger API
   (`POST /api/vps/v1/virtual-machines/1601314/docker/kitescout/update`, bearer
   `secrets.HOSTINGER_API_TOKEN`) to pull the new image and recreate the container,
   then health-checks `https://kitescout.tech`.
4. Traefik picks up the new container automatically.

This is the single deploy path. (Watchtower was removed — running it alongside the
API-triggered deploy caused a double-recreate race that produced a brief 502 window
and tripped the health check.) To force an update manually, re-run the workflow from
the Actions tab (`workflow_dispatch`) or restart the `kitescout` project in the panel.

## Compose projects (source of truth)

These files mirror the Docker Compose projects deployed via the Hostinger API.
They are **not** applied by `docker-compose` locally — edit them here, then push the
change to the VPS (Hostinger panel → project → edit, or the Hostinger API).

- `kitescout.compose.yml` — the app. Secrets come from the project's *environment*
  (set on the VPS, never committed): `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`.

## Secrets

Runtime secrets are injected by the compose `environment:` block on the VPS and are
**not** baked into the image (`.dockerignore` excludes `.env*`). Rotate them by editing
the `kitescout` project's environment on the VPS and restarting it.
