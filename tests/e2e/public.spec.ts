import { expect, test } from '@playwright/test';

test('landing page and About show live facility info', async ({ page }) => {
  await page.goto('');
  await expect(page.getByText('Indoor baseball and softball training')).toBeVisible();
  await page.getByRole('link', { name: 'Hours, prices and how it works →' }).click();
  await expect(page.getByRole('heading', { name: 'The Yard', level: 1 })).toBeVisible();
  await expect(page.locator('.facility-stats')).toContainText('8');
  await expect(page.locator('.hours-list').first()).toContainText('Mon–Fri');
  await expect(page.getByText('Full refund')).toBeVisible();
});

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('#/book');
  await expect(page).toHaveURL(/#\/signin/);
});

test('sign up asks for the waiver', async ({ page }) => {
  await page.goto('#/signup');
  await expect(page.getByText('Release of Liability')).toBeVisible();
  await page.fill('#username', 'newbie');
  await page.fill('#email', 'new@test.local');
  await page.fill('#displayName', 'New Person');
  await page.fill('#password', 'password123');
  await page.fill('#confirm', 'password123');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('alert')).toContainText('Type your full name to sign the waiver');
});
