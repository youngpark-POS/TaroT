# TaroT Repository Guide

This file applies to the entire repository. Read it before changing code, content,
infrastructure, CI, or deployment behavior. More deeply nested `AGENTS.md` files, if
added later, may refine these instructions for their subtree.

## Product intent

TaroT is a Korean, mobile-first, headless tarot reading application. The intended
flow is:

1. Accept a user's question.
2. Ask at most one optional clarification question.
3. Recommend three catalogued spreads and let the user choose one.
4. Draw all cards on the server when the spread is selected and start preparing the
   interpretation immediately.
5. Reveal cards in the spread's required order without exposing unrevealed cards.
6. Show the prepared result only after every card has been revealed.

The product is for entertainment and reflection. Readings use warm Korean honorifics
and concrete, divinatory language, but must not present medical, legal, financial,
crisis, future, or third-party mental-state claims as certain facts.

Current MVP exclusions include accounts, permanent history, payments, public APIs,
sharing/PDF export, multiple decks, and an admin CMS. Anonymous reading data expires
after 24 hours.

## Repository map

- `apps/web`: React 19/Vite SPA, UI state recovery, polling, card reveal animation,
  accessibility, and same-origin API client.
- `apps/api`: Fastify REST API, validation, session cookies, public snapshot shaping,
  rate limiting, and Lambda/server entrypoints.
- `apps/worker`: PostgreSQL polling worker plus SQS and cleanup Lambda entrypoints.
- `packages/contracts`: Zod API/domain contracts. Treat these schemas as the public
  type source of truth.
- `packages/domain`: CSPRNG card draw, domain errors, safety classification, and
  agent/repository ports.
- `packages/agents`: the two allowed agent roles: spread recommendation and reading
  interpretation. It also contains deterministic mocks and evaluation cases.
- `packages/content`: versioned canonical data for 78 Rider-Waite-Smith cards, six
  spreads, sources, validation, and asset provenance.
- `packages/database`: PostgreSQL/Drizzle and DynamoDB repository implementations,
  migrations, seeders, conditional updates, idempotency, and queue dispatch.
- `packages/runtime`: environment validation, Secrets Manager loading, encryption,
  and keyed hashes.
- `infra/terraform`: long-term ECS/RDS skeleton.
- `infra/terraform/serverless-temp`: independently removable Lambda, SQS, DynamoDB,
  private S3, and CloudFront deployment.
- `.github/workflows`: CI, agent evaluations, temporary AWS deployment, and guarded
  teardown.
- `docs`: provenance, evaluation, operations, and CI/CD notes.
- `scripts/set-aws-secret.ps1`: out-of-band Secrets Manager population compatible
  with Windows PowerShell 5.1.

## Architecture invariants

### Reading state and disclosure

The reading state machine is:

`recommending -> needs_clarification | awaiting_spread -> revealing -> interpreting | completed`

`failed` and `expired` are terminal side states. Clarification may happen only once.

- Draw cards with the server-side CSPRNG/Fisher-Yates implementation in
  `packages/domain`; never use `Math.random()` for draws.
- Draw without duplicates. Orientation is an independent 50/50 random choice.
- Persist the full draw when a spread is selected, but public API serializers must
  expose only `draw.slice(0, revealedCount)`.
- Reveal order is strict. An out-of-order reveal is `409`.
- Every reveal requires `Idempotency-Key`; retries with the same key return the same
  response.
- Start interpretation when the spread is selected. A prepared result may be stored
  while status remains `revealing`, but it must never be returned before the final
  reveal.
- Keep `revealing` and interpretation progress logically separate. The final reveal
  moves directly to `completed` if a result is ready, otherwise to `interpreting`.
- Preserve conditional writes in DynamoDB and compare-and-update behavior in
  PostgreSQL. These prevent concurrent reveal and duplicate SQS corruption.
- The Celtic Cross layout rotation and a reversed card's 180-degree rotation are
  separate transforms; do not collapse them into one orientation value.

### Storage and asynchronous jobs

`TarotRepositoryPort` is the compatibility boundary. Any state transition change
must work with both implementations and have repository/state-machine tests.

