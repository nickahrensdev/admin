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

test('projections: sliders change the monthly profit', async ({ page }) => {
  await signInAs(page, 'nick', '#/admin/projections');
  const profit = page.locator('.proj-profit');
  await expect(profit).toContainText('$');
  await page.getByRole('button', { name: /The Yard — Location 1/ }).first().click();
  const before = await profit.textContent();
  await page.getByLabel('Monthly costs').fill('500000'); // $5,000: costs lower profit but aren't a "change"
  await expect(profit).not.toHaveText(before!);
  await expect(page.getByText('vs today')).toHaveCount(0);
  const withCosts = await profit.textContent();
  await page.getByLabel('Cage price').fill('1.5');
  await expect(profit).not.toHaveText(withCosts!);
  await expect(page.getByText('vs today')).toBeVisible();
  await page.getByRole('button', { name: 'Reset to today' }).click();
  await expect(profit).toHaveText(withCosts!);
});

test('all bookings: search, open in the front desk, and view a customer', async ({ page, browser }) => {
  await signInAs(page, 'dana', '#/admin/bookings');
  await expect(page.getByRole('heading', { name: 'All bookings' })).toBeVisible();
  await page.getByLabel('Search bookings').fill('Wally'); // the walk-in booked in the first test
  const row = page.locator('.lb-row', { hasText: 'Walk In Wally' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Checked in');
  await row.getByRole('link', { name: /Open Walk In Wally/ }).click();
  await expect(page.getByRole('heading', { name: 'Front desk' })).toBeVisible();
  await expect(page.locator('.modal')).toContainText('Walk In Wally');

  const admin = await browser.newPage();
  await signInAs(admin, 'nick', '#/admin/users');
  await admin.locator('.user-row', { hasText: 'Bob Batter' }).getByRole('link', { name: 'Bob Batter' }).click();
  await expect(admin.getByRole('heading', { name: 'Bob Batter' })).toBeVisible();
  await expect(admin.locator('.customer-stats')).toContainText('Upcoming');
  await expect(admin.locator('.customer-chips')).toContainText('Waiver signed');
  await admin.close();
});

test('front desk: collect a walk-in’s payment, see it in history, close-out and activity', async ({ page }) => {
  await signInAs(page, 'dana', `#/front-desk?date=${nextWeekday(2)}`);
  await page.getByRole('radio', { name: 'List' }).click();
  const item = page.locator('.desk-item', { hasText: 'Walk In Wally' });
  await expect(item).toContainText('Collect $50.00');
  await item.locator('.desk-item-main').click();
  await page.getByRole('button', { name: 'Paid cash' }).click();
  await expect(page.locator('.alert-success')).toContainText('paid in cash');
  await expect(page.locator('.modal')).toContainText('Collected');
  await page.locator('.panel-history summary').click();
  await expect(page.locator('.history-list')).toContainText('Collected $50.00 by cash');
  await expect(page.locator('.history-list')).toContainText('Dana Desk');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Close out' }).click();
  await expect(page.locator('.close-tile', { hasText: 'Cash collected' })).toContainText('$50.00');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByLabel('Find a booking').fill('wally');
  await expect(page.locator('.desk-item')).toHaveCount(1);

  await page.goto('#/admin/activity');
  await expect(page.locator('.activity-row').first()).toContainText('Dana Desk');
  await expect(page.locator('.activity-row', { hasText: 'Collected $50.00 by cash' })).toBeVisible();
});

test('users: plain role names and filters', async ({ page }) => {
  await signInAs(page, 'nick', '#/admin/users');
  await expect(page.locator('.user-row', { hasText: 'Nick Admin' })).toContainText('Owner');
  await page.getByRole('radio', { name: /^Staff/ }).click();
  await expect(page.locator('.user-row', { hasText: 'Bob Batter' })).toHaveCount(0);
  await expect(page.locator('.user-row', { hasText: 'Dana Desk' })).toContainText('Front desk');
  await page.getByRole('radio', { name: /^No waiver/ }).click();
  await expect(page.locator('.user-row', { hasText: 'Dana Desk' })).toHaveCount(0);
});

test('owner home shows today and what needs attention', async ({ page }) => {
  await signInAs(page, 'nick');
  await expect(page.locator('.owner-tile', { hasText: 'Today’s revenue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
});
