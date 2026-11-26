// Demo helpers in Settings (mock mode only): simulate a new grade, reset the demo.
import { useState } from 'react';
import { Bell, RotateCcw } from 'lucide-react';
import { Button, Select } from '@/components/ui/moodle';
import { useSettings } from '@/lib/settings';
import { KEYS, setItem } from '@/lib/storage';
import { MOCK_QUEUED_GRADE } from '@/lib/data/mock';
import { ABSENCE_KEY } from '@/lib/background/check';

const DELAYS = [
  { label: 'Now', ms: 0 },
  { label: 'In 5 s', ms: 5000 },
  { label: 'In 10 s', ms: 10000 },
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
        flash(`Grade arrives in ${delay / 1000} s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
      await setItem(KEYS.mockExtraGrades, [{ ...MOCK_QUEUED_GRADE, gradedAt: new Date().toISOString() }]);
      await ping({ type: 'check-now' });
      flash('New grade sent');
    } catch {
      flash('Something went wrong');
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
      flash('Demo reset');
    } catch {
      flash('Something went wrong');
    }
    setBusy(null);
  };

  const briefing = async () => {
    setBusy('brief');
    await ping({ type: 'briefing-now' });
    flash('Morning briefing sent');
    setBusy(null);
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={busy !== null} busy={busy === 'sim'} onClick={simulate} className="flex-1">
          Simulate new grade
        </Button>
        <Select value={delay} onChange={(e) => setDelay(Number(e.target.value))} aria-label="Delay" className="!w-auto">
          {DELAYS.map((d) => (
            <option key={d.ms} value={d.ms}>
              {d.label}
            </option>
          ))}
        </Select>
      </div>
      <Button variant="secondary" disabled={busy !== null} busy={busy === 'brief'} onClick={briefing} className="w-full">
        {busy !== 'brief' && <Bell className="h-3.5 w-3.5" />}
        Send morning briefing now
      </Button>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={busy !== null} busy={busy === 'reset'} onClick={reset}>
          {busy !== 'reset' && <RotateCcw className="h-3.5 w-3.5" />}
          Reset demo
        </Button>
        <span className="text-[0.8125rem] text-brand-500">{note}</span>
      </div>
    </div>
  );
}
