import { expect, test } from '@playwright/test';
import { nextWeekday, signInAs } from './helpers';

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

test('phones get a bottom tab bar and a More page instead of the menu', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signInAs(page, 'nick');
  const tabs = page.getByRole('navigation', { name: 'Main' });
  await expect(tabs).toBeVisible();
  await expect(page.locator('.nav-menu')).toBeHidden();
  await expect(page.locator('.footer')).toBeHidden();
  await tabs.getByRole('link', { name: 'More' }).click();
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Front desk' })).toBeVisible();
  await tabs.getByRole('link', { name: 'Desk' }).click();
  await expect(page.getByRole('heading', { name: 'Front desk' })).toBeVisible();
  await page.close();
});

test('booking on a phone: pick a day and time, then the cage', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signInAs(page, 'bob', '#/book');
  const day = nextWeekday(2);
  const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  await page.getByRole('button', { name: label }).click();
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();
  await page.locator('.time-chip').first().click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByRole('heading', { name: 'Pick a cage' })).toBeVisible();
  const any = page.getByRole('button', { name: /Any open cage/ });
  await expect(any).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.price-total')).toContainText('$');
  await expect(page.getByRole('button', { name: /Pay & book|Confirm/ })).toBeEnabled();

  // Choosing a cage yourself turns "Any open cage" off.
  await page.locator('.resource-tile:not([disabled])').nth(1).click();
  await expect(any).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Back to times' }).click();
  await expect(page.getByRole('heading', { name: 'Book', exact: true })).toBeVisible();
  await page.close();
});
