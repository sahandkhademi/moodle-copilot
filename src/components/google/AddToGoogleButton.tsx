// One-click "add to Google" buttons used by the dashboard (plan 3.4, 3.5).
import { useEffect, useState } from 'react';
import { syncToGoogle, type SyncItem } from '@/lib/google/sync';
import { CalendarIcon, CheckIcon, Spinner, T, failedResult, useLang, useSynced } from './shared';

type State = 'idle' | 'busy' | 'done' | 'error';

export function AddToGoogleButton({ item, compact = true }: { item: SyncItem; compact?: boolean }) {
  const t = T[useLang()];
  const synced = useSynced();
  const already = !!synced[item.deadline.id]?.calendar && !!synced[item.deadline.id]?.tasks;
  const [state, setState] = useState<State>('idle');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (already && state === 'idle') setState('done');
  }, [already, state]);

  const run = async () => {
    if (state === 'busy' || state === 'done') return;
    setState('busy');
    setErr('');
    const [r] = await syncToGoogle([item], { calendar: true, tasks: true });
    if (failedResult(r)) {
      setErr(r?.error ?? t.failed);
      setState('error');
    } else setState('done');
  };

  const tone =
    state === 'done'
      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
      : state === 'error'
        ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-400'
        : 'text-slate-500 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-brand-500';
  const title = state === 'error' ? `${err} (${t.retry})` : state === 'done' ? t.added : t.add;
  const label = state === 'done' ? t.added : state === 'busy' ? t.syncing : state === 'error' ? t.retry : t.add;

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === 'busy' || state === 'done'}
      title={title}
      aria-label={title}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all duration-200 active:scale-95 ${compact ? 'h-7 w-7' : 'h-8 px-2.5'} ${tone}`}
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        {state === 'busy' ? <Spinner /> : state === 'done' ? <CheckIcon className="h-4 w-4" /> : <CalendarIcon />}
      </span>
      {!compact && <span>{label}</span>}
    </button>
  );
}

export function SyncAllButton({ items }: { items: SyncItem[] }) {
  const t = T[useLang()];
  const synced = useSynced();
  const pending = items.filter((i) => !(synced[i.deadline.id]?.calendar && synced[i.deadline.id]?.tasks));
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [count, setCount] = useState(0);
  const [err, setErr] = useState('');

  const run = async () => {
    const todo = pending;
    if (!todo.length || state === 'busy') return;
    setState('busy');
    setErr('');
    setCount(todo.length);
    const rs = await syncToGoogle(todo, { calendar: true, tasks: true });
    const ok = rs.filter((r) => !failedResult(r)).length;
    setCount(ok);
    const bad = rs.find(failedResult);
    if (bad) {
      setErr(bad.error ?? t.failed);
      setState('error');
    } else setState('done');
  };

  const allSynced = items.length > 0 && pending.length === 0;
  const showDone = state === 'done' || (allSynced && state === 'idle');
  const label =
    state === 'busy'
      ? `${t.syncing} ${count}…`
      : state === 'done'
        ? `${count} ${t.inBoth}`
        : state === 'error'
          ? `${count}/${items.length} · ${t.retry}`
          : allSynced
            ? t.allDone
            : `${t.syncAll}${pending.length ? ` (${pending.length})` : ''}`;

  return (
    <button
      type="button"
      onClick={run}
      disabled={state === 'busy' || items.length === 0 || (allSynced && state !== 'error')}
      title={state === 'error' ? err : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-all duration-200 active:scale-95 disabled:cursor-default ${
        showDone
          ? 'bg-emerald-500 text-white'
          : state === 'error'
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60'
      }`}
    >
      {state === 'busy' ? <Spinner className="h-3.5 w-3.5" /> : showDone ? <CheckIcon className="h-3.5 w-3.5" /> : <CalendarIcon className="h-3.5 w-3.5" />}
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
