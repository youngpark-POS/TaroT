import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const totals = {
  runs: 12,
  failures: 1,
  requests: 24,
  inputTokens: 18000,
  outputTokens: 5000,
  totalTokens: 23000,
  unreportedRuns: 0,
};
const snapshot = {
  generatedAt: '2026-10-04T10:00:00.000Z',
  rangeDays: 7,
  region: 'ap-northeast-2',
  service: { live: true, ready: true, latencyMs: 84 },
  functions: ['api', 'worker', 'cleanup'].map((role) => ({
    name: `tarot-temp-${role}`,
    role,
    invocations: 42,
    errors: 0,
    throttles: 0,
    durationP95Ms: role === 'worker' ? 8400 : 90,
  })),
  queues: [
    {
      name: 'tarot-temp-agent-jobs',
      deadLetter: false,
      visible: 0,
      inFlight: 1,
      delayed: 0,
      oldestAgeSeconds: 0,
    },
    {
      name: 'tarot-temp-agent-jobs-dlq',
      deadLetter: true,
      visible: 0,
      inFlight: 0,
      delayed: 0,
      oldestAgeSeconds: 0,
    },
  ],
  alarms: ['api-errors', 'worker-errors', 'dlq-messages'].map((name) => ({
    name: `tarot-temp-${name}`,
    state: 'OK',
    updatedAt: '2026-10-04T09:00:00.000Z',
  })),
  usage: {
    totals,
    byAgent: [
      { role: 'spread', model: 'test-spread-model', totals },
      {
        role: 'reading',
        model: 'test-reading-model',
        totals: {
          ...totals,
          runs: 0,
          failures: 0,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      },
    ],
    daily: Array.from({ length: 7 }, (_, index) => ({
      day: new Date(Date.UTC(2026, 8, 28 + index)).toISOString().slice(0, 10),
      totals: {
        ...totals,
        inputTokens: index * 1000,
        outputTokens: index * 200,
        totalTokens: index * 1200,
      },
    })),
    retentionDays: 90,
  },
  warnings: [],
};
test('monitoring denies anonymous access and exposes a keyboard-accessible login', async ({
  page,
}) => {
  await page.route('**/v1/monitoring/config', (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  await page.route('**/v1/monitoring/snapshot?*', (route) =>
    route.fulfill({ status: 401, json: { error: 'Login required' } }),
  );
  await page.goto('/monitoring');
  await expect(page.getByRole('link', { name: /관리자 로그인/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'OpenAI 토큰 추이' })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? '')),
  ).toEqual([]);
});
test('monitoring shows metrics, range controls, and an accessible responsive chart', async ({
  page,
}) => {
  await page.route('**/v1/monitoring/config', (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  await page.route('**/v1/monitoring/snapshot?*', (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        rangeDays: Number(new URL(route.request().url()).searchParams.get('days')),
      },
    }),
  );
  await page.goto('/monitoring');
  await expect(page.getByRole('heading', { name: 'OpenAI 토큰 추이' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /정상적으로 응답/ })).toBeVisible();
  await page.getByRole('button', { name: '30일', exact: true }).click();
  await expect(page.getByRole('button', { name: '30일', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('checkbox', { name: '1분 자동 갱신' }).uncheck();
  await expect(page.getByRole('checkbox', { name: '1분 자동 갱신' })).not.toBeChecked();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? '')),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: `test-results/monitoring-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test('an unavailable source is shown as an error instead of a healthy dashboard', async ({
  page,
}) => {
  await page.route('**/v1/monitoring/config', (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
  await page.route('**/v1/monitoring/snapshot?*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.goto('/monitoring');
  await expect(page.getByRole('alert')).toContainText('최신 지표');
  await expect(page.getByRole('heading', { name: /정상적으로 응답/ })).toHaveCount(0);
});
