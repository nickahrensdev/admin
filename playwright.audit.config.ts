import base from './playwright.config';
// UI audit: screenshots and layout checks for every screen (see tests/audit/audit.spec.ts).
export default { ...base, testDir: 'tests/audit', retries: 0, timeout: 600_000, workers: 2, fullyParallel: true, use: { ...base.use, actionTimeout: 5_000, trace: 'off' as const } };
