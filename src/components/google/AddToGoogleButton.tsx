// One-click "add to Google" buttons used by the dashboard (plan 3.4, 3.5).
import { useEffect, useState } from 'react';
import { Check, CalendarCheck, CalendarPlus, CalendarX, Loader2 } from 'lucide-react';
import { syncToGoogle, type SyncItem } from '@/lib/google/sync';
import { Button } from '@/components/ui/moodle';
import { failedResult, useSynced } from './shared';

type State = 'idle' | 'busy' | 'done' | 'error';

export function AddToGoogleButton({ item, compact = true }: { item: SyncItem; compact?: boolean }) {
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
      setErr(r?.error ?? 'Failed');
      setState('error');
    } else setState('done');
  };

  const title =
    state === 'error' ? `${err} (click to retry)` : state === 'done' ? 'Added to Google Calendar and Tasks' : state === 'busy' ? 'Adding...' : 'Add to Google Calendar and Tasks';
  const icon = (cls: string) =>
    state === 'busy' ? <Loader2 className={`${cls} animate-spin`} /> : state === 'done' ? <CalendarCheck className={`${cls} text-success`} /> : state === 'error' ? <CalendarX className={`${cls} text-danger`} /> : <CalendarPlus className={cls} />;

  if (!compact) {
    return (
      <Button variant="outline" size="sm" onClick={run} disabled={state === 'busy' || state === 'done'} title={title}>
        {icon('h-3.5 w-3.5')}
        {state === 'done' ? 'In Google' : state === 'error' ? 'Retry' : 'Add to Google'}
      </Button>
    );
  }

  const tone = state === 'done' ? 'text-success' : state === 'error' ? 'text-danger' : 'text-muted hover:text-brand-500';
  return (
    <button
      type="button"
      onClick={run}
      disabled={state === 'busy' || state === 'done'}
      title={title}
      aria-label={title}
      className={`inline-grid h-7 w-7 shrink-0 place-items-center rounded-none bg-transparent transition-colors disabled:cursor-default ${tone}`}
    >
      {icon('h-[18px] w-[18px]')}
    </button>
  );
}

export function SyncAllButton({ items }: { items: SyncItem[] }) {
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
      setErr(bad.error ?? 'Failed');
      setState('error');
    } else setState('done');
  };

  const allSynced = items.length > 0 && pending.length === 0;
  const showDone = state === 'done' || (allSynced && state === 'idle');
  const label =
    state === 'busy'
      ? `Syncing ${count}…`
      : state === 'done'
        ? `Synced ${count}`
        : state === 'error'
          ? `${count}/${items.length} synced · Retry`
          : allSynced
            ? `Synced ${items.length}`
            : 'Sync all to Google';

  return (
    <Button variant="primary" size="sm" onClick={run} busy={state === 'busy'} disabled={items.length === 0 || (allSynced && state !== 'error')} title={state === 'error' ? err : undefined}>
      {showDone && <Check className="h-3.5 w-3.5" />}
      <span className="tabular-nums">{label}</span>
    </Button>
  );
}
