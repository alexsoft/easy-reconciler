FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
COPY task ./task
RUN chmod +x packages/api/src/entrypoint.sh
WORKDIR /app/packages/api
EXPOSE 3001
CMD ["./src/entrypoint.sh"]
