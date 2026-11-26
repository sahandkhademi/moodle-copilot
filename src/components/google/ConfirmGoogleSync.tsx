// Confirmation card shown before anything is written to Google (plan 3.3). Used inside the chat.
// Placeholder. The polished version is built on branch feat/google-zapier; keep the props stable.
import { useState } from 'react';
import { syncToGoogle, type SyncItem, type SyncOptions, type SyncResult } from '@/lib/google/sync';

export interface ConfirmGoogleSyncProps {
  items: SyncItem[];
  defaultOptions?: SyncOptions;
  onDone?: (results: SyncResult[]) => void;
  onCancel?: () => void;
}

export function ConfirmGoogleSync({ items, defaultOptions = { calendar: true, tasks: true }, onDone, onCancel }: ConfirmGoogleSyncProps) {
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'cancelled'>('ask');
  const confirm = async () => {
    setState('busy');
    const results = await syncToGoogle(items, defaultOptions);
    setState('done');
    onDone?.(results);
  };
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
      <div className="mb-2 font-medium">Add {items.length} item(s) to Google?</div>
      <ul className="mb-3 list-disc pl-5">{items.map((i) => <li key={i.deadline.id}>{i.deadline.title}</li>)}</ul>
      {state === 'ask' && (
        <div className="flex gap-2">
          <button onClick={confirm} className="rounded-lg bg-brand-500 px-3 py-1.5 text-white">Add</button>
          <button onClick={() => { setState('cancelled'); onCancel?.(); }} className="rounded-lg px-3 py-1.5">Cancel</button>
        </div>
      )}
      {state === 'busy' && <span>Adding…</span>}
      {state === 'done' && <span>✓ Done</span>}
      {state === 'cancelled' && <span className="text-slate-500">Cancelled</span>}
    </div>
  );
}
