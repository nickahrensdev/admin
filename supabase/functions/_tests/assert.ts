// Tiny assertions so the tests have no downloads beyond the functions' own imports.
export function assert(cond: unknown, msg = 'assertion failed'): asserts cond {
  if (!cond) throw new Error(msg);
}
export function assertEquals<T>(got: T, want: T, msg = '') {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
}
export function assertStringIncludes(actual: string, expected: string, msg = '') {
  if (!actual.includes(expected)) throw new Error(`${msg ? msg + ': ' : ''}expected to find ${JSON.stringify(expected)}`);
}
