FROM node:24-bookworm-slim AS workspace
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agents/package.json packages/agents/package.json
COPY packages/content/package.json packages/content/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/runtime/package.json packages/runtime/package.json
RUN --mount=type=cache,id=tarot-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY . .

FROM workspace AS build
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build

FROM workspace AS tooling
CMD ["pnpm", "db:migrate"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
COPY --from=build /workspace /workspace

FROM runtime AS api
EXPOSE 4000
CMD ["node", "apps/api/dist/server.cjs"]

FROM runtime AS worker
CMD ["node", "apps/worker/dist/worker.cjs"]

FROM nginx:1.29-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
