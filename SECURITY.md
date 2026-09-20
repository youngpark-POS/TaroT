# Security policy

보안 문제에는 질문, 결과, 세션 토큰, API 키 또는 실제 사용자 데이터 예시를 포함하지 마세요. 공개 이슈 트래커 대신 저장소 소유자에게 비공개로 전달하세요.

운영 전 필수 사항:

- `.env.example`의 모든 개발용 키 교체
- HTTPS와 `COOKIE_SECURE=true`
- OpenAI Agents trace payload 비활성화 또는 완전한 본문 삭제
- 데이터베이스 TLS·KMS 암호화·백업 및 최소 권한 적용
- CSP의 `connect-src`를 실제 API origin으로 제한
- 의존성/컨테이너/IaC 취약점 검사
