import { useEffect } from 'react';

interface Props {
  dirty: boolean;
  saving: boolean;
  onSave(): void;
  onReset(): void;
  error?: string | null;
  saved?: boolean;
}

/**
 * Save / discard row under an editable section. With unsaved changes it sticks
 * to the bottom of the screen, and leaving (another tab, a link, closing the
 * page) asks first.
 */
export default function SaveBar({ dirty, saving, onSave, onReset, error, saved }: Props) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('a[href], [role="tab"]');
      if (!el || el.closest('.save-bar')) return;
      if (el.getAttribute('aria-selected') === 'true') return;
      if (!window.confirm('You have unsaved changes. Leave without saving?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  return (
    <div className={`save-bar${dirty ? ' is-dirty' : ''}`}>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {!error && saved && !dirty && <p className="alert alert-success" role="status">Saved.</p>}
      <div className="form-actions">
        {dirty && <span className="save-bar-note small">Unsaved changes</span>}
        <button type="button" className="btn btn-ghost" onClick={onReset} disabled={!dirty || saving}>
          Discard
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
