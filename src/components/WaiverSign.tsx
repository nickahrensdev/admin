import { useState } from 'react';
import Modal from './Modal';
import { acceptWaiver, type Waiver, type WaiverSignature } from '../data/waiver';

interface FieldsProps {
  waiver: Waiver;
  value: WaiverSignature & { agreed: boolean };
  onChange(value: WaiverSignature & { agreed: boolean }): void;
}

/** The waiver text plus typed-name signature, used at sign up and before booking. */
export function WaiverFields({ waiver, value, onChange }: FieldsProps) {
  const [forMinor, setForMinor] = useState(Boolean(value.participants));
  return (
    <div className="waiver">
      <h3>{waiver.title}</h3>
      <div className="waiver-text" tabIndex={0} aria-label="Waiver text">
        {waiver.body.split(/\n{2,}/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <label className="field">
        <span>Full legal name (your signature)</span>
        <input
          value={value.signerName}
          maxLength={100}
          autoComplete="name"
          onChange={(e) => onChange({ ...value, signerName: e.target.value })}
        />
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={forMinor}
          onChange={(e) => {
            setForMinor(e.target.checked);
            if (!e.target.checked) onChange({ ...value, participants: '' });
          }}
        />
        I’m also signing as parent or guardian for players under 18
      </label>
      {forMinor && (
        <label className="field">
          <span>Players’ names and ages</span>
          <input
            value={value.participants}
            maxLength={300}
            placeholder="e.g. Sam Smith (12), Alex Smith (9)"
            onChange={(e) => onChange({ ...value, participants: e.target.value })}
          />
        </label>
      )}
      <label className="check-line">
        <input type="checkbox" checked={value.agreed} onChange={(e) => onChange({ ...value, agreed: e.target.checked })} />
        I have read and agree to this waiver (version {waiver.version}).
      </label>
    </div>
  );
}

export function waiverProblem(value: WaiverSignature & { agreed: boolean }): string | null {
  if (value.signerName.trim().length < 2) return 'Type your full name to sign the waiver.';
  if (!value.agreed) return 'Check the box to agree to the waiver.';
  return null;
}

/** Sign the current waiver in a dialog (before booking, or from the profile). */
export function WaiverModal({ waiver, defaultName, onSigned, onClose }: { waiver: Waiver; defaultName: string; onSigned(): void; onClose(): void }) {
  const [value, setValue] = useState({ signerName: defaultName, participants: '', agreed: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sign = async () => {
    const problem = waiverProblem(value);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await acceptWaiver(waiver.id, value);
      onSigned();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Sign the waiver" onClose={onClose} wide>
      <p className="muted small">Everyone who trains at The Yard signs this once (and again if it changes).</p>
      <WaiverFields waiver={waiver} value={value} onChange={setValue} />
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Not now</button>
        <button className="btn btn-primary" onClick={sign} disabled={saving}>{saving ? 'Signing…' : 'Sign waiver'}</button>
      </div>
    </Modal>
  );
}
