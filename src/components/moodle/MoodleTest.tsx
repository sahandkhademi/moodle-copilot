// "Verbindung testen" control in Settings: runs every Moodle call once and shows a checklist.
import { useState } from 'react';
import { useSettings } from '@/lib/settings';
import { createMoodleSource } from '@/lib/data/moodle';

interface Check {
  label: string;
  ok: boolean;
  error?: string;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function MoodleTest() {
  const [s] = useSettings();
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);

  if (s.mockMode || !s.moodleUrl) return null;

  const run = async () => {
    setRunning(true);
    setChecks(null);
    const out: Check[] = [];
    const src = createMoodleSource(s.moodleUrl);

    let courses: Awaited<ReturnType<typeof src.getCourses>> = [];
    try {
      courses = await src.getCourses();
      out.push({ label: `Kurse: ${courses.length}`, ok: true });
    } catch (e) {
      out.push({ label: 'Kurse', ok: false, error: msg(e) });
    }
    try {
      const d = await src.getDeadlines();
      out.push({ label: `Termine: ${d.length}`, ok: true });
    } catch (e) {
      out.push({ label: 'Termine', ok: false, error: msg(e) });
    }
    if (courses[0]) {
      try {
        const g = await src.getGrades(courses[0].id);
        out.push(g.length ? { label: `Noten (${courses[0].fullname}): ${g.length}`, ok: true } : { label: `Noten (${courses[0].fullname})`, ok: false, error: 'keine Noten gefunden' });
      } catch (e) {
        out.push({ label: `Noten (${courses[0].fullname})`, ok: false, error: msg(e) });
      }
      try {
        const a = await src.getAttendance();
        out.push(a.length ? { label: `Anwesenheit: ${a.length} Kurs(e)`, ok: true } : { label: 'Anwesenheit', ok: false, error: 'nicht gefunden' });
      } catch (e) {
        out.push({ label: 'Anwesenheit', ok: false, error: msg(e) });
      }
    } else {
      out.push({ label: 'Noten', ok: false, error: 'übersprungen (keine Kurse)' });
      out.push({ label: 'Anwesenheit', ok: false, error: 'übersprungen (keine Kurse)' });
    }
    setChecks(out);
    setRunning(false);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {running ? 'Teste …' : 'Verbindung testen'}
      </button>
      {checks && (
        <ul className="space-y-1 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-wrap gap-x-2">
              <span className={c.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{c.ok ? '✓' : '✗'}</span>
              <span>{c.label}</span>
              {c.error && <span className="text-xs text-slate-500">{c.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
