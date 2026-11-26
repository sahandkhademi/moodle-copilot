import { useMemo, useState } from 'react';
import type { Course, Deadline } from '@/lib/types';
import { AddToGoogleButton } from '@/components/google/AddToGoogleButton';
import type { Lang, T } from './i18n';
import { bucketOf, countdown, courseColor, STRIPE, TYPE_ICON, urgency, type Bucket } from './util';

interface Props {
  deadlines: Deadline[];
  courses: Course[];
  done: Set<string>;
  onToggleDone(id: string): void;
  now: Date;
  lang: Lang;
  t: T;
}

const ORDER: Bucket[] = ['overdue', 'today', 'week', 'later'];
const BUCKET_TONE: Record<Bucket, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-orange-600 dark:text-orange-400',
  week: 'text-slate-600 dark:text-slate-300',
  later: 'text-slate-500',
};

export default function DeadlineTimeline({ deadlines, courses, done, onToggleDone, now, lang, t }: Props) {
  const [filter, setFilter] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const isDone = (d: Deadline) => done.has(d.id) || !!d.submitted;
  const filtered = deadlines.filter((d) => filter == null || d.courseId === filter);
  const open = filtered.filter((d) => !isDone(d));
  const finished = filtered.filter(isDone);
  const groups = ORDER.map((b) => ({ b, items: open.filter((d) => bucketOf(d.due, now) === b) })).filter((g) => g.items.length);

  const chipBase = 'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors';
  const chipOn = 'bg-slate-900 text-white dark:bg-white dark:text-slate-900';
  const chipOff = 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';

  const row = (d: Deadline) => {
    const course = courseById.get(d.courseId);
    const col = courseColor(d.courseId);
    const checked = isDone(d);
    const u = urgency(d.due, now);
    return (
      <li
        key={d.id}
        className={`group relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-slate-200 bg-white py-2.5 pl-4 pr-2 transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 ${checked ? 'opacity-60' : ''}`}
      >
        <span className={`absolute inset-y-0 left-0 w-1 ${STRIPE[u]}`} />
        <input
          type="checkbox"
          checked={checked}
          disabled={!!d.submitted && !done.has(d.id)}
          onChange={() => onToggleDone(d.id)}
          title={t('markDone')}
          aria-label={t('markDone')}
          className="h-4 w-4 shrink-0 cursor-pointer accent-brand-500"
        />
        <button
          onClick={() => d.url && window.open(d.url, '_blank', 'noopener')}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <div className="flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-px text-[10px] font-semibold tracking-wide ${col.pill}`}>{course?.shortname ?? '?'}</span>
            <span className="text-xs" aria-hidden>{TYPE_ICON[d.type]}</span>
          </div>
          <div className={`mt-0.5 truncate text-sm font-medium ${checked ? 'line-through' : ''}`}>{d.title}</div>
          <div className={`text-xs ${u === 'overdue' ? 'font-medium text-red-600 dark:text-red-400' : u === 'soon' ? 'text-orange-600 dark:text-orange-400' : 'text-slate-500'}`}>
            {countdown(d.due, now, t, lang)}
          </div>
        </button>
        <AddToGoogleButton item={{ deadline: d, course }} />
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <button onClick={() => setFilter(null)} className={`${chipBase} ${filter == null ? chipOn : chipOff}`}>
          {t('all')}
        </button>
        {courses.map((c) => (
          <button key={c.id} onClick={() => setFilter(filter === c.id ? null : c.id)} className={`${chipBase} ${filter === c.id ? chipOn : chipOff}`}>
            {c.shortname}
          </button>
        ))}
      </div>

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 py-6 text-center text-sm text-slate-500 dark:border-slate-700">{t('empty')}</div>
      )}

      {groups.map(({ b, items }) => (
        <section key={b} className="space-y-1.5">
          <h3 className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${BUCKET_TONE[b]}`}>
            {t(b)}
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">{items.length}</span>
          </h3>
          <ul className="space-y-1.5">{items.map(row)}</ul>
        </section>
      ))}

      {finished.length > 0 && (
        <div>
          <button onClick={() => setShowDone((v) => !v)} className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            {showDone ? `▾ ${t('hideDone')}` : `▸ ${t('doneN', { n: finished.length })}`}
          </button>
          {showDone && <ul className="mt-1.5 space-y-1.5">{finished.map(row)}</ul>}
        </div>
      )}
    </div>
  );
}
