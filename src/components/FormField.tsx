import type { InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export default function FormField({ label, hint, id, ...inputProps }: Props) {
  const fieldId = id ?? inputProps.name;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <input id={fieldId} {...inputProps} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
