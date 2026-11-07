import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Loads a value, lets the page edit a copy, and saves it back.
 * `dirty` is true when the copy differs from what was loaded.
 */
export function useEditable<T>(load: () => Promise<T>, save: (value: T) => Promise<void>, deps: unknown[]) {
  const [original, setOriginal] = useState<T | null>(null);
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const v = await load();
      setOriginal(v);
      setValue(v);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
  }, [reload]);

  const dirty = useMemo(() => JSON.stringify(original) !== JSON.stringify(value), [original, value]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setSaved(false);
    setError(null);
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev as T) : next));
  }, []);

  const doSave = useCallback(async () => {
    if (value === null) return;
    setSaving(true);
    setError(null);
    try {
      await save(value);
      await reload();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [value, save, reload]);

  const reset = useCallback(() => {
    setValue(original);
    setError(null);
  }, [original]);

  return { value, setValue: update, loading, saving, error, saved, dirty, save: doSave, reset, reload };
}
