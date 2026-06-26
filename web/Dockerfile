FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Cache-bust BEFORE copying source so a stale COPY layer can't be reused: this
# invalidates the COPY (and the build) on every commit. A cached COPY layer once
# shipped images built from old source.
ARG GIT_SHA=dev
RUN echo "source snapshot ${GIT_SHA}"
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
# Stamp the build commit into the runtime env so /api/version can report which
# code is actually running — the deploy workflow polls it to catch stale deploys.
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
