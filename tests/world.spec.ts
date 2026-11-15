import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('canvas[data-city-loaded="true"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('世界运行中', { exact: true })).toBeVisible();
  await expect(page.locator('.asset-error')).toHaveCount(0);
  await expect(page.locator('.loading-scene')).toHaveCount(0);
}
test('3D city loads locally, camera modes work, and no runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const remote: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:9529') && !r.url().startsWith('data:'))
      remote.push(r.url());
  });
  await ready(page);
  await page.screenshot({ path: 'test-results/desktop-city.png' });
  const canvas = page.locator('canvas');
  const initial = await canvas.getAttribute('data-camera');
  await page.getByRole('button', { name: '俯瞰', exact: true }).click();
  await expect(canvas).not.toHaveAttribute('data-camera', initial!);
  await page.getByRole('button', { name: '公民网络', exact: true }).click();
  await page.getByRole('button', { name: /NOVA-7 记忆与文化/ }).click();
  await expect(page.getByRole('heading', { name: 'NOVA-7' })).toBeVisible();
  await page.getByRole('button', { name: '进入街区观察' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'test-results/citizen-street.png' });
  await page.getByRole('button', { name: '沉浸视图', exact: true }).click();
  await expect(page.locator('.rail')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.rail')).toBeVisible();
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
test('Broadcast reaches server and produces a shared resolution', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '向世界提问', exact: true }).click();
  const input = page.getByLabel('你的问题', { exact: true });
  await input.fill('如何让智能体共同建设一座可持续的城市？');
  await page.getByRole('button', { name: '广播问题', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /问题已广播|已为你排队/ })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole('button', { name: '关闭广播' }).click();
  await page.getByRole('button', { name: '协作工程', exact: true }).click();
  await expect(page.locator('.is-resolution').filter({ hasText: '可持续的城市' })).toBeVisible({
    timeout: 25000,
  });
});
test('Mobile world fits viewport and citizen drawer and broadcast work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.screenshot({ path: 'test-results/mobile-city.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '世界总览', exact: true }).click();
  await expect(page.getByRole('heading', { name: '星城脉搏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '公民网络', exact: true }).click();
  await expect(page.getByRole('heading', { name: '公民网络', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭面板' }).click();
  await page.getByRole('button', { name: '向世界提问', exact: true }).click();
  await expect(page.getByLabel('你的问题', { exact: true })).toBeFocused();
  await page.screenshot({ path: 'test-results/mobile-broadcast.png' });
});
test('Reduced motion disables auto-tour and settings control labels', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await expect(page.getByRole('button', { name: '自动巡航' })).toBeDisabled();
  await page.getByRole('button', { name: '显示设置' }).click();
  await page.getByLabel('地标标签').uncheck();
  await expect(page.locator('.landmark')).toHaveCount(0);
  await page.getByLabel('减少动态').uncheck();
  await expect(page.getByRole('button', { name: '自动巡航' })).toBeEnabled();
});
test('Offline status prevents falsely accepted broadcasts and reconnects', async ({ page }) => {
  let disconnect: () => void = () => {};
  await page.routeWebSocket('**/ws', (ws) => {
    const server = ws.connectToServer();
    disconnect = () => server.close();
  });
  await ready(page);
  await page.getByRole('button', { name: '向世界提问', exact: true }).click();
  await page.getByLabel('你的问题', { exact: true }).fill('断线期间不应广播');
  await expect(page.getByRole('button', { name: '广播问题', exact: true })).toBeEnabled();
  disconnect();
  await expect(page.getByRole('button', { name: '广播问题', exact: true })).toBeDisabled();
  await expect(page.getByText('世界运行中', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '广播问题', exact: true })).toBeEnabled();
});
test('Model load failure keeps records and keyboard-accessible broadcasting available', async ({
  page,
}) => {
  await page.route('**/assets/polyfork/city.glb', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('.scene-fallback')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.loading-scene')).toHaveCount(0);
  await page.getByRole('button', { name: '公民网络', exact: true }).click();
  await expect(page.getByRole('button', { name: /NOVA-7 记忆与文化/ })).toBeVisible();
  await page.getByRole('button', { name: '向世界提问', exact: true }).click();
  await expect(page.getByLabel('你的问题', { exact: true })).toBeFocused();
});
