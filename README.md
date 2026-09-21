# TaroT

질문에 맞는 타로 스프레드를 추천하고, Rider–Waite–Smith 카드 공개 후 성찰 중심의 한국어 해석을 제공하는 헤드리스 웹 애플리케이션입니다.

## 구성

- `apps/web`: React/Vite 정적 SPA
- `apps/api`: Fastify `/v1` REST API와 OpenAPI 문서
- `apps/worker`: PostgreSQL 작업 큐를 처리하는 해석 worker
- `packages/content`: 78장 카드와 6개 스프레드의 canonical 지식 데이터
- `packages/agents`: 스프레드 선택/해석 에이전트와 오프라인 mock 구현
- `packages/database`: Drizzle 스키마, migration, seed, 저장소
- `infra/terraform`: AWS 이전용 검증 가능한 인프라 골격

## 빠른 시작

필수 도구는 Docker Desktop과 Docker Compose입니다. 카드 이미지는 저장소에 포함되어 있으므로 앱 실행 중 외부 웹 요청은 발생하지 않습니다.

```sh
docker compose up --build
```

- 웹: <http://localhost:8080>
- API: <http://localhost:4000>
- OpenAPI UI: <http://localhost:4000/docs>

기본값인 `AI_MODE=mock`은 API 키 없이 전체 흐름을 재현합니다. 실제 두 OpenAI 에이전트를 사용하려면 `.env.example`을 참고해 `.env`를 만들고 다음 값을 설정합니다.

```dotenv
AI_MODE=openai
OPENAI_API_KEY=...
SPREAD_MODEL=gpt-5.6-luna
READING_MODEL=gpt-5.6-terra
```

운영 환경에서는 세 HMAC/암호화 키를 서로 다른 강한 무작위 값으로 반드시 교체해야 합니다. OpenAI Agents SDK tracing은 질문 본문 유출을 막기 위해 운영 환경에서 `OPENAI_AGENTS_DISABLE_TRACING=1`로 비활성화하는 것을 권장합니다.

## 호스트 개발

Node.js 24 LTS와 pnpm 10을 사용합니다.

```sh
corepack enable
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm db:seed
pnpm dev
```

호스트 개발 웹은 <http://localhost:5173>, API는 <http://localhost:4000>에서 실행됩니다. 이때 `.env`의 `WEB_ORIGIN`도 `http://localhost:5173`이어야 합니다.

## 검증

```sh
pnpm content:validate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Playwright 브라우저를 설치한 환경에서는 `pnpm test:e2e`로 홈 화면 접근성 검사를 실행합니다. 실제 모델 평가는 비용과 키가 필요하므로 일반 CI에서 실행하지 않습니다.

## CI/CD

GitHub Actions는 pull request와 `main` push마다 콘텐츠, 포맷, lint, 타입, 단위·통합·브라우저 테스트, 빌드, Docker 전체 타깃과 Terraform을 검증합니다. 검증을 통과한 `main`은 API, worker, web, migration 이미지를 GHCR에 커밋 SHA 기반 불변 태그로 게시하고 정적 web bundle을 artifact로 보관합니다.

실제 AWS 인프라는 아직 적용하지 않으므로 ECS/S3 배포는 자동 실행하지 않습니다. 권한 구성, 이미지 목록, AWS 연결 절차는 [CI/CD 운영 문서](docs/ci-cd.md)를 참고하세요.

## 개인정보와 안전

- 익명 세션 쿠키는 HttpOnly이며 서버에는 키 해시만 저장합니다.
- 질문, 보충 설명과 결과는 AES-256-GCM으로 암호화하고 24시간 뒤 삭제합니다.
- 로그와 운영 지표에는 질문 및 결과 본문을 기록하지 않습니다.
- 의료·법률·투자·위기 관련 질문은 결정 지시 없이 성찰형으로 제한합니다.
- 즉각적 위기 표현에는 한국의 109·112·119 안내를 우선 표시합니다.

## Git 정책

저장소의 기존 Git 작성자 설정을 사용하며 자동화 도구 이름이나 공동 작성자 trailer를 커밋에 추가하지 않습니다. `main` 원격 저장소는 GitHub에 연결되어 있습니다.
