// Confirmation card shown before anything is written to Google (plan 3.3). Used inside the chat.
import { useMemo, useState } from 'react';
import { CalendarDays, Check, ListChecks, X, type LucideIcon } from 'lucide-react';
import { syncToGoogle, type SyncItem, type SyncOptions, type SyncOutcome, type SyncResult } from '@/lib/google/sync';
import { Block, Button, Spinner } from '@/components/ui/moodle';
import { failedResult, useSynced } from './shared';

export interface ConfirmGoogleSyncProps {
  items: SyncItem[];
  defaultOptions?: SyncOptions;
  onDone?: (results: SyncResult[]) => void;
  onCancel?: () => void;
}

type Phase = 'ask' | 'busy' | 'done' | 'cancelled';

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
}

function Switch({ on, onChange, label, icon: Icon }: { on: boolean; onChange: (v: boolean) => void; label: string; icon: LucideIcon }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[0.9375rem]">
      <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <Icon className="h-4 w-4 text-muted" />
      {label}
    </label>
  );
}

function Outcome({ o, label }: { o: SyncOutcome; label: string }) {
  if (o === 'skipped') return null;
  const bad = o === 'failed';
  return (
    <span className={`inline-flex items-center gap-1 text-[0.8125rem] ${bad ? 'text-danger' : o === 'exists' ? 'text-muted' : 'text-success'}`}>
      {bad ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
      {label}: {bad ? 'failed' : o === 'exists' ? 'already there' : 'created'}
    </span>
  );
}

export function ConfirmGoogleSync({ items, defaultOptions = { calendar: true, tasks: true }, onDone, onCancel }: ConfirmGoogleSyncProps) {
  const synced = useSynced();
  const [phase, setPhase] = useState<Phase>('ask');
  const [cal, setCal] = useState(defaultOptions.calendar);
  const [tasks, setTasks] = useState(defaultOptions.tasks);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((i) => i.deadline.id)));
  const [results, setResults] = useState<Map<string, SyncResult>>(new Map());
  const chosen = useMemo(() => items.filter((i) => picked.has(i.deadline.id)), [items, picked]);
  const can = chosen.length > 0 && (cal || tasks);

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const confirm = async () => {
    if (!can) return;
    setPhase('busy');
    const rs = await syncToGoogle(chosen, { calendar: cal, tasks });
    setResults(new Map(rs.map((r) => [r.deadlineId, r])));
    setPhase('done');
    onDone?.(rs);
  };

  const shown = phase === 'ask' || phase === 'cancelled' ? items : chosen;
  const failedCount = [...results.values()].filter(failedResult).length;
  const title = phase === 'done' ? (failedCount ? `${chosen.length - failedCount} of ${chosen.length} added` : 'Added to Google') : 'Add to Google';

  return (
    <Block title={title} className="w-full max-w-[420px] text-[0.9375rem]">
      <ul className={`-mx-4 -mt-2 max-h-72 divide-y divide-line overflow-y-auto ${phase === 'cancelled' ? 'opacity-50' : ''}`}>
        {shown.map((i) => {
          const id = i.deadline.id;
          const r = results.get(id);
          const was = synced[id];
          const bad = failedResult(r);
          return (
            <li key={id} className="flex items-start gap-2.5 px-4 py-2">
              {phase === 'ask' ? (
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-500" checked={picked.has(id)} onChange={() => toggle(id)} aria-label={i.deadline.title} />
              ) : phase === 'busy' ? (
                <Spinner className="mt-0.5 h-4 w-4 shrink-0" />
              ) : r ? (
                bad ? <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="leading-snug">
                  {i.course && <span className="mr-1.5 font-bold text-muted">{i.course.shortname}</span>}
                  <span>{i.deadline.title}</span>
                </div>
                <div className="text-[0.8125rem] text-muted">
                  {fmtDate(i.deadline.due)}
                  {phase === 'ask' && was?.calendar && was?.tasks && <span className="ml-1.5 text-success">· already in Google</span>}
                </div>
                {r && (
                  <div className="mt-0.5 flex flex-wrap gap-x-3">
                    <Outcome o={r.calendar} label="Calendar" />
                    <Outcome o={r.tasks} label="Tasks" />
                    {r.error && <div className="w-full text-[0.8125rem] text-danger">{r.error}</div>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {phase === 'ask' && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Switch on={cal} onChange={setCal} label="Google Calendar" icon={CalendarDays} />
            <Switch on={tasks} onChange={setTasks} label="Google Tasks" icon={ListChecks} />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={confirm} disabled={!can}>
              {can ? `Add ${chosen.length}` : 'Nothing selected'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPhase('cancelled');
                onCancel?.();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {phase === 'busy' && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-muted">
          <Spinner /> Adding to Google…
        </div>
      )}
      {phase === 'done' && failedCount > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <Button variant="outline" size="sm" onClick={() => setPhase('ask')}>
            Try again
          </Button>
        </div>
      )}
      {phase === 'cancelled' && <div className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-muted">Cancelled</div>}
    </Block>
  );
}
