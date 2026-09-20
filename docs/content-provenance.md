# 콘텐츠 provenance

## 이미지

카드 그림은 Pamela Colman Smith가 제작한 1909/1910 Rider–Waite–Smith 덱의 퍼블릭 도메인 스캔입니다. `pnpm content:fetch`는 Wikimedia Commons API를 통해 78장과 원본 Roses and Lilies 카드 뒷면을 한 번 수집하며, 각 파일의 `LicenseShortName` 또는 `UsageTerms`에 `Public domain`이 없으면 즉시 중단합니다.

수집 과정은 원본을 저장소에 남기지 않고 500px 폭의 WebP/AVIF 파생본만 `apps/web/public/cards`에 생성합니다. `packages/content/assets/provenance.json`에는 원본 페이지, 저작자 메타데이터, 원본 크기와 WebP SHA-256을 기록합니다. 런타임에는 Wikimedia Commons나 다른 외부 이미지 서버를 호출하지 않습니다.

- 덱 카테고리: <https://commons.wikimedia.org/wiki/Category:Rider-Waite-Smith_tarot_deck_(TaionWC)>
- 뒷면: <https://commons.wikimedia.org/wiki/File:Waite%E2%80%93Smith_Tarot_Roses_and_Lilies_cropped.jpg>

현대 재채색판이나 1971년 이후 판본은 포함하지 않습니다.

## 카드 의미

일차 사료는 Arthur Edward Waite의 퍼블릭 도메인 저작 *The Pictorial Key to the Tarot*입니다.

- <https://sacred-texts.com/tarot/pkt/index.htm>

원문 문장을 복제하지 않고 카드 상징과 전통적 정·역방향 의미를 현대 한국어의 비단정적 성찰 문장으로 편집했습니다. 마이너 아르카나는 슈트의 원소·주제와 수/코트의 전개를 함께 구조화했습니다.

## 스프레드

켈틱 크로스는 Waite의 전통적 순서를 기반으로 하되 위치 문구를 성찰형으로 다시 작성했습니다. 나머지 다섯 배열은 널리 쓰이는 한 장, 세 장, 선택지 비교와 관계 배열의 절차적 아이디어를 제품의 비단정적 원칙에 맞게 독자적으로 기술했습니다. 외부 사이트의 설명 문장을 복제하지 않습니다.

현재 콘텐츠 버전은 `2026-09-20.1`이며 모든 변경은 새 버전과 migration으로 추적합니다.
