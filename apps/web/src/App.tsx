import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicReading, ReadingResult, Spread } from '@tarot/contracts';
import { CRISIS_SUPPORT_MESSAGE } from '@tarot/contracts/safety';
import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api } from './api.js';

const examples = [
  '지금 제 진로에서 가장 먼저 살펴볼 것은 무엇인가요?',
  '이 관계에서 건강한 경계를 세우려면 무엇이 필요할까요?',
  '두 선택지 사이에서 제가 중요하게 봐야 할 기준은 무엇인가요?',
];

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="TaroT 처음으로">
          <span className="brand-mark" aria-hidden="true">
            ✦
          </span>
          <span>TaroT</span>
        </Link>
        <span className="header-note">질문을 비추는 카드</span>
      </header>
      <main>{children}</main>
      <footer>타로는 성찰을 위한 상징적 도구이며 전문적인 판단을 대신하지 않습니다.</footer>
    </div>
  );
}

function HomePage() {
  const [question, setQuestion] = useState('');
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: api.createReading,
    onSuccess: (reading) => navigate(`/reading/${reading.id}`),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim().length >= 5) create.mutate(question.trim());
  };
  return (
    <section className="hero page-grid">
      <div className="hero-copy">
        <p className="eyebrow">A quiet moment with the cards</p>
        <h1>
          마음속 질문에
          <br />
          새로운 시선을 건네요.
        </h1>
        <p className="lead">
          질문을 들려주면 여섯 가지 배열 중 가장 어울리는 방식을 골라 드릴게요. 답을 단정하기보다
          스스로의 기준을 발견하는 시간을 만들어요.
        </p>
        <div className="notice-card">
          <span aria-hidden="true">◌</span>
          <p>의료·법률·투자처럼 중요한 결정은 반드시 해당 분야 전문가와 확인해 주세요.</p>
        </div>
      </div>
      <form className="question-panel" onSubmit={submit}>
        <div className="ornament" aria-hidden="true">
          ☾ · ✦ · ☽
        </div>
        <label htmlFor="question">지금 마음에 머무는 질문</label>
        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          minLength={5}
          maxLength={500}
          placeholder="예: 새로운 일을 시작하기 전에 무엇을 살펴보면 좋을까요?"
          rows={6}
          required
        />
        <div className="character-count">{question.length} / 500</div>
        <div className="example-list" aria-label="예시 질문">
          {examples.map((example) => (
            <button
              type="button"
              className="chip"
              key={example}
              onClick={() => setQuestion(example)}
            >
              {example}
            </button>
          ))}
        </div>
        {create.error && <ErrorMessage error={create.error} />}
        <button
          className="primary-button"
          type="submit"
          disabled={create.isPending || question.trim().length < 5}
        >
          {create.isPending ? '질문을 바라보는 중…' : '나에게 맞는 스프레드 찾기'}
        </button>
        <p className="privacy-note">질문과 결과는 암호화되어 24시간 뒤 자동으로 삭제됩니다.</p>
      </form>
    </section>
  );
}

function ErrorMessage({ error }: { error: unknown }) {
  return (
    <div className="error-message" role="alert">
      {error instanceof Error ? error.message : '문제가 생겼어요.'}
    </div>
  );
}

function CrisisBanner({ crisis }: { crisis: boolean }) {
  if (!crisis) return null;
  return (
    <aside className="crisis-banner" role="alert">
      <strong>지금 안전이 가장 중요해요.</strong>
      <p>{CRISIS_SUPPORT_MESSAGE}</p>
    </aside>
  );
}

function Clarification({ reading }: { reading: PublicReading }) {
  const [answer, setAnswer] = useState('');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ skip }: { skip: boolean }) => api.clarify(reading.id, answer, skip),
    onSuccess: (data) => queryClient.setQueryData(['reading', reading.id], data),
  });
  return (
    <section className="center-panel narrow">
      <p className="step-label">질문을 조금 더 선명하게</p>
      <h1>{reading.clarificationQuestion}</h1>
      <p className="muted">
        한 번만 여쭤볼게요. 답하기 어렵다면 현재 질문으로 바로 진행할 수 있어요.
      </p>
      <textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        maxLength={500}
        rows={5}
        aria-label="보충 설명"
      />
      {mutation.error && <ErrorMessage error={mutation.error} />}
      <div className="button-row">
        <button
          className="secondary-button"
          onClick={() => mutation.mutate({ skip: true })}
          disabled={mutation.isPending}
        >
          건너뛰기
        </button>
        <button
          className="primary-button"
          onClick={() => mutation.mutate({ skip: false })}
          disabled={mutation.isPending || answer.trim().length < 2}
        >
          답변하고 계속
        </button>
      </div>
    </section>
  );
}

