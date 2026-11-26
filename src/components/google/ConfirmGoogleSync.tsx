// Confirmation card shown before anything is written to Google (plan 3.3). Used inside the chat.
import { useMemo, useState } from 'react';
import { syncToGoogle, type SyncItem, type SyncOptions, type SyncOutcome, type SyncResult } from '@/lib/google/sync';
import { CheckIcon, Spinner, T, useLang, useSynced } from './shared';

export interface ConfirmGoogleSyncProps {
  items: SyncItem[];
  defaultOptions?: SyncOptions;
  onDone?: (results: SyncResult[]) => void;
  onCancel?: () => void;
}

type Phase = 'ask' | 'busy' | 'done' | 'cancelled';

function fmtDate(iso: string, lang: 'de' | 'en') {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-AT' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna',
  }).format(d);
}

function Pill({ children }: { children: string }) {
  return <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:bg-brand-500/15 dark:text-brand-500">{children}</span>;
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        on
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-500'
          : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'
      } disabled:opacity-60`}
    >
      {label}
    </button>
  );
}

function Outcome({ o, label, t }: { o: SyncOutcome; label: string; t: (typeof T)['de'] | (typeof T)['en'] }) {
  if (o === 'skipped') return null;
  const tone = o === 'failed' ? 'text-red-600 dark:text-red-400' : o === 'exists' ? 'text-slate-500 dark:text-slate-400' : 'text-emerald-600 dark:text-emerald-400';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${tone}`}>
      {o === 'failed' ? '✕' : <CheckIcon className="h-3 w-3" />}
      {label} · {o === 'failed' ? t.failed : o === 'exists' ? t.exists : t.created}
    </span>
  );
}

export function ConfirmGoogleSync({ items, defaultOptions = { calendar: true, tasks: true }, onDone, onCancel }: ConfirmGoogleSyncProps) {
  const lang = useLang();
  const t = T[lang];
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
  const failedCount = [...results.values()].filter((r) => r.calendar === 'failed' || r.tasks === 'failed').length;

  return (
    <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-sm transition-all dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
        <div className="font-semibold">{phase === 'done' ? (failedCount ? `${chosen.length - failedCount}/${chosen.length} ${t.done}` : `✓ ${t.done}`) : t.confirmTitle}</div>
        {phase === 'ask' && <span className="text-xs text-slate-500 dark:text-slate-400">{chosen.length}/{items.length}</span>}
      </div>

      <ul className={`max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800 ${phase === 'cancelled' ? 'opacity-50' : ''}`}>
        {shown.map((i) => {
          const id = i.deadline.id;
          const r = results.get(id);
          const was = synced[id];
          return (
            <li key={id} className="flex items-start gap-2.5 px-3.5 py-2.5 transition-colors">
              {phase === 'ask' ? (
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-500" checked={picked.has(id)} onChange={() => toggle(id)} aria-label={i.deadline.title} />
              ) : phase === 'busy' ? (
                <Spinner className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              ) : r ? (
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white ${r.calendar === 'failed' || r.tasks === 'failed' ? 'bg-red-500' : 'bg-emerald-500'}`}>
                  {r.calendar === 'failed' || r.tasks === 'failed' ? <span className="text-[10px] leading-none">✕</span> : <CheckIcon className="h-3 w-3" />}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {i.course && <Pill>{i.course.shortname}</Pill>}
                  <span className="truncate font-medium">{i.deadline.title}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {fmtDate(i.deadline.due, lang)}
                  {phase === 'ask' && was?.calendar && was?.tasks && <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">· {t.added}</span>}
                </div>
                {r && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <Outcome o={r.calendar} label={t.calendar} t={t} />
                    <Outcome o={r.tasks} label={t.tasks} t={t} />
                    {r.error && <div className="w-full text-[11px] text-red-600 dark:text-red-400">{r.error}</div>}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {phase === 'ask' && (
        <div className="space-y-3 border-t border-slate-100 px-3.5 py-3 dark:border-slate-800">
          <div className="flex gap-2">
            <Toggle on={cal} onChange={setCal} label={`📅 ${t.calendar}`} />
            <Toggle on={tasks} onChange={setTasks} label={`✅ ${t.tasks}`} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={!can}
              className="flex-1 rounded-lg bg-brand-500 px-3 py-2 font-semibold text-white shadow-sm transition-all hover:bg-brand-600 active:scale-[0.98] disabled:opacity-50"
            >
              {can ? `${t.confirm} (${chosen.length})` : t.nothing}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase('cancelled');
                onCancel?.();
              }}
              className="rounded-lg px-3 py-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      {phase === 'busy' && (
        <div className="flex items-center gap-2 border-t border-slate-100 px-3.5 py-3 text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <Spinner className="h-4 w-4 text-brand-500" /> {t.syncing}
        </div>
      )}
      {phase === 'done' && failedCount > 0 && (
        <div className="border-t border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
          <button type="button" onClick={() => setPhase('ask')} className="text-xs font-semibold text-brand-600 hover:underline">
            {t.retry}
          </button>
        </div>
      )}
      {phase === 'cancelled' && <div className="border-t border-slate-100 px-3.5 py-2.5 text-xs text-slate-500 dark:border-slate-800">{t.cancelled}</div>}
    </div>
  );
}
