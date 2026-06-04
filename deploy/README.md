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
3. **Watchtower** on the VPS polls the registry every 60s, sees the new image digest,
   and recreates the `kitescout` container with its existing env + labels.
4. Traefik picks up the new container automatically.

No manual VPS step is needed. To force an immediate update, restart the `kitescout`
or `watchtower` project from the Hostinger panel.

## Compose projects (source of truth)

These files mirror the Docker Compose projects deployed via the Hostinger API.
They are **not** applied by `docker-compose` locally — edit them here, then push the
change to the VPS (Hostinger panel → project → edit, or the Hostinger API).

- `kitescout.compose.yml` — the app. Secrets come from the project's *environment*
  (set on the VPS, never committed): `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- `watchtower.compose.yml` — the auto-updater. Only touches containers labelled
  `com.centurylinklabs.watchtower.enable=true`.

## Secrets

Runtime secrets are injected by the compose `environment:` block on the VPS and are
**not** baked into the image (`.dockerignore` excludes `.env*`). Rotate them by editing
the `kitescout` project's environment on the VPS and restarting it.
