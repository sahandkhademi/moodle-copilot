// Demo helpers in Settings (mock mode only): simulate a new grade, reset the demo.
import { useState } from 'react';
import { useSettings } from '@/lib/settings';
import { KEYS, setItem } from '@/lib/storage';
import { MOCK_QUEUED_GRADE } from '@/lib/data/mock';
import { ABSENCE_KEY } from '@/lib/background/check';

const DELAYS = [
  { label: 'sofort', ms: 0 },
  { label: '5 s', ms: 5000 },
  { label: '10 s', ms: 10000 },
];

function ping(msg: { type: string; silent?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.id) return resolve();
      chrome.runtime.sendMessage(msg).then(() => resolve(), () => resolve());
    } catch {
      resolve();
    }
  });
}

const btn =
  'rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-60';

export function DemoTools() {
  const [s] = useSettings();
  const [delay, setDelay] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (!s.mockMode) return null;

  const flash = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(''), 2500);
  };

  const simulate = async () => {
    setBusy('sim');
    try {
      // Reset first so repeated clicks always produce a fresh "new" grade.
      await setItem(KEYS.mockExtraGrades, []);
      await ping({ type: 'check-now', silent: true });
      if (delay > 0) {
        flash(`Note kommt in ${delay / 1000} s …`);
        await new Promise((r) => setTimeout(r, delay));
      }
      await setItem(KEYS.mockExtraGrades, [{ ...MOCK_QUEUED_GRADE, gradedAt: new Date().toISOString() }]);
      await ping({ type: 'check-now' });
      flash('Neue Note gesendet ✓');
    } catch {
      flash('Fehler');
    }
    setBusy(null);
  };

  const reset = async () => {
    setBusy('reset');
    try {
      await setItem(KEYS.mockExtraGrades, []);
      await setItem(KEYS.gradeSnapshot, null);
      await setItem(ABSENCE_KEY, null);
      await setItem(KEYS.unseenGrades, []);
      await setItem(KEYS.googleSynced, {});
      await setItem(KEYS.doneDeadlines, {});
      await ping({ type: 'check-now', silent: true });
      flash('Demo zurückgesetzt ✓');
    } catch {
      flash('Fehler');
    }
    setBusy(null);
  };

  return (
    <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <button
          disabled={busy !== null}
          onClick={simulate}
          className={`${btn} flex-1 bg-brand-600 text-white hover:bg-brand-700`}
        >
          🎬 Neue Note simulieren
        </button>
        <select
          value={delay}
          onChange={(e) => setDelay(Number(e.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
        >
          {DELAYS.map((d) => (
            <option key={d.ms} value={d.ms}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          disabled={busy !== null}
          onClick={reset}
          className={`${btn} border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800`}
        >
          ↺ Demo zurücksetzen
        </button>
        <span className="text-xs text-brand-600 dark:text-brand-500">{note}</span>
      </div>
    </div>
  );
}
