FROM node:24-bookworm-slim

WORKDIR /workspace

# The project pins pnpm in package.json.  Activating the same version here keeps
# editor terminals and CI/Docker builds on an identical package-manager major.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@10.15.1 --activate \
    && mkdir -p /pnpm/store /workspace/node_modules \
    && chown -R node:node /pnpm /workspace

ENV PNPM_STORE_DIR=/pnpm/store
ENV HOME=/home/node

COPY --chmod=0755 .devcontainer/entrypoint.sh /usr/local/bin/tarot-dev-entrypoint

ENTRYPOINT ["/usr/local/bin/tarot-dev-entrypoint"]
CMD ["sleep", "infinity"]
