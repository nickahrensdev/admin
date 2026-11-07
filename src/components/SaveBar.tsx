interface Props {
  dirty: boolean;
  saving: boolean;
  onSave(): void;
  onReset(): void;
  error?: string | null;
  saved?: boolean;
}

/** Save / discard row shown under an editable section. */
export default function SaveBar({ dirty, saving, onSave, onReset, error, saved }: Props) {
  return (
    <div className="save-bar">
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {!error && saved && !dirty && <p className="alert alert-success" role="status">Saved.</p>}
      <div className="form-actions">
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
