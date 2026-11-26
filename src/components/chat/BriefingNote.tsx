// "Today" briefing at the top of the Assistant (same text as the Moodle Dashboard card and the morning notification).
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { buildBriefing, type Briefing } from '@/lib/briefing';
import { getData } from '@/lib/data';
import { getSettings } from '@/lib/settings';
import { getItem, KEYS, watchItem } from '@/lib/storage';
import { cx } from '@/components/ui/moodle';

async function load(): Promise<Briefing> {
  const [settings, src] = await Promise.all([getSettings(), getData()]);
  const [courses, deadlines, grades, attendance] = await Promise.all([src.getCourses(), src.getDeadlines(), src.getGrades(), src.getAttendance()]);
  const doneRaw = await getItem<string[] | Record<string, unknown>>(KEYS.doneDeadlines, []);
  return buildBriefing(
    { courses, deadlines, grades, attendance, doneIds: Array.isArray(doneRaw) ? doneRaw : Object.keys(doneRaw), unseenGradeIds: await getItem<string[]>(KEYS.unseenGrades, []) },
    settings,
  );
}

export function BriefingNote() {
  const [b, setB] = useState<Briefing | null>(null);
  useEffect(() => {
    const refresh = () => void load().then(setB, () => setB(null));
    refresh();
    const unwatch = [KEYS.settings, KEYS.mockExtraGrades, KEYS.doneDeadlines, KEYS.unseenGrades].map((k) => watchItem(k, refresh));
    return () => unwatch.forEach((u) => u());
  }, []);
  if (!b) return null;
  const Icon = b.tone === 'good' ? CircleCheck : b.tone === 'heads-up' ? TriangleAlert : CircleAlert;
  return (
    <div
      className={cx(
        'border px-3 py-2.5 text-[0.875rem]',
        b.tone === 'good' && 'border-success/40 bg-success-subtle text-ink',
        b.tone === 'heads-up' && 'border-warning bg-warning-subtle text-warning-ink',
        b.tone === 'action' && 'border-danger/40 bg-danger-subtle text-ink',
      )}
      role="status"
    >
      <div className="mb-1 flex items-center gap-1.5 font-bold">
        <Icon className={cx('h-4 w-4', b.tone === 'good' && 'text-success', b.tone === 'action' && 'text-danger')} />
        Today · {b.headline}
      </div>
      <p className="leading-snug">{b.text}</p>
    </div>
  );
}
