// "Test connection" control in Settings: runs every Moodle call once and shows a checklist.
import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/moodle';
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
      out.push({ label: `Courses: ${courses.length}`, ok: true });
    } catch (e) {
      out.push({ label: 'Courses', ok: false, error: msg(e) });
    }
    try {
      const d = await src.getDeadlines();
      out.push({ label: `Deadlines: ${d.length}`, ok: true });
    } catch (e) {
      out.push({ label: 'Deadlines', ok: false, error: msg(e) });
    }
    if (courses[0]) {
      try {
        const g = await src.getGrades(courses[0].id);
        out.push(g.length ? { label: `Grades (${courses[0].fullname}): ${g.length}`, ok: true } : { label: `Grades (${courses[0].fullname})`, ok: false, error: 'no grades found' });
      } catch (e) {
        out.push({ label: `Grades (${courses[0].fullname})`, ok: false, error: msg(e) });
      }
      try {
        const a = await src.getAttendance();
        out.push(a.length ? { label: `Attendance: ${a.length} course${a.length === 1 ? '' : 's'}`, ok: true } : { label: 'Attendance', ok: false, error: 'not found' });
      } catch (e) {
        out.push({ label: 'Attendance', ok: false, error: msg(e) });
      }
    } else {
      out.push({ label: 'Grades', ok: false, error: 'skipped (no courses)' });
      out.push({ label: 'Attendance', ok: false, error: 'skipped (no courses)' });
    }
    setChecks(out);
    setRunning(false);
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={run} busy={running}>
        {running ? 'Testing…' : 'Test connection'}
      </Button>
      {checks && (
        <ul className="space-y-1 text-[0.9375rem]">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-1.5">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
              <span>
                {c.label}
                {c.error && <span className="ml-1.5 text-[0.8125rem] text-muted">{c.error}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
