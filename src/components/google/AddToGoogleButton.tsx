// One-click "add to Google" buttons used by the dashboard (plan 3.4).
// Placeholder UI. The polished version is built on branch feat/google-zapier; keep the props stable.
import { useState } from 'react';
import { syncToGoogle, type SyncItem } from '@/lib/google/sync';

export function AddToGoogleButton({ item, compact = true }: { item: SyncItem; compact?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const run = async () => {
    setState('busy');
    const [r] = await syncToGoogle([item], { calendar: true, tasks: true });
    setState(!r || r.calendar === "failed" || r.tasks === "failed" ? "error" : "done");
  };
  return (
    <button onClick={run} disabled={state === 'busy'} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
      {state === 'done' ? '✓' : state === 'busy' ? '…' : compact ? '📅' : '📅 Add to Google'}
    </button>
  );
}

export function SyncAllButton({ items }: { items: SyncItem[] }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const run = async () => {
    setState('busy');
    await syncToGoogle(items, { calendar: true, tasks: true });
    setState('done');
  };
  return (
    <button onClick={run} disabled={state === 'busy'} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-60">
      {state === 'done' ? '✓ Synced' : state === 'busy' ? 'Syncing…' : 'Sync all to Google'}
    </button>
  );
}
