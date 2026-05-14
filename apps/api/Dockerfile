# Stage 1: Install and build
FROM node:26-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/db/package.json packages/db/tsconfig.json packages/db/
COPY packages/email/package.json packages/email/tsconfig.json packages/email/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/api/ apps/api/

# Build all packages except web (pnpm resolves dependency order automatically)
RUN pnpm --filter '!@percy-main/web' --filter '!email-viewer' run build

# Stage 2: Production
FROM node:26-alpine AS runner
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

# Install fonts for Sharp SVG rendering (OG images) and AWS RDS CA bundle
RUN apk add --no-cache fontconfig font-noto ca-certificates wget && \
    fc-cache -f && \
    wget -q https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
      -O /usr/local/share/ca-certificates/rds-global-bundle.crt && \
    update-ca-certificates && \
    apk del wget

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json apps/api/
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/db/package.json packages/db/
COPY --from=builder /app/packages/email/package.json packages/email/

RUN pnpm install --frozen-lockfile --prod

# Rewrite package exports from source to compiled dist. Matches any
# `"./src/<path>.ts"` export target and rewrites it to `"./dist/<path>.js"`,
# so both `./` (src/index.ts) and nested subpaths (src/auth/permissions.ts)
# work without each having a bespoke rule.
RUN sed -i \
    -e 's|"\./src/\([^"]*\)\.ts"|"./dist/\1.js"|g' \
    packages/*/package.json

COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/api/src/assets apps/api/dist/assets
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/db/src/migrations packages/db/src/migrations
COPY --from=builder /app/packages/email/dist packages/email/dist

ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/rds-global-bundle.crt
EXPOSE 3000

CMD ["node", "--import", "./apps/api/dist/instrumentation.js", "apps/api/dist/server.js"]
