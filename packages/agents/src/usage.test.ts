import { describe, it, expect, vi } from 'vitest';
import { trackUsage } from './usage.js';

describe('privacy-preserving usage tracking', () => {
  it('aggregates SDK usage without prompt or output data', async () => {
    const observer = vi.fn().mockResolvedValue(undefined);
    const result = await trackUsage('spread', 'model', observer, async (report) => {
      report({ requests: 2, inputTokens: 100, outputTokens: 20, totalTokens: 120 });
      return 'private-result';
    });
    expect(result).toBe('private-result');
    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0]![0]).toEqual({
      id: expect.any(String),
      role: 'spread',
      model: 'model',
      succeeded: true,
      reported: true,
      requests: 2,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
    expect(JSON.stringify(observer.mock.calls)).not.toContain('private-result');
  });
  it('records partial usage on a failed run and preserves the original error', async () => {
    const observer = vi.fn().mockResolvedValue(undefined);
    const error = Object.assign(new Error('private-prompt'), {
      state: { usage: { requests: 1, inputTokens: 40, outputTokens: 10, totalTokens: 50 } },
    });
    await expect(
      trackUsage('reading', 'model', observer, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(observer.mock.calls[0]![0]).toMatchObject({
      succeeded: false,
      reported: true,
      totalTokens: 50,
    });
    expect(JSON.stringify(observer.mock.calls)).not.toContain('private-prompt');
  });
  it('marks unreported failed usage and isolates monitoring failures from paid runs', async () => {
    const observer = vi.fn().mockRejectedValue(new Error('storage down'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(trackUsage('reading', 'model', observer, async () => 'saved')).resolves.toBe(
        'saved',
      );
      expect(observer.mock.calls[0]![0]).toMatchObject({ reported: false, totalTokens: 0 });
      expect(warning).toHaveBeenCalledWith(JSON.stringify({ event: 'telemetry_write_failed' }));
    } finally {
      warning.mockRestore();
    }
  });
});
