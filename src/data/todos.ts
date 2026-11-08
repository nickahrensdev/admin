import { supabase } from '../lib/supabase';
import { safeError } from '../lib/errors';

export interface Todo {
  id: string;
  title: string;
  notes: string;
  done: boolean;
  sort_order: number;
  created_at: string;
  done_at: string | null;
}

const COLS = 'id, title, notes, done, sort_order, created_at, done_at';

export async function listTodos(): Promise<Todo[]> {
  const { data, error } = await supabase.from('admin_todos').select(COLS).order('sort_order').order('created_at');
  if (error) throw safeError(error);
  return data as Todo[];
}

export async function addTodo(title: string, notes: string): Promise<Todo> {
  const { data, error } = await supabase
    .from('admin_todos')
    .insert({ title: title.trim(), notes: notes.trim(), sort_order: Math.floor(Date.now() / 1000) })
    .select(COLS)
    .single();
  if (error) throw safeError(error);
  return data as Todo;
}

export async function updateTodo(id: string, patch: Partial<Pick<Todo, 'title' | 'notes' | 'done'>>): Promise<Todo> {
  const { data, error } = await supabase.from('admin_todos').update(patch).eq('id', id).select(COLS).single();
  if (error) throw safeError(error);
  return data as Todo;
}

export async function deleteTodo(id: string) {
  const { error } = await supabase.from('admin_todos').delete().eq('id', id);
  if (error) throw safeError(error);
}
