// One-click "add to Google" buttons used by the side-panel dashboard: instant tick + always-available Undo.
import { CalendarCheck, CalendarPlus, CalendarX, Loader2, Undo2 } from 'lucide-react';
import { syncToGoogle, undoGoogle, type SyncItem } from '@/lib/google/sync';
import { useGoogleToggle } from '@/lib/google/useGoogleToggle';
import { Button } from '@/components/ui/moodle';
import { useSynced } from './shared';

const BOTH = { calendar: true, tasks: true };

export function AddToGoogleButton({ item, compact = true }: { item: SyncItem; compact?: boolean }) {
  const synced = useSynced();
  const id = item.deadline.id;
  const t = useGoogleToggle({
    ids: [id],
    alreadySynced: !!synced[id]?.calendar && !!synced[id]?.tasks,
    add: () => syncToGoogle([item], BOTH),
    undo: (ids) => undoGoogle(ids, [item]),
  });
  const added = t.phase === 'added';
  const undoErr = added && t.error ? <span className="max-w-[220px] truncate text-[0.75rem] text-danger" title={t.error}>Undo failed: {t.error}</span> : null;

  const icon = (cls: string) =>
    t.phase === 'undoing' ? <Loader2 className={`${cls} animate-spin`} /> : added ? <CalendarCheck className={`${cls} text-success ${t.pending ? 'animate-pulse' : ''}`} /> : t.phase === 'error' ? <CalendarX className={`${cls} text-danger`} /> : <CalendarPlus className={cls} />;
  const title = t.phase === 'error' ? `${t.error} (click to retry)` : added ? (t.pending ? 'Adding to Google…' : 'In Google Calendar and Tasks') : t.phase === 'undoing' ? 'Removing…' : 'Add to Google Calendar and Tasks';

  if (!compact) {
    return added || t.phase === 'undoing' ? (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[0.8125rem] text-success">{icon('h-3.5 w-3.5')} In Google</span>
        <Button variant="link" size="sm" onClick={t.undo} disabled={t.phase === 'undoing'}>
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </Button>
        {undoErr}
      </span>
    ) : (
      <Button variant="outline" size="sm" onClick={t.add} title={title}>
        {icon('h-3.5 w-3.5')}
        {t.phase === 'error' ? 'Retry' : 'Add to Google'}
      </Button>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center">
      <button
        type="button"
        onClick={added ? undefined : t.add}
        disabled={t.phase === 'undoing'}
        title={title}
        aria-label={title}
        className={`inline-grid h-7 w-7 place-items-center bg-transparent transition-colors ${added ? 'cursor-default' : t.phase === 'error' ? 'text-danger' : 'text-muted hover:text-brand-500'}`}
      >
        {icon('h-[18px] w-[18px]')}
      </button>
      {(added || t.phase === 'undoing') && (
        <button type="button" onClick={t.undo} disabled={t.phase === 'undoing'} className="text-[0.75rem] text-brand-500 hover:underline disabled:opacity-60" title="Remove from Google Calendar and Tasks">
          Undo
        </button>
      )}
      {undoErr && <span className="ml-1.5">{undoErr}</span>}
    </span>
  );
}

export function SyncAllButton({ items }: { items: SyncItem[] }) {
  const synced = useSynced();
  const pending = items.filter((i) => !(synced[i.deadline.id]?.calendar && synced[i.deadline.id]?.tasks));
  const ids = items.map((i) => i.deadline.id);
  const t = useGoogleToggle({
    ids,
    alreadySynced: items.length > 0 && pending.length === 0,
    add: () => syncToGoogle(pending.length ? pending : items, BOTH),
    undo: (ids) => undoGoogle(ids, items),
  });
  if (!items.length) return null;
  if (t.phase === 'added' || t.phase === 'undoing') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 text-[0.8125rem] text-success ${t.pending ? 'animate-pulse' : ''}`}>
          <CalendarCheck className="h-3.5 w-3.5" /> {items.length} in Google
        </span>
        <Button variant="link" size="sm" onClick={t.undo} busy={t.phase === 'undoing'}>
          {t.phase !== 'undoing' && <Undo2 className="h-3.5 w-3.5" />} Undo
        </Button>
        {t.error && <span className="max-w-[220px] truncate text-[0.75rem] text-danger" title={t.error}>Undo failed: {t.error}</span>}
      </span>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={t.add} title={t.phase === 'error' ? t.error : undefined}>
      <CalendarPlus className="h-3.5 w-3.5" />
      {t.phase === 'error' ? 'Retry sync' : `Sync ${pending.length || items.length} to Google`}
    </Button>
  );
}
