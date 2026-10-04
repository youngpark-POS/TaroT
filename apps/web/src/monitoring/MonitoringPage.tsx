import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  monitoringSnapshotSchema,
  type MonitoringSnapshot,
  type UsageTotals,
} from '@tarot/contracts/monitoring';
import './monitoring.css';

const base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const count = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
const compact = (value: number) =>
  new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const time = (value: string) =>
  new Date(value).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
class MonitorError extends Error {
  constructor(readonly status: number) {
    super('지표를 불러오지 못했습니다.');
  }
}
async function snapshot(days: number) {
  const response = await fetch(`${base}/v1/monitoring/snapshot?days=${days}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new MonitorError(response.status);
  return monitoringSnapshotSchema.parse(await response.json());
}
function UsageChart({ daily }: { daily: MonitoringSnapshot['usage']['daily'] }) {
  const max = Math.max(...daily.map((row) => row.totals.totalTokens), 1);
  return (
    <div
      className="mon-chart"
      role="img"
      aria-label={`일별 OpenAI 토큰 사용량. ${daily.map((row) => `${row.day}: ${count(row.totals.totalTokens)} 토큰`).join(', ')}`}
    >
      <div className="mon-chart-scale">
        <span>{compact(max)}</span>
        <span>{compact(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="mon-chart-bars">
        {daily.map((row, index) => (
          <div className="mon-chart-column" key={row.day}>
            <div
              className="mon-bar-slot"
              title={`${row.day} · 입력 ${count(row.totals.inputTokens)} / 출력 ${count(row.totals.outputTokens)}`}
            >
              <div
                className="mon-bar-stack"
                style={{ height: `${(row.totals.totalTokens / max) * 100}%` }}
              >
                <div className="mon-bar-output" style={{ flex: row.totals.outputTokens }} />
                <div className="mon-bar-input" style={{ flex: row.totals.inputTokens }} />
              </div>
            </div>
            <span>
              {daily.length <= 7 || index % 5 === 0 || index === daily.length - 1
                ? row.day.slice(5).replace('-', '/')
                : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <article className={`mon-stat ${accent ? 'mon-stat-accent' : ''}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function agentName(role: string) {
  return role === 'spread' ? '스프레드 추천' : role === 'reading' ? '타로 해석' : role;
}
function AgentRow({ role, model, totals }: { role: string; model: string; totals: UsageTotals }) {
  return (
    <tr>
      <th scope="row">
        <span>{agentName(role)}</span>
        <small>{model}</small>
      </th>
      <td>{count(totals.runs)}</td>
      <td>{count(totals.requests)}</td>
      <td>{count(totals.inputTokens)}</td>
      <td>{count(totals.outputTokens)}</td>
      <td className={totals.failures ? 'mon-text-warning' : ''}>{count(totals.failures)}</td>
    </tr>
  );
}
export function MonitoringPage() {
  const [days, setDays] = useState(7);
  const [automatic, setAutomatic] = useState(true);
  const config = useQuery({
    queryKey: ['monitoring-config'],
    queryFn: async () => {
      const response = await fetch(`${base}/v1/monitoring/config`, { credentials: 'include' });
      if (!response.ok) throw new Error('모니터링 설정을 불러오지 못했습니다.');
      return (await response.json()) as { enabled: boolean };
    },
    retry: false,
  });
  const query = useQuery({
    queryKey: ['monitoring-snapshot', days],
    queryFn: () => snapshot(days),
    enabled: config.data?.enabled === true,
    refetchInterval: automatic ? 60000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const data = query.data;
  const needsLogin = query.error instanceof MonitorError && query.error.status === 401;
  const ready = data?.service.live && data.service.ready;
  const degraded =
    data &&
    (!ready ||
      data.functions.some((row) => row.errors > 0 || row.throttles > 0) ||
      data.queues.some(
        (row) => (row.deadLetter && row.visible > 0) || (row.oldestAgeSeconds ?? 0) >= 600,
      ) ||
      data.alarms.some((row) => row.state === 'ALARM'));
  const total = data?.usage.totals;
  return (
    <div className="mon-shell">
      <aside className="mon-sidebar">
        <a className="mon-brand" href="/">
          ✦{' '}
          <span>
            TaroT<small>OPERATIONS</small>
          </span>
        </a>
        <nav aria-label="운영 메뉴">
          <a href="/monitoring" aria-current="page">
            <span aria-hidden="true">◈</span> 운영 현황
          </a>
          <a href="/" target="_blank" rel="noreferrer">
            <span aria-hidden="true">↗</span> 서비스 열기
          </a>
        </nav>
        <div className="mon-sidebar-bottom">
          <span className="mon-dot" /> 관리자 전용<small>개인정보 없는 집계 지표</small>
        </div>
      </aside>
      <main className="mon-main">
        <header className="mon-header">
          <div>
            <p className="mon-eyebrow">TAROT / MONITORING</p>
            <h1>운영 현황</h1>
            <p className="mon-subtitle">서비스 상태부터 AI 사용량까지, 한곳에서 확인하세요.</p>
          </div>
          {data && !needsLogin && (
            <a className="mon-button mon-button-subtle" href={`${base}/v1/monitoring/logout`}>
              로그아웃 ↗
            </a>
          )}
        </header>
        {(needsLogin || config.data?.enabled === false) && !config.error && (
          <section className="mon-login mon-panel">
            <span className="mon-login-symbol" aria-hidden="true">
              ✦
            </span>
            <p className="mon-eyebrow">PRIVATE WORKSPACE</p>
            <h2>
              운영 지표를 확인하려면
              <br />
              관리자로 로그인하세요.
            </h2>
            <p>초대받은 관리자 계정으로 접속할 수 있습니다.</p>
            {new URLSearchParams(location.search).get('auth') === 'failed' && (
              <p role="alert">로그인에 실패했습니다. 관리자 초대와 권한을 확인해 주세요.</p>
            )}
            {config.data?.enabled ? (
              <a className="mon-button mon-button-primary" href={`${base}/v1/monitoring/login`}>
                관리자 로그인 <span aria-hidden="true">→</span>
              </a>
            ) : (
              <p>이 환경에는 관리자 인증이 아직 설정되지 않았습니다.</p>
            )}
          </section>
        )}
        {(config.error || (query.error && !needsLogin)) && (
          <div className="mon-error" role="alert">
            {config.error
              ? '설정을 불러오지 못했습니다.'
              : '최신 지표를 가져오지 못했습니다. 표시된 값은 이전 조회 결과일 수 있습니다.'}{' '}
            <button
              onClick={() => {
                void config.refetch();
                void query.refetch();
              }}
            >
              다시 시도
            </button>
          </div>
        )}
        {(config.isPending || (config.data?.enabled && query.isPending)) && (
          <div className="mon-loading" role="status">
            <span className="mon-pulse" /> 운영 지표를 불러오는 중입니다…
          </div>
        )}
        {data && !needsLogin && (
          <>
            <section
              className={`mon-status ${degraded ? 'mon-status-warning' : ''}`}
              aria-live="polite"
            >
              <div>
                <span className="mon-status-icon" aria-hidden="true">
                  {degraded ? '!' : '✓'}
                </span>
                <div>
                  <h2>
                    {degraded
                      ? '확인이 필요한 신호가 있습니다'
                      : '서비스가 정상적으로 응답하고 있습니다'}
                  </h2>
                  <p>
                    {data.region} · 서비스 응답 {count(data.service.latencyMs)}ms ·{' '}
                    {data.service.ready
                      ? '데이터 저장소 연결 정상'
                      : '데이터 저장소 연결 확인 필요'}
                  </p>
                </div>
              </div>
              <span className="mon-status-tag">{degraded ? 'ATTENTION' : 'OPERATIONAL'}</span>
            </section>
            <div className="mon-toolbar">
              <div className="mon-range" role="group" aria-label="사용량 조회 기간">
                {[1, 7, 30].map((value) => (
                  <button key={value} aria-pressed={days === value} onClick={() => setDays(value)}>
                    {value === 1 ? '오늘' : `${value}일`}
                  </button>
                ))}
              </div>
              <div className="mon-refresh">
                <label>
                  <input
                    type="checkbox"
                    checked={automatic}
                    onChange={(event) => setAutomatic(event.target.checked)}
                  />{' '}
                  1분 자동 갱신
                </label>
                <span>{time(data.generatedAt)} 기준</span>
                <button
                  aria-label="지표 새로고침"
                  disabled={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  ↻
                </button>
              </div>
            </div>
            <section className="mon-stat-grid" aria-label="OpenAI 사용량 요약">
              <Stat
                label="전체 토큰"
                value={compact(total!.totalTokens)}
                note={`입력 ${count(total!.inputTokens)} · 출력 ${count(total!.outputTokens)}`}
                accent
              />
              <Stat
                label="OpenAI 요청"
                value={count(total!.requests)}
                note="도구 호출에 따른 추가 모델 요청 포함"
              />
              <Stat
                label="에이전트 실행"
                value={count(total!.runs)}
                note="추천 · 해석 · 재시도 합계"
              />
              <Stat
                label="실패한 실행"
                value={count(total!.failures)}
                note={
                  total!.runs
                    ? `성공 비율 ${((1 - total!.failures / total!.runs) * 100).toFixed(1)}%`
                    : '아직 수집된 실행이 없습니다'
                }
              />
            </section>
            <section className="mon-panel mon-usage">
              <div className="mon-panel-heading">
                <div>
                  <p className="mon-eyebrow">AI CONSUMPTION</p>
                  <h2>OpenAI 토큰 추이</h2>
                </div>
                <div className="mon-legend">
                  <span>
                    <i className="mon-legend-input" /> 입력 토큰
                  </span>
                  <span>
                    <i className="mon-legend-output" /> 출력 토큰
                  </span>
                </div>
              </div>
              <UsageChart daily={data.usage.daily} />
              {!total!.runs && (
                <p className="mon-empty">선택한 기간에 수집된 OpenAI 호출이 없습니다.</p>
              )}
              <p className="mon-note">
                UTC 날짜 기준 · 수집 배포 이후 TaroT 호출만 집계 · {data.usage.retentionDays}일 보관
                · OpenAI 청구서와 다를 수 있습니다.
              </p>
            </section>
            <section className="mon-panel">
              <div className="mon-panel-heading">
                <div>
                  <p className="mon-eyebrow">AGENT BREAKDOWN</p>
                  <h2>에이전트별 사용량</h2>
                </div>
                <span className="mon-caption">선택한 {days}일</span>
              </div>
              <div
                className="mon-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="에이전트별 사용량 표"
              >
                <table className="mon-table">
                  <thead>
                    <tr>
                      <th>에이전트 / 모델</th>
                      <th>실행</th>
                      <th>모델 요청</th>
                      <th>입력 토큰</th>
                      <th>출력 토큰</th>
                      <th>실패</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.usage.byAgent.map((row) => (
                      <AgentRow key={`${row.role}:${row.model}`} {...row} />
                    ))}
                    {!data.usage.byAgent.length && (
                      <tr>
                        <td colSpan={6}>실제 호출이 발생하면 에이전트별 사용량이 표시됩니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {total!.unreportedRuns > 0 && (
                <p className="mon-note mon-text-warning">
                  사용량 미보고 실행 {count(total!.unreportedRuns)}건: 제공자가 토큰 수를 반환하지
                  않아 토큰 합계에 포함하지 않았습니다.
                </p>
              )}
            </section>
            <div className="mon-infra-grid">
              <section className="mon-panel">
                <div className="mon-panel-heading">
                  <div>
                    <p className="mon-eyebrow">COMPUTE</p>
                    <h2>Lambda</h2>
                  </div>
                  <span className="mon-caption">최근 1시간</span>
                </div>
                {data.functions.map((row) => (
                  <article className="mon-function" key={row.name}>
                    <div>
                      <h3>
                        {row.role === 'api'
                          ? 'API'
                          : row.role === 'worker'
                            ? '에이전트 Worker'
                            : '만료 데이터 정리'}
                      </h3>
                      <small>{row.name}</small>
                    </div>
                    <dl>
                      <div>
                        <dt>호출</dt>
                        <dd>{count(row.invocations)}</dd>
                      </div>
                      <div>
                        <dt>오류 / 제한</dt>
                        <dd className={row.errors + row.throttles ? 'mon-text-warning' : ''}>
                          {count(row.errors)} / {count(row.throttles)}
                        </dd>
                      </div>
                      <div>
                        <dt>최근 5분 p95</dt>
                        <dd>
                          {row.durationP95Ms === null ? '—' : `${compact(row.durationP95Ms)}ms`}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
                <p className="mon-note">
                  Worker의 개별 작업 실패는 위의 에이전트 실패 집계에서 확인하세요.
                </p>
              </section>
              <section className="mon-panel">
                <div className="mon-panel-heading">
                  <div>
                    <p className="mon-eyebrow">QUEUE</p>
                    <h2>작업 큐</h2>
                  </div>
                  <span className="mon-caption">현재 상태</span>
                </div>
                {data.queues.map((row) => (
                  <article className="mon-queue" key={row.name}>
                    <div>
                      <h3>{row.deadLetter ? '실패 보관함 · DLQ' : '에이전트 작업'}</h3>
                      <small>{row.name}</small>
                    </div>
                    <dl>
                      <div>
                        <dt>대기</dt>
                        <dd className={row.deadLetter && row.visible ? 'mon-text-warning' : ''}>
                          {count(row.visible)}
                        </dd>
                      </div>
                      <div>
                        <dt>처리 중</dt>
                        <dd>{count(row.inFlight)}</dd>
                      </div>
                      <div>
                        <dt>지연</dt>
                        <dd>{count(row.delayed)}</dd>
                      </div>
                      <div>
                        <dt>최장 대기</dt>
                        <dd>
                          {row.oldestAgeSeconds === null ? '—' : `${count(row.oldestAgeSeconds)}초`}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </section>
            </div>
            <section className="mon-panel">
              <div className="mon-panel-heading">
                <div>
                  <p className="mon-eyebrow">SIGNALS</p>
                  <h2>CloudWatch 경보</h2>
                </div>
                <span className="mon-caption">{data.alarms.length}개</span>
              </div>
              <div className="mon-alarms">
                {data.alarms.map((row) => (
                  <div key={row.name}>
                    <span
                      className={`mon-dot ${row.state === 'ALARM' ? 'mon-dot-warning' : row.state !== 'OK' ? 'mon-dot-muted' : ''}`}
                    />
                    <span>{row.name}</span>
                    <strong className={row.state === 'ALARM' ? 'mon-text-warning' : ''}>
                      {row.state === 'INSUFFICIENT_DATA' ? '데이터 대기' : row.state}
                    </strong>
                  </div>
                ))}
              </div>
            </section>
            {data.warnings.map((warning) => (
              <p className="mon-warning" key={warning}>
                {warning}
              </p>
            ))}
          </>
        )}
        <footer className="mon-footer">
          <span>TaroT Operations</span>
          <span>사용자 질문과 해석 본문은 표시하거나 수집하지 않습니다.</span>
        </footer>
      </main>
    </div>
  );
}
