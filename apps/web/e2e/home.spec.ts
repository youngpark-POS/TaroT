import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('home page is keyboard accessible and has no serious axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /새로운 시선/ })).toBeVisible();
  await page.getByLabel('지금 마음에 머무는 질문').fill('새로운 일을 시작하며 무엇을 살펴볼까요?');
  await expect(page.getByRole('button', { name: '나에게 맞는 스프레드 찾기' })).toBeEnabled();
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? '')),
  ).toEqual([]);
});
