import { useEffect, useState, type FormEvent } from 'react';
import { addTodo, deleteTodo, listTodos, updateTodo, type Todo } from '../../data/todos';

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function Todos() {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTodos().then(setTodos).catch((e: Error) => setError(e.message));
  }, []);

  const replace = (t: Todo) => setTodos((list) => (list ?? []).map((x) => (x.id === t.id ? t : x)));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const t = await addTodo(title, notes);
      setTodos((list) => [...(list ?? []), t]);
      setTitle('');
      setNotes('');
      setShowNotes(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: Todo) => {
    replace({ ...t, done: !t.done });
    try {
      replace(await updateTodo(t.id, { done: !t.done }));
    } catch (err) {
      replace(t);
      setError((err as Error).message);
    }
  };

  const remove = async (t: Todo) => {
    if (!window.confirm(`Delete “${t.title}”?`)) return;
    try {
      await deleteTodo(t.id);
      setTodos((list) => (list ?? []).filter((x) => x.id !== t.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const open = (todos ?? []).filter((t) => !t.done);
  const done = (todos ?? []).filter((t) => t.done).sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));

  return (
    <section className="todos">
      <div className="page-header">
        <div>
          <h1>To-dos</h1>
          <p className="muted">{todos ? `${open.length} open · ${done.length} done` : ''}</p>
        </div>
      </div>

      <form className="card todo-add" onSubmit={add}>
        <input aria-label="New to-do" placeholder="Add a to-do…" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        {showNotes ? (
          <textarea aria-label="Notes" placeholder="Notes or steps (optional)" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} rows={4} />
        ) : (
          <button type="button" className="link-button" onClick={() => setShowNotes(true)}>+ Add notes</button>
        )}
        <button className="btn btn-primary" disabled={saving || !title.trim()}>{saving ? 'Adding…' : 'Add'}</button>
      </form>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {!todos && !error && <div className="page-loading">Loading…</div>}

      {todos && (
        <ul className="todo-list">
          {open.map((t) => <TodoItem key={t.id} todo={t} onToggle={toggle} onSaved={replace} onDelete={remove} onError={setError} />)}
          {open.length === 0 && <li className="card muted">Nothing left to do.</li>}
        </ul>
      )}

      {done.length > 0 && (
        <details className="todo-done">
          <summary>Done ({done.length})</summary>
          <ul className="todo-list">
            {done.map((t) => <TodoItem key={t.id} todo={t} onToggle={toggle} onSaved={replace} onDelete={remove} onError={setError} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

function TodoItem({
  todo: t,
  onToggle,
  onSaved,
  onDelete,
  onError,
}: {
  todo: Todo;
  onToggle(t: Todo): void;
  onSaved(t: Todo): void;
  onDelete(t: Todo): void;
  onError(msg: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes);

  const save = async () => {
    try {
      onSaved(await updateTodo(t.id, { title: title.trim() || t.title, notes }));
      setEditing(false);
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <li className={`card todo${t.done ? ' is-done' : ''}`}>
      <div className="todo-row">
        <input type="checkbox" checked={t.done} onChange={() => onToggle(t)} aria-label={t.done ? 'Mark as not done' : 'Mark as done'} />
        {editing ? (
          <input className="todo-title-input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        ) : (
          <button className="todo-title" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
            {t.title}
            {t.notes && !expanded && <span className="muted small"> · notes</span>}
          </button>
        )}
      </div>
      {(expanded || editing) && (
        <div className="todo-body">
          {editing ? (
            <textarea value={notes} maxLength={4000} rows={8} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
          ) : (
            t.notes && <p className="todo-notes">{t.notes}</p>
          )}
          <p className="muted small">
            Added {fmt(t.created_at)}
            {t.done_at && ` · done ${fmt(t.done_at)}`}
          </p>
          <div className="form-actions">
            {editing ? (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setTitle(t.title); setNotes(t.notes); }}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
              </>
            ) : (
              <>
                <button className="btn btn-danger-ghost btn-sm" onClick={() => onDelete(t)}>Delete</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
