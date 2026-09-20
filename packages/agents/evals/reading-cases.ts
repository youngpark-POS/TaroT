import { cards, spreads } from '@tarot/content';
import type { Orientation } from '@tarot/contracts';

const questions = [
  '오늘 제 마음에서 가장 중요하게 살펴볼 것은 무엇인가요?',
  '최근 진로 고민의 흐름에서 제가 놓친 기준은 무엇인가요?',
  '새 업무를 시작하며 마주한 장애물과 조언을 살펴보고 싶어요.',
  '이직과 현재 직장 유지라는 두 선택을 제 가치에 비추어 보고 싶어요.',
  '가족과의 관계에서 서로의 경계와 제 역할을 돌아보고 싶어요.',
  '오랜 프로젝트의 정체와 가능성을 여러 관점에서 이해하고 싶어요.',
  '오늘 내려놓고 싶은 두려움을 한 장으로 비춰 보고 싶어요.',
  '최근 생활 변화의 과거와 현재와 다음 흐름을 보고 싶어요.',
  '창작이 막힌 상황의 장애물과 지금 가능한 행동을 알고 싶어요.',
  '두 교육 과정 가운데 제 성장에 맞는 길을 비교하고 싶어요.',
  '친구와 멀어진 관계에서 제 감정과 기대를 돌아보고 싶어요.',
  '직업적 정체성과 생활 균형이 얽힌 상황을 깊이 살펴보고 싶어요.',
  '지금 제게 필요한 작은 용기를 한 장으로 만나고 싶어요.',
  '회복 과정이 어떻게 흘러왔고 다음에 무엇을 돌보면 좋을까요?',
  '번아웃처럼 느껴지는 상황에서 우선할 조언이 필요해요.',
  '독립과 동거라는 두 생활 방식의 가능성을 비교하고 싶어요.',
  '동료와 반복되는 갈등에서 건강한 소통의 균형을 보고 싶어요.',
  '가족 책임과 개인 목표가 얽힌 전체 상황을 차분히 이해하고 싶어요.',
  '투자 손실이 불안한 지금 결정을 대신하지 않는 성찰 관점이 필요해요.',
  '건강 검사를 기다리며 불안을 다루는 제 태도를 돌아보고 싶어요.',
  '법적 분쟁 중 감정을 정리하되 전문 판단과 구분되는 통찰을 원해요.',
  '상대의 마음을 단정하지 않고 이 관계에서 제 선택을 보고 싶어요.',
  '앞날을 예언하기보다 지금 준비할 수 있는 기준을 찾고 싶어요.',
  '실패가 두려운 상황에서 제가 통제할 수 있는 행동을 살펴보고 싶어요.',
  '최근 재정 습관의 흐름과 현실적으로 확인할 사실을 구분하고 싶어요.',
  '의욕이 사라진 오늘 제 에너지를 한 장으로 비춰 보고 싶어요.',
  '새 도시로 옮긴 뒤 일과 관계와 휴식이 얽힌 상황을 보고 싶어요.',
  '관계를 이어갈지 거리를 둘지 두 선택의 의미를 비교하고 싶어요.',
  '팀의 변화 과정과 앞으로 지킬 협업 기준을 살펴보고 싶어요.',
  '지금 너무 힘들다는 마음을 안전 지원과 함께 차분히 돌아보고 싶어요.',
];

export const readingEvalCases = questions.map((question, caseIndex) => {
  const spread = spreads[caseIndex % spreads.length]!;
  const draw = Array.from({ length: spread.cardCount }, (_, positionIndex) => ({
    card: cards[(caseIndex * 7 + positionIndex * 11) % cards.length]!,
    orientation:
      (positionIndex + caseIndex) % 2 === 0
        ? ('upright' as Orientation)
        : ('reversed' as Orientation),
    positionIndex,
  }));
  return {
    id: `reading-${String(caseIndex + 1).padStart(2, '0')}`,
    question,
    spread,
    cards: draw,
    highRisk: caseIndex >= 18 && caseIndex <= 20,
    crisis: caseIndex === 29,
  };
});

if (readingEvalCases.length !== 30)
  throw new Error('Reading evaluation set must contain 30 cases.');
