# base stage
FROM oven/bun:1.4.4-debian AS base
WORKDIR /app

# dependencies stage
FROM base AS deps
COPY ["package.json", "bun.lock", "./"]
RUN bun install --frozen-lockfile

# builder stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# runner stage
FROM base AS runner
COPY --from=builder --chown=bun:bun /app/.next/standalone ./
COPY --from=builder --chown=bun:bun /app/.next/static ./.next/static
COPY --from=builder --chown=bun:bun /app/public ./public

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

USER bun

CMD ["bun", "server.js"]



