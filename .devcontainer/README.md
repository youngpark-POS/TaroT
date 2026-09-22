# TaroT development container

Open this repository with **Dev Containers: Reopen in Container** in VS Code or
Codex. The container runs Node.js 24 and the pnpm 10.15.1 version pinned by the
workspace. It starts only the existing PostgreSQL `db` Compose service; the API,
worker, and Vite app are run from the integrated terminal:

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The source tree is bind-mounted at `/workspace` for live editing. The root and
every workspace package's `node_modules` directory, plus pnpm's store, are
Docker named volumes. This deliberately prevents Windows host dependencies from
being used by the Linux container, avoiding native-module conflicts from tools
such as esbuild and sharp.

To reset the container's installed dependencies, remove the `tarot-dev-*`
Docker volumes, then rebuild the development container. The PostgreSQL data
uses the existing `tarot-postgres` volume and is not affected.
