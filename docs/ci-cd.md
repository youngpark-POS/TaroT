# CI/CD 운영

`.github/workflows/ci.yml`은 pull request와 `main` 변경을 같은 검증 절차로 통합하고, 검증된 `main`만 배포 가능한 산출물로 게시합니다.

## 실행 흐름

1. `quality`: 콘텐츠 검증, 포맷, lint, 타입 검사, 단위·통합·브라우저 테스트, 애플리케이션 빌드, Terraform 검증을 실행합니다.
2. `container-build`: API, worker, web, migration Docker 타깃을 모두 실제로 빌드합니다. pull request에서는 레지스트리에 쓰지 않습니다.
3. `publish`: `main`의 앞선 작업이 모두 성공했을 때만 네 이미지를 GHCR에 게시하고 provenance 및 SBOM을 생성합니다.

게시되는 이미지는 다음과 같습니다.

- `ghcr.io/youngpark-pos/tarot-api`
- `ghcr.io/youngpark-pos/tarot-worker`
- `ghcr.io/youngpark-pos/tarot-web`
- `ghcr.io/youngpark-pos/tarot-migrate`

각 이미지는 롤백 가능한 불변 태그 `sha-<40자리 커밋 SHA>`와 개발 확인용 `latest` 태그를 가집니다. 운영 배포는 반드시 불변 SHA 태그 또는 digest를 사용합니다. 정적 웹 빌드는 동일한 커밋 SHA가 포함된 GitHub Actions artifact로 14일간 보관합니다.

운영 API 주소가 정해지면 GitHub repository variable `PUBLIC_API_URL`에 HTTPS API origin을 설정합니다. 설정하지 않으면 로컬 기본값인 `http://localhost:4000`으로 web 이미지를 빌드하므로 외부 환경에 배포하면 안 됩니다.

## 비밀정보와 권한

- pull request 작업에는 `contents: read`만 부여합니다.
- GHCR 게시 작업에만 `packages: write`, attestation용 `id-token: write`와 `attestations: write`를 부여합니다.
- `GITHUB_TOKEN`은 GitHub가 작업별로 발급하며 저장소에 별도 토큰을 저장하지 않습니다.
- OpenAI API 키와 애플리케이션 암호화 키는 CI/CD 빌드에 필요하지 않으며 workflow에 전달하지 않습니다.
- 외부 기여자의 pull request는 이미지를 게시할 수 없습니다.

## AWS 실제 배포 연결

장기 ECS/RDS Terraform은 여전히 검증용 골격으로 유지합니다. 별도로
`infra/terraform/serverless-temp`와 `Deploy temporary serverless AWS` workflow가 임시
Lambda/S3 스택을 실제 배포합니다.

임시 배포는 `main` CI 성공 뒤 보호된 `aws-temp` environment 승인을 기다리고, GitHub OIDC
역할로 Terraform plan/apply, DynamoDB 콘텐츠 seed, S3 동기화, CloudFront invalidation과 health
smoke test를 실행합니다. 배포 도중 실패하면 직전 Lambda alias와 SPA 파일을 복구합니다. 특정
커밋으로 되돌릴 때는 수동 실행의 `git_sha`에 해당 SHA를 입력합니다. Bootstrap, secret 입력,
종료 절차는 [임시 서버리스 런북](../infra/terraform/serverless-temp/README.md)을 따릅니다.

장기 AWS 환경이 준비되면 다음 순서로 ECS/RDS 배포를 연결합니다.

1. GitHub의 `production` environment에 main 브랜치 보호 및 필요 시 승인자를 설정합니다.
2. 장기 AWS access key 대신 GitHub OIDC를 신뢰하는 최소 권한 IAM role을 만듭니다.
3. GHCR의 불변 digest를 ECR로 복제하거나 동일 커밋을 ECR에 게시합니다.
4. `tarot-migrate`를 일회성 ECS task로 완료한 뒤 API와 worker task definition을 새 digest로 등록합니다.
5. 정적 web artifact를 비공개 S3에 동기화하고 CloudFront 무효화를 실행합니다.
6. API health check와 ECS 안정화를 확인한 뒤 배포를 완료합니다.

실제 AWS 계정, 도메인, ECS 서비스 이름과 OIDC role ARN이 확정되기 전에는 workflow에 빈 배포 명령이나 장기 자격 증명을 추가하지 않습니다.
