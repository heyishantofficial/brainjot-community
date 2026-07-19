# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only production node_modules + source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure the non-root user owns the workdir
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

# Health check — Dokploy uses this to know the container is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "server.js"]