- Local Docker uses `STORAGE_DRIVER=postgres`. Spread recommendation is synchronous;
  interpretation uses the PostgreSQL worker queue.
- Temporary AWS uses `STORAGE_DRIVER=dynamodb`. Both `recommend_spread` and
  `interpret_reading` run through SQS/Lambda.
- SQS is at-least-once delivery. Job version checks and conditional claims must make
  duplicate messages harmless.
- Messages contain IDs and versions, never plaintext questions or results.
- Keep `dispatchPending` until enqueue succeeds so cleanup can redispatch failures.
- After the final retry, preserve the draw and save the deterministic static-content
  fallback instead of losing the reading.
- DynamoDB TTL is only a backup. API access must reject expired records immediately,
  and cleanup performs timely physical deletion.

### Agents and content grounding

Exactly two application agent roles are permitted. They do not hand off directly;
the application state machine coordinates them.

- The spread agent may use only the stored spread catalogue and may return only
  catalogue IDs.
- The reading agent may use only the selected spread, drawn card orientations, and
  canonical card meanings supplied by the application. Do not add runtime web search.
- Agent responses are schema-validated. Keep IDs valid and retain the deterministic
  mock/fallback path.
- Keep output compact: overall summary and each per-card interpretation should be
  concrete Korean divination-style prose in 2-3 sentences, followed by 2-3 reflection
  questions.
- Keep SDK tracing disabled because prompts contain user questions.
- When `AI_MODE=openai`, the key may come from Secrets Manager rather than
  `process.env`. Pass `config.OPENAI_API_KEY` explicitly to the Agents SDK setup via
  `setDefaultOpenAIKey`; do not assume loading a config object mutates the environment.
- Do not silently change the configured models or reasoning levels. Model changes
  require current official OpenAI documentation, an explicit rationale, and live
  evaluation outside normal CI.

Canonical content is code-reviewed, versioned data rather than model output.

- Maintain exactly 78 cards (22 major, 56 minor) and six approved spreads.
- Every card requires upright/reversed meanings, sources, image paths, and provenance.
- Use only verified public-domain Rider-Waite-Smith scans. Do not generate replacement
  card art or use modern recolorings with uncertain rights.
- Runtime/builds must not scrape third-party sites or hotlink card images.
- Keep optimized AVIF/WebP assets and provenance in Git; do not commit large source
  scans.
- Content changes need a new content version and idempotent seed behavior. Run
  `pnpm content:validate`.

## Security and privacy invariants

- Never commit `.env`, API keys, AWS credentials, application encryption keys,
  session tokens, Terraform state, or plaintext production questions/results.
- Never print or copy secret values during diagnosis. Verify secret metadata/version
  rather than retrieving its value when possible.
- Keep OpenAI keys server-side. The browser must never receive them.
- Questions, clarification answers, and results are AES-256-GCM encrypted at rest.
  The anonymous session token is stored only as a keyed hash; the cookie remains
  `HttpOnly`, `Secure` in production, and `SameSite=Lax`.
- Logs, metrics, traces, errors, test fixtures, PR text, and GitHub artifacts must not
  contain real user questions or generated readings. Log IDs, job types, safe error
  categories, latency, and counts only.
- Preserve the five-completed-readings-per-hour protection based on anonymous session
  and rotating HMAC IP buckets. Internal retries do not consume another reading.
- Preserve safety banners and Korean 109/112/119 crisis guidance. Provider refusals
  are not to be bypassed.
- CORS remains restricted to the configured web origin. Keep request/body limits,
  origin checks, security headers, redaction, and timeouts.

## Temporary AWS deployment invariants

The temporary stack is intentionally separate from the long-term ECS/RDS Terraform.
Do not merge the two state files or make the temporary stack depend on a VPC, NAT,
RDS, ECS, or ECR.

- Region is `ap-northeast-2` unless the deployment configuration explicitly changes.
- Browser traffic uses one CloudFront origin. S3 and the Lambda Function URL remain
  private and accessible through CloudFront OAC only.
- API behaviors are uncacheable. Preserve cookies, query strings, and required
  headers.
- Browser requests with a body must retain the lowercase
  `x-amz-content-sha256` hash generated in `apps/web/src/api.ts`; CloudFront OAC needs
  it to sign POST requests correctly.
