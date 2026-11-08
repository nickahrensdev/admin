import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

test('home shows the dashboard and "No new messages"', async ({ page }) => {
  await signInAs(page, 'bob');
  await expect(page.getByRole('heading', { name: 'Bob Batter', level: 1 })).toBeVisible();
  await expect(page.locator('.messages')).toContainText('No new messages');
  await expect(page.getByRole('link', { name: 'Book a cage' }).first()).toBeVisible();
  await expect(page.getByText('Nothing on the calendar.')).toBeVisible();
});

test('a customer without a waiver can sign it from their profile', async ({ page }) => {
  await signInAs(page, 'cara', '#/profile');
  const row = page.locator('.detail-row', { hasText: 'Waiver' });
  await expect(row).toContainText('Not signed');
  await row.getByRole('button', { name: 'Sign now' }).click();
  await page.getByLabel('Full legal name (your signature)').fill('Cara Catcher');
  await page.locator('.modal .check-line', { hasText: 'I have read' }).click();
  await page.getByRole('button', { name: 'Sign waiver' }).click();
  await expect(row).toContainText('Signed');
});

test('customers can’t open admin or front desk pages', async ({ page }) => {
  await signInAs(page, 'bob', '#/admin/reports');
  await expect(page.getByRole('heading', { name: /no access/i })).toBeVisible();
  await page.goto('#/front-desk');
  await expect(page.getByRole('heading', { name: /no access/i })).toBeVisible();
});

test('the phone menu scrolls when it is taller than the screen', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 600 } });
  await signInAs(page, 'nick');
  await page.locator('.nav-toggle').click();
  const menu = page.locator('.nav-menu');
  await expect(menu).toBeVisible();
  const { scroll, client, overflow } = await menu.evaluate((m) => ({ scroll: m.scrollHeight, client: m.clientHeight, overflow: getComputedStyle(m).overflowY }));
  expect(overflow).toBe('auto');
  expect(scroll).toBeGreaterThan(client);
  await page.close();
});
