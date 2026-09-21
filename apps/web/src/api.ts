import type { PublicReading, ReadingResult, RevealedCard } from '@tarot/contracts';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.detail ?? '요청을 처리할 수 없어요.', response.status);
  }
  return body as T;
}

export const api = {
  createReading: (question: string) =>
    request<PublicReading>('/v1/readings', { method: 'POST', body: JSON.stringify({ question }) }),
  getReading: (id: string) => request<PublicReading>(`/v1/readings/${id}`),
  clarify: (id: string, answer?: string, skip = false) =>
    request<PublicReading>(`/v1/readings/${id}/clarification`, {
      method: 'POST',
      body: JSON.stringify({ answer, skip }),
    }),
  selectSpread: (id: string, spreadId: string) =>
    request<PublicReading>(`/v1/readings/${id}/spread`, {
      method: 'POST',
      body: JSON.stringify({ spreadId }),
    }),
  reveal: (id: string, positionIndex: number) =>
    request<{ revealed: RevealedCard; status: string; nextPositionIndex: number | null }>(
      `/v1/readings/${id}/reveals`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ positionIndex }),
      },
    ),
  getResult: async (id: string): Promise<ReadingResult | null> => {
    const response = await fetch(`${baseUrl}/v1/readings/${id}/result`, { credentials: 'include' });
    if (response.status === 202) return null;
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(body?.detail ?? '해석을 불러올 수 없어요.', response.status);
    return body as ReadingResult;
  },
};
