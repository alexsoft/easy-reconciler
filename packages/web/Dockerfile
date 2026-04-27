FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web
WORKDIR /app/packages/web
EXPOSE 5173
CMD ["pnpm", "dev"]
