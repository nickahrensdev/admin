// UI audit (not part of CI): visits every screen at phone, tablet and desktop sizes,
// saves a screenshot and reports layout problems. Run with:
//   scripts/e2e-stack.sh && AUDIT_OUT=/tmp/audit npx playwright test --config playwright.audit.config.ts
import { test, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { signInAs, USERS } from '../e2e/helpers';

const OUT = process.env.AUDIT_OUT ?? 'test-results/audit';
const SIZES = { phone: { width: 390, height: 844 }, small: { width: 320, height: 640 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1280, height: 900 } } as const;
type Step = (p: Page) => Promise<void>;
interface Screen { name: string; as?: keyof typeof USERS; path: string; steps?: Step }

const LOC = process.env.AUDIT_LOC ?? '';
const click = (sel: string): Step => async (p) => { await p.locator(sel).first().click(); };
const SCREENS: Screen[] = [
  { name: 'landing', path: '#/' },
  { name: 'about', path: '#/about' },
  { name: 'signin', path: '#/signin' },
  { name: 'signup', path: '#/signup' },
  { name: 'forgot', path: '#/forgot-password' },
  { name: 'notfound', path: '#/nope' },
  { name: 'home', as: 'bob', path: '#/home' },
  { name: 'book-1', as: 'bob', path: '#/book' },
  { name: 'book-1-multi', as: 'bob', path: '#/book', steps: async (p) => { await p.getByRole('button', { name: /Several days/ }).click(); } },
  { name: 'book-2', as: 'bob', path: '#/book', steps: async (p) => { await p.locator('.day-chip').nth(2).click(); await p.locator('.time-chip').nth(3).click(); await p.getByRole('button', { name: 'Next' }).click(); } },
  { name: 'bookings', as: 'bob', path: '#/bookings' },
  { name: 'bookings-sheet', as: 'bob', path: '#/bookings', steps: click('.booking-row') },
  { name: 'memberships', as: 'bob', path: '#/memberships' },
  { name: 'memberships-none', as: 'cara', path: '#/memberships' },
  { name: 'profile', as: 'bob', path: '#/profile' },
  { name: 'more', as: 'bob', path: '#/more' },
  { name: 'desk-list', as: 'dana', path: '#/front-desk', steps: async (p) => { await p.getByRole('radio', { name: 'List' }).click(); } },
  { name: 'desk-timeline', as: 'dana', path: '#/front-desk', steps: async (p) => { await p.getByRole('radio', { name: 'Timeline' }).click(); } },
  { name: 'desk-panel', as: 'dana', path: '#/front-desk', steps: async (p) => { await p.getByRole('radio', { name: 'List' }).click(); await p.getByRole('radio', { name: /Everything/ }).click(); await p.locator('.desk-item-main').nth(1).click(); } },
  { name: 'desk-walkin', as: 'dana', path: '#/front-desk', steps: async (p) => { await p.getByRole('button', { name: '+ Walk-in' }).first().click(); } },
  { name: 'desk-closeout', as: 'dana', path: '#/front-desk', steps: async (p) => { await p.getByRole('button', { name: 'Close out' }).click(); } },
  { name: 'owner-home', as: 'nick', path: '#/home' },
  { name: 'owner-more', as: 'nick', path: '#/more' },
  { name: 'all-bookings', as: 'nick', path: '#/admin/bookings?status=all' },
  { name: 'customer', as: 'nick', path: `#/admin/bookings?user=${USERS.bob.id}` },
  { name: 'activity', as: 'nick', path: '#/admin/activity' },
  { name: 'users', as: 'nick', path: '#/admin/users' },
  { name: 'users-edit', as: 'nick', path: '#/admin/users', steps: async (p) => { await p.getByRole('button', { name: /Edit roles/ }).nth(1).click(); } },
  { name: 'locations', as: 'nick', path: '#/admin/locations' },
  ...['hours', 'closures', 'pricing', 'resources', 'details'].map((t) => ({ name: `location-${t}`, as: 'nick' as const, path: `#/admin/locations/${LOC}?tab=${t}` })),
  { name: 'tiers', as: 'nick', path: '#/admin/memberships' },
  { name: 'tier-edit', as: 'nick', path: '#/admin/memberships', steps: click('.tier-list-item button, .tier-list-item') },
  { name: 'members', as: 'nick', path: '#/admin/memberships?tab=members' },
  { name: 'waiver', as: 'nick', path: '#/admin/waiver' },
  { name: 'reports', as: 'nick', path: '#/admin/reports' },
  { name: 'projections', as: 'nick', path: '#/admin/projections' },
  { name: 'projections-loc', as: 'nick', path: '#/admin/projections', steps: async (p) => { await p.locator('.lever-locs button').first().click(); } },
  { name: 'todos', as: 'nick', path: '#/admin/todos' },
  { name: 'messages', as: 'nick', path: '#/admin/messages' },
  { name: 'messages-new', as: 'nick', path: '#/admin/messages', steps: async (p) => { await p.getByRole('button', { name: 'New message' }).click(); } },
];

/** Runs in the page: finds things that stick out, are too small to tap, or too small to read. */
function inspect(touch: boolean) {
  const vw = window.innerWidth;
  const out: string[] = [];
  const label = (el: Element) => {
    const c = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${c} "${(el.textContent ?? '').trim().slice(0, 28)}"`;
  };
  const scrolls = (el: Element | null): boolean => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
    }
    return false;
  };
  if (document.documentElement.scrollWidth > vw + 1) out.push(`PAGE SCROLLS SIDEWAYS by ${document.documentElement.scrollWidth - vw}px`);
  const seen = new Set<string>();
  const add = (kind: string, el: Element, extra = '') => {
    const k = `${kind}: ${label(el)}${extra}`;
    if (!seen.has(k) && seen.size < 40) { seen.add(k); out.push(k); }
  };
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (cs.position === 'absolute' && r.width <= 2) continue; // sr-only
    if ((r.right > vw + 1 || r.left < -1) && !scrolls(el.parentElement)) add('OFFSCREEN', el, ` (${Math.round(r.left)}..${Math.round(r.right)})`);
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
    if (own) {
      if (parseFloat(cs.fontSize) < 11.5) add('TINY TEXT', el, ` ${cs.fontSize}`);
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === 'visible' && cs.display !== 'inline' && !scrolls(el.parentElement)) add('TEXT SPILLS', el);
    }
    if (touch && el.matches('a, button, select, input:not([type=hidden]), summary, [role=tab], [role=radio]')) {
      if (cs.display === 'inline' && el.tagName === 'A') continue; // links inside sentences
      if (cs.opacity === '0') continue;
      if (r.height < 36 || r.width < 36) add('SMALL TAP', el, ` ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return out;
}

for (const [size, viewport] of Object.entries(SIZES)) {
  test(`audit ${size}`, async ({ browser }) => {
    test.setTimeout(600_000);
    mkdirSync(`${OUT}/${size}`, { recursive: true });
    const report: string[] = [];
    for (const s of SCREENS) {
      const page = await browser.newPage({ viewport, hasTouch: size !== 'desktop' });
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 140)));
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
      try {
        if (s.as) await signInAs(page, s.as, s.path);
        else await page.goto(s.path);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await page.waitForTimeout(500);
        if (s.steps) { await s.steps(page); await page.waitForTimeout(700); }
        const found = await page.evaluate(inspect, size !== 'desktop');
        await page.screenshot({ path: `${OUT}/${size}/${s.name}.png`, fullPage: true });
        const all = [...found, ...errors.map((e) => `CONSOLE: ${e}`)];
        if (all.length) report.push(`## ${s.name}`, ...all.map((x) => `- ${x}`));
      } catch (e) {
        report.push(`## ${s.name}`, `- COULD NOT OPEN: ${(e as Error).message.split('\n')[0]}`);
      }
      await page.close();
    }
    writeFileSync(`${OUT}/${size}.md`, report.join('\n') + '\n');
  });
}