function SpreadSelection({ reading }: { reading: PublicReading }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (spreadId: string) => api.selectSpread(reading.id, spreadId),
    onSuccess: (data) => queryClient.setQueryData(['reading', reading.id], data),
  });
  const spreadMap = new Map(reading.availableSpreads.map((spread) => [spread.id, spread]));
  return (
    <section className="selection-section">
      <div className="section-heading">
        <p className="step-label">당신의 질문에 어울리는 배열</p>
        <h1>세 가지 시선을 준비했어요.</h1>
        <p>가장 추천하는 배열을 먼저 보여 드리지만, 마음이 가는 다른 방식을 골라도 좋아요.</p>
      </div>
      <div className="spread-list">
        {reading.recommendations.map((recommendation, index) => {
          const spread = spreadMap.get(recommendation.spreadId);
          if (!spread) return null;
          return (
            <SpreadOption
              key={spread.id}
              spread={spread}
              reason={recommendation.reason}
              recommended={index === 0}
              onSelect={() => mutation.mutate(spread.id)}
              disabled={mutation.isPending}
            />
          );
        })}
      </div>
      {mutation.error && <ErrorMessage error={mutation.error} />}
    </section>
  );
}

function SpreadOption({
  spread,
  reason,
  recommended,
  onSelect,
  disabled,
}: {
  spread: Spread;
  reason: string;
  recommended: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  return (
    <article className={`spread-option ${recommended ? 'recommended' : ''}`}>
      {recommended && <span className="recommend-badge">가장 추천해요</span>}
      <div className="mini-layout" aria-hidden="true">
        {spread.positions.map((position) => (
          <span
            key={position.id}
            style={{
              left: `${position.coordinate.x}%`,
              top: `${position.coordinate.y}%`,
              rotate: `${position.coordinate.rotation}deg`,
            }}
          />
        ))}
      </div>
      <div className="spread-copy">
        <h2>{spread.name}</h2>
        <p>{reason}</p>
        <div className="spread-meta">
          <span>{spread.cardCount}장</span>
          <span>약 {spread.durationMinutes}분</span>
        </div>
      </div>
      <button
        className={recommended ? 'primary-button' : 'secondary-button'}
        onClick={onSelect}
        disabled={disabled}
      >
        이 배열로 시작
      </button>
    </article>
  );
}

function CardStage({ reading }: { reading: PublicReading }) {
  const queryClient = useQueryClient();
  const reveal = useMutation({
    mutationFn: (positionIndex: number) => api.reveal(reading.id, positionIndex),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['reading', reading.id] }),
  });
  const revealed = new Map(reading.revealedCards.map((card) => [card.positionIndex, card]));
  const spread = reading.selectedSpread!;
  return (
    <section className="reading-section">
      <div className="reading-heading">
        <p className="step-label">{spread.name}</p>
        <h1>
          {reading.status === 'interpreting'
            ? '카드의 이야기를 잇고 있어요.'
            : `${(reading.nextPositionIndex ?? spread.cardCount) + (reading.status === 'revealing' ? 1 : 0)}번째 카드를 만나 보세요.`}
        </h1>
        {reading.status === 'revealing' && reading.nextPositionIndex !== null && (
          <p>
            <strong>{spread.positions[reading.nextPositionIndex]?.name}</strong> —{' '}
            {spread.positions[reading.nextPositionIndex]?.prompt}
          </p>
        )}
      </div>
      <div className={`card-stage cards-${spread.cardCount}`} aria-live="polite">
        {spread.positions.map((position, index) => {
          const card = revealed.get(index);
          const active = reading.status === 'revealing' && reading.nextPositionIndex === index;
          return (
            <motion.div
              className="card-position"
              key={position.id}
              style={
                {
                  left: `${position.coordinate.x}%`,
                  top: `${position.coordinate.y}%`,
                  '--layout-rotation': `${position.coordinate.rotation}deg`,
                } as any
              }
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
            >
              <button
                className={`tarot-card ${card ? 'is-revealed' : ''} ${active ? 'is-active' : ''}`}
                disabled={!active || reveal.isPending}
                onClick={() => reveal.mutate(index)}
                aria-label={
                  card
                    ? `${position.name}: ${card.card.name}, ${card.orientation === 'upright' ? '정방향' : '역방향'}`
                    : `${position.name} 카드 ${active ? '공개하기' : '공개 대기'}`
                }
              >
                <span className="card-inner">
                  <span className="card-back">
                    <picture>
                      <source srcSet="/cards/card-back.avif" type="image/avif" />
                      <img src="/cards/card-back.webp" alt="" />
                    </picture>
                    <b>{index + 1}</b>
                  </span>
                  <span
                    className={`card-front ${card?.orientation === 'reversed' ? 'reversed' : ''}`}
                  >
                    {card && (
                      <picture>
                        <source
                          srcSet={card.card.imagePath.replace('.webp', '.avif')}
                          type="image/avif"
                        />
                        <img src={card.card.imagePath} alt={card.card.alt} />
                      </picture>
                    )}
                  </span>
                </span>
              </button>
              <span className="position-label">{position.name}</span>
              {card && (
                <span className="card-name">
                  {card.card.name} · {card.orientation === 'upright' ? '정방향' : '역방향'}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
      {reveal.error && <ErrorMessage error={reveal.error} />}
      {reading.status === 'interpreting' && (
        <div className="interpretation-loader" role="status">
          <span className="moon-loader" aria-hidden="true">
            ☾
          </span>
          <p>카드와 질문 사이의 연결을 차분히 읽고 있어요…</p>
        </div>
      )}
    </section>
  );
}

function ResultView({ reading, result }: { reading: PublicReading; result: ReadingResult }) {
  const cardMap = new Map(reading.revealedCards.map((card) => [card.card.id, card]));
  const copyText = async () => {
    const text = [
      `TaroT — ${reading.question}`,
      '',
      result.summary,
      '',
      ...result.cards.map(
        (card) => `${card.positionName} · ${card.cardName}: ${card.interpretation}`,
      ),
      '',
      ...result.reflectionQuestions.map((question) => `• ${question}`),
    ].join('\n');
    await navigator.clipboard.writeText(text);
  };
  return (
    <section className="result-section">
      <div className="result-hero">
        <p className="step-label">당신의 리딩</p>
        <h1>카드가 건네는 이야기</h1>
        <blockquote>{reading.question}</blockquote>
      </div>
      {result.safetyNotice && (
        <aside className="safety-notice" role="note">
          {result.safetyNotice}
        </aside>
      )}
      <article className="summary-card">
        <span className="summary-icon" aria-hidden="true">
          ✦
        </span>
        <div>
          <p className="eyebrow">전체 흐름</p>
          <p>{result.summary}</p>
          <div className="theme-list">
            {result.themes.map((theme) => (
              <span key={theme}>{theme}</span>
            ))}
          </div>
        </div>
      </article>
      <div className="interpretation-list">
        {result.cards.map((item, index) => {
          const revealedCard =
            reading.revealedCards[item.positionIndex] ?? cardMap.get(item.cardId);
          return (
            <article className="interpretation-card" key={`${item.cardId}-${item.positionIndex}`}>
              {revealedCard && (
                <img
                  className={item.orientation === 'reversed' ? 'reversed-image' : ''}
                  src={revealedCard.card.imagePath}
                  alt={revealedCard.card.alt}
                />
              )}
              <div>
                <p className="card-index">
                  {String(index + 1).padStart(2, '0')} · {item.positionName}
                </p>
                <h2>
                  {item.cardName}{' '}
                  <small>{item.orientation === 'upright' ? '정방향' : '역방향'}</small>
                </h2>
                <p>{item.interpretation}</p>
              </div>
            </article>
          );
        })}
      </div>
      <article className="reflection-card">
        <p className="eyebrow">마음에 남겨 둘 질문</p>
        <ol>
          {result.reflectionQuestions.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ol>
      </article>
      <div className="button-row result-actions">
        <button className="secondary-button" onClick={copyText}>
          결과 텍스트 복사
        </button>
        <Link className="primary-button link-button" to="/">
          새 질문 시작하기
        </Link>
      </div>
    </section>
  );
}

function ReadingPage() {
  const { id } = useParams();
  const readingQuery = useQuery({
    queryKey: ['reading', id],
    queryFn: () => api.getReading(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'interpreting' ? 1_500 : false),
  });
  const resultQuery = useQuery({
    queryKey: ['result', id],
    queryFn: () => api.getResult(id!),
    enabled:
      readingQuery.data?.status === 'interpreting' ||
      readingQuery.data?.status === 'completed' ||
      readingQuery.data?.status === 'failed',
    refetchInterval: (query) => (query.state.data ? false : 1_500),
  });
  if (readingQuery.isPending)
    return (
      <div className="full-loader" role="status">
        별자리를 펼치는 중…
      </div>
    );
  if (readingQuery.error)
    return (
      <section className="center-panel narrow">
        <h1>리딩을 불러오지 못했어요.</h1>
        <ErrorMessage error={readingQuery.error} />
        <Link className="primary-button link-button" to="/">
          새 질문 시작하기
        </Link>
      </section>
    );
  const reading = readingQuery.data!;
  return (
    <>
      <CrisisBanner crisis={reading.crisis} />
      <AnimatePresence mode="wait">
        {reading.status === 'needs_clarification' && (
          <motion.div key="clarification" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Clarification reading={reading} />
          </motion.div>
        )}
        {reading.status === 'awaiting_spread' && (
          <motion.div key="spread" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <SpreadSelection reading={reading} />
          </motion.div>
        )}
        {['revealing', 'interpreting'].includes(reading.status) && (
          <motion.div key="cards" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <CardStage reading={reading} />
          </motion.div>
        )}
        {['completed', 'failed'].includes(reading.status) && resultQuery.data && (
          <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <ResultView reading={reading} result={resultQuery.data} />
          </motion.div>
        )}
      </AnimatePresence>
      {resultQuery.error && <ErrorMessage error={resultQuery.error} />}
    </>
  );
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/reading/:id" element={<ReadingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