- Build the deployed SPA with `VITE_API_URL=''` so API calls remain same-origin.
- SPA rewriting belongs only on the S3 behavior. Never turn API 403/404/5xx responses
  into `index.html`.
- Secret values are populated out of band. Never put them in Terraform variables,
  state, GitHub variables/artifacts, or Lambda environment variables; Lambda receives
  only the secret ARN and caches the loaded value per execution environment.
- Preserve Lambda aliases, S3 versioning, rollback capture, queue DLQ/redrive, alarms,
  budgets, and least-privilege IAM.
- Deployment is through `.github/workflows/deploy-serverless.yml` after successful
  main CI and `aws-temp` environment approval. Do not bypass it with an unreviewed
  local apply.
- Destruction requires the dedicated workflow and exact confirmation phrase. Never
  destroy the app stack, bootstrap state bucket, or OIDC role without explicit user
  authorization and state-backup verification.

## Local development

Required versions are Node.js 24 LTS and pnpm 10.15.1. The Windows host may have an
older Node version; prefer the Dev Container or Docker rather than weakening the
engine requirement.

Fastest full stack:

```sh
docker compose up -d --build db migrate api worker web
```

Endpoints:

- Web: `http://localhost:8080`
- API: `http://localhost:4000`
- Development OpenAPI UI: `http://localhost:4000/docs`

For host/Dev Container development:

```sh
corepack enable
pnpm install --frozen-lockfile
docker compose up -d db
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The Dev Container keeps Linux `node_modules` and the pnpm store in named volumes.
Do not reuse Windows host `node_modules` in the container. Production Lambda does not
serve Swagger UI; enabling it there can make the single-file bundle look for missing
`/var/task/static` assets.

After changing `.env`, recreate affected services because Compose environment values
are fixed at container creation:

```sh
docker compose up -d --build --force-recreate api worker web
```

Run Compose commands from the repository root containing `docker-compose.yml`.

## Validation expectations

Use the narrowest checks while iterating, then run the complete gate before a PR:

```sh
pnpm content:validate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform/serverless-temp init -backend=false
terraform -chdir=infra/terraform/serverless-temp validate
```

Also build all Docker targets for deployment-impacting changes. Normal tests use
`AI_MODE=mock`; never spend OpenAI tokens in ordinary CI. Live model evaluations and
production smoke tests are explicit/manual checks with sanitized inputs.

Tests must cover these high-risk regressions when relevant:

- no unrevealed-card leakage in any response;
- reveal ordering, idempotency, and concurrent updates;
- PostgreSQL/DynamoDB state-machine parity;
- duplicate SQS delivery, retry, fallback, DLQ, and dispatch recovery;
- result invisibility until the final reveal;
- expiration and cleanup;
- keyboard, reduced-motion, and axe accessibility behavior;
- private S3/Function URL denial and CloudFront end-to-end success.

## Coding and change discipline

- Keep TypeScript strict. This repository enables `exactOptionalPropertyTypes`; do
  not pass `undefined` to an optional property unless its declared type permits it.
- Prefer shared Zod contracts and repository ports over duplicating request or state
  shapes in an app.
- Return API errors as `application/problem+json` and avoid leaking internals.
- Preserve accessibility: keyboard reveal, visible focus, screen-reader status,
  useful alt text, contrast, and `prefers-reduced-motion` fallback.
- Avoid unrelated formatting or generated-file churn. Preserve user changes in a
  dirty worktree.
- Update operational/provenance docs whenever behavior, deployment, content sources,
  or recovery procedures change.

## Git and delivery

- `main` is protected. Work on a focused branch, open a PR, wait for required checks,
  and squash merge.
- Do not change the user's Git identity. Do not add Codex as author, committer,
  co-author, or trailer.
- Do not commit secrets, Terraform plans/state, Lambda zip artifacts, build output,
  logs, or large source images.
- Dependabot is intentionally disabled unless the user explicitly asks to re-enable
  it.
- Never create a remote, push to a different remote, force-push, deploy, or destroy
  infrastructure without the user's scope or an already-established instruction for
  that operation.
