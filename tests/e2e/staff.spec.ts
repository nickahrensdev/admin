import { expect, test } from '@playwright/test';
import { nextWeekday, signInAs } from './helpers';

test('front desk: book a guest walk-in, then check them in', async ({ page }) => {
  await signInAs(page, 'dana', '#/front-desk');
  await expect(page.getByRole('heading', { name: 'Front desk' })).toBeVisible();
  await page.locator('.day-picker input').fill(nextWeekday(2)); // a Tuesday next week
  await page.getByRole('radio', { name: 'List' }).click();

  await page.getByRole('button', { name: '+ Walk-in' }).click();
  await page.getByLabel('Start', { exact: true }).selectOption({ index: 4 }); // 5:00 PM (date isn't today, so all options show)
  await page.locator('.modal .resource-tile:not([disabled])').first().click();
  await page.getByRole('radio', { name: 'Guest' }).click();
  await page.getByLabel('Name').fill('Walk In Wally');
  await page.getByRole('radio', { name: 'Cash' }).click();
  await expect(page.locator('.quote-line')).toContainText('$50.00');
  await page.getByRole('button', { name: 'Book walk-in' }).click();
  await expect(page.locator('.alert-success')).toContainText('Collect $50.00 by cash');

  const item = page.locator('.desk-item', { hasText: 'Walk In Wally' });
  await item.getByRole('button', { name: 'Check in' }).click();
  await expect(item).toContainText('Checked in');
});

test('admin posts a message; customers see it and can dismiss it', async ({ browser }) => {
  const admin = await browser.newPage();
  await signInAs(admin, 'nick', '#/admin/messages');
  await admin.getByRole('button', { name: 'New message' }).click();
  await admin.getByLabel('Title').fill('Opening weekend specials');
  await admin.getByLabel('Message').fill('Free 30 minutes on us.');
  await admin.getByRole('button', { name: 'Post' }).click();
  await expect(admin.locator('.alert-success')).toContainText('Message posted');
  await admin.close();

  const page = await browser.newPage();
  await signInAs(page, 'bob');
  const msg = page.locator('.message', { hasText: 'Opening weekend specials' });
  await expect(msg).toBeVisible();
  await msg.getByRole('button', { name: /Dismiss/ }).click();
  await expect(msg).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.message', { hasText: 'Opening weekend specials' })).toHaveCount(0);
  await page.close();
});

test('reports load for the super admin', async ({ page }) => {
  await signInAs(page, 'nick', '#/admin/reports');
  await expect(page.locator('.kpi').first()).toContainText('Net revenue');
  await expect(page.locator('.column-chart').first()).toBeVisible();
});
