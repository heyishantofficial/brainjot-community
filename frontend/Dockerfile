# ── Stage 1: build the Vite/React app ─────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_ env vars must be available at build time.
# Pass them as build args so Dokploy can inject them.
ARG VITE_API_URL
ARG VITE_MAIN_APP_URL
ARG VITE_MAIN_API_URL

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_MAIN_APP_URL=$VITE_MAIN_APP_URL
ENV VITE_MAIN_API_URL=$VITE_MAIN_API_URL

RUN npm run build

# ── Stage 2: serve with Nginx ──────────────────────────────────────────────────
FROM nginx:alpine AS runner

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the Vite build output
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
