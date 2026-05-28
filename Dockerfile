# Multi-stage build: compile on a build image with enough RAM, run on a slim runtime.
FROM node:20-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV SKIP_BUILD_CHECKS=true
# Render build VMs have ~2 GB RAM; skip the heavy TS worker and stay under the limit.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build:render

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/middleware.ts ./
COPY --from=builder /app/instrumentation.ts ./
COPY --from=builder /app/instrumentation-client.ts ./
COPY --from=builder /app/lib ./lib

EXPOSE 3000
CMD ["npm", "start"]
