import { randomUUID } from 'node:crypto';

export interface AgentUsage {
  id: string;
  role: 'spread' | 'reading';
  model: string;
  succeeded: boolean;
  reported: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export type UsageObserver = (event: AgentUsage) => Promise<void>;
export interface RunUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export async function trackUsage<T>(
  role: AgentUsage['role'],
  model: string,
  observer: UsageObserver | undefined,
  execute: (report: (usage: RunUsage) => void) => Promise<T>,
): Promise<T> {
  let usage: RunUsage | undefined;
  let succeeded = false;
  try {
    const result = await execute((value) => {
      usage = value;
    });
    succeeded = true;
    return result;
  } catch (error) {
    // SDK run errors can carry partial usage on their RunState. Never serialize that state.
    const partial = (error as { state?: { usage?: RunUsage } } | null)?.state?.usage;
    if (partial) usage = partial;
    throw error;
  } finally {
    if (observer) {
      const safe = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
      try {
        await observer({
          id: randomUUID(),
          role,
          model,
          succeeded,
          reported: Boolean(usage),
          requests: safe(usage?.requests),
          inputTokens: safe(usage?.inputTokens),
          outputTokens: safe(usage?.outputTokens),
          totalTokens: safe(usage?.totalTokens),
        });
      } catch {
        console.warn(JSON.stringify({ event: 'telemetry_write_failed' }));
      }
    }
  }
}
