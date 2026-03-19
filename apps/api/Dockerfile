# Stage 1: Install and build
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/db/package.json packages/db/tsconfig.json packages/db/
COPY packages/email/package.json packages/email/tsconfig.json packages/email/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/api/ apps/api/

# Build in dependency order: shared → db → email → api
RUN pnpm --filter @percy-main/shared run build && \
    pnpm --filter @percy-main/db run build && \
    pnpm --filter @percy-main/email run build && \
    pnpm --filter api run build

# Stage 2: Production
FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/email/package.json packages/email/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/src/migrations packages/db/src/migrations
COPY --from=builder /app/packages/email/dist packages/email/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/api/dist/server.js"]
