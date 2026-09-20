# 운영 가이드

## 상태와 복구

- `needs_clarification`, `awaiting_spread`, `revealing`: 사용자가 이어서 진행할 수 있습니다.
- `interpreting`: worker가 PostgreSQL 작업 큐를 처리하며 최대 세 번 시도합니다.
- `completed`: 정상 해석을 반환합니다.
- `failed`: 검증된 카드 기본 의미로 만든 fallback 결과를 반환합니다.
- 24시간이 지난 리딩은 worker 정리 작업으로 삭제됩니다.

worker 재시작 후 `pending` 또는 `retry` 작업은 자동 복구됩니다. 5분 넘게 `running`인 작업은 시작 시점과 10분 주기의 정리 작업에서 `retry`로 회수합니다.

## 위기 지원 정보 점검

- 2026-09-20 기준 [보건복지부](https://www.mohw.go.kr/menu.es?mid=a10716040000)는 자살예방 상담전화 109를 24시간 상담 번호로 안내합니다.
- [경찰청 112](https://www.police.go.kr/www/agency/intro/intro0601.jsp)와 [소방청 119](https://www.nfa.go.kr/nfa/safetyinfo/emergencyservice/119emergencydeclaration/) 안내도 같은 날짜에 공식 사이트에서 확인했습니다.
- 출시 전과 분기마다 공식 안내를 다시 확인하고, 변경 시 애플리케이션 문구와 에이전트 안전 프롬프트를 함께 갱신합니다.

## 관측성

API 로그는 쿠키, 질문, 보충 답변을 마스킹합니다. 운영 시 아래 항목만 메트릭으로 내보냅니다.

- API/에이전트 성공률과 지연
- HTTP/작업 오류 코드
- 모델명, 토큰 사용량의 집계
- 스프레드 선택 수의 집계

질문, 결과, 카드 조합 및 세션 토큰 원문은 로그와 trace attribute에 넣지 않습니다.

## AWS 이전 체크리스트

1. Terraform remote state와 계정별 role을 설정합니다.
2. 이미지를 ECR에 digest로 push하고 API/worker task definition을 추가합니다.
3. Secrets Manager에 OpenAI 키와 세 개의 애플리케이션 키를 저장합니다.
4. migration one-off task 성공 후 API와 worker를 배포합니다.
5. `apps/web/dist`를 비공개 S3에 동기화하고 CloudFront invalidation을 실행합니다.
6. WAF, ACM, Route53, ALB HTTPS와 자동 확장 정책을 추가합니다.
7. RDS 백업 복구, 24시간 삭제, worker 장애 복구와 rate limit을 staging에서 검증합니다.
