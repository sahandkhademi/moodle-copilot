// Deadline dashboard (plan 2.2), grade cards + what-if (4.1) and absence warnings (4.2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttendanceRecord, Course, Deadline, GradeItem } from '@/lib/types';
import { getData } from '@/lib/data';
import { useSettings } from '@/lib/settings';
import { absenceStatus } from '@/lib/attendance';
import { getItem, KEYS, setItem, watchItem, type FocusRequest } from '@/lib/storage';
import { SyncAllButton } from '@/components/google/AddToGoogleButton';
import { makeT } from './i18n';
import DeadlineTimeline from './DeadlineTimeline';
import CourseCard from './CourseCard';
import { bucketOf, num } from './util';

interface Loaded {
  courses: Course[];
  deadlines: Deadline[];
  grades: GradeItem[];
  attendance: AttendanceRecord[];
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      <div className="h-14 rounded-xl bg-slate-100 dark:bg-slate-800" />
      <div className="h-8 rounded-lg bg-slate-100 dark:bg-slate-800" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-slate-800" />
      ))}
      <div className="h-24 rounded-2xl bg-slate-100 dark:bg-slate-800" />
    </div>
  );
}

export default function DashboardView({ focus }: { focus: FocusRequest | null; onNavigate: (tab: FocusRequest['tab']) => void }) {
  const [settings] = useSettings();
  const lang = settings.language === 'en' ? 'en' : 'de';
  const t = useMemo(() => makeT(lang), [lang]);

  const [data, setData] = useState<Loaded | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => new Date());
  const [openCards, setOpenCards] = useState<Set<number> | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const cardEls = useRef(new Map<number, HTMLElement>());
  const handledFocus = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const src = await getData();
      const [courses, deadlines, grades, attendance] = await Promise.all([src.getCourses(), src.getDeadlines(), src.getGrades(), src.getAttendance()]);
      setData({ courses, deadlines, grades, attendance });
      setNow(new Date());
    } catch (e) {
      console.warn('[dashboard] load failed', e);
      setData((d) => d ?? { courses: [], deadlines: [], grades: [], attendance: [] });
    }
  }, []);

  // Reload when the data source changes (mock toggle, Moodle URL) and when a demo grade is revealed.
  useEffect(() => {
    load();
  }, [load, settings.mockMode, settings.moodleUrl]);
  useEffect(() => watchItem(KEYS.mockExtraGrades, () => load()), [load]);

  // Done deadlines (persisted).
  useEffect(() => {
    getItem<string[]>(KEYS.doneDeadlines, []).then((ids) => setDone(new Set(ids)));
    return watchItem(KEYS.doneDeadlines, (v) => setDone(new Set((v as string[] | undefined) ?? [])));
  }, []);
  const toggleDone = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDone(next);
    setItem(KEYS.doneDeadlines, [...next]);
  };

  // Keep countdowns fresh.
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(i);
  }, []);

  const attByCourse = useMemo(() => new Map((data?.attendance ?? []).map((a) => [a.courseId, a])), [data]);
  const alerts = useMemo(
    () =>
      (data?.courses ?? [])
        .map((c) => {
          const rec = attByCourse.get(c.id);
          return rec ? { course: c, status: absenceStatus(rec, settings.absenceLimit) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x && x.status.state !== 'safe'),
    [data, attByCourse, settings.absenceLimit],
  );

  // Default: expand the courses with an absence warning (Logik), collapse the rest.
  const isOpen = (id: number) => (openCards ? openCards.has(id) : alerts.some((a) => a.course.id === id));
  const setOpen = (id: number, open: boolean) => {
    const base = openCards ?? new Set(alerts.map((a) => a.course.id));
    const next = new Set(base);
    if (open) next.add(id);
    else next.delete(id);
    setOpenCards(next);
  };

  const jumpTo = useCallback((courseId: number, gradeId?: string) => {
    setOpenCards((cur) => new Set([...(cur ?? []), courseId]));
    setTimeout(() => {
      const el = (gradeId && document.getElementById(`grade-${gradeId}`)) || cardEls.current.get(courseId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (gradeId) {
        setHighlight(gradeId);
        setTimeout(() => setHighlight((h) => (h === gradeId ? null : h)), 3000);
      }
    }, 120);
  }, []);

  // Focus requests (e.g. clicking a new-grade notification).
  useEffect(() => {
    if (!focus || !data || handledFocus.current === focus.at) return;
    if (focus.courseId == null && focus.gradeId == null) return;
    handledFocus.current = focus.at;
    const courseId = focus.courseId ?? data.grades.find((g) => g.id === focus.gradeId)?.courseId;
    if (courseId != null) jumpTo(courseId, focus.gradeId);
  }, [focus, data, jumpTo]);

  if (!data) return <Skeleton />;
  if (data.courses.length === 0 && data.deadlines.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <div className="text-4xl">🗂️</div>
          <div className="mt-2 font-semibold">{t('noCourses')}</div>
          <div className="mt-1 text-sm text-slate-500">{t('noCoursesHint')}</div>
        </div>
      </div>
    );
  }

  const courseById = new Map(data.courses.map((c) => [c.id, c]));
  const isDone = (d: Deadline) => done.has(d.id) || !!d.submitted;
  const pending = data.deadlines.filter((d) => !isDone(d));
  const dueWeek = pending.filter((d) => ['today', 'week'].includes(bucketOf(d.due, now))).length;
  const overdue = pending.filter((d) => bucketOf(d.due, now) === 'overdue').length;
  const syncable = pending
    .filter((d) => new Date(d.due).getTime() >= now.getTime())
    .map((d) => ({ deadline: d, course: courseById.get(d.courseId) }));

  return (
    <div className="space-y-5 p-4">
      {/* 1. Absence banners */}
      {alerts.length > 0 && (
        <div className="space-y-1.5">
          {alerts.map(({ course, status }) => {
            const over = status.state === 'over';
            const text = over
              ? t('absOver', { c: course.fullname })
              : status.left === 0
                ? t('absZero', { c: course.fullname })
                : status.left === 1
                  ? t('absLeft1', { c: course.fullname })
                  : t('absLeftN', { c: course.fullname, n: status.left });
            return (
              <button
                key={course.id}
                onClick={() => jumpTo(course.id)}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-transform active:scale-[0.99] ${
                  over
                    ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
                    : 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300'
                }`}
              >
                <span className="text-base">{over ? '🔴' : '🟠'}</span>
                <span className="min-w-0 flex-1">{text}</span>
                <span className="text-xs opacity-60">›</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2. Summary */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight">{overdue + dueWeek === 0 ? t('allClear') : t('dueWeek', { n: dueWeek })}</div>
          {overdue > 0 && <div className="text-sm font-medium text-red-600 dark:text-red-400">{t('overdueN', { n: overdue })}</div>}
        </div>
        {syncable.length > 0 && <SyncAllButton items={syncable} />}
      </div>

      {/* 3. Timeline */}
      <DeadlineTimeline deadlines={data.deadlines} courses={data.courses} done={done} onToggleDone={toggleDone} now={now} lang={lang} t={t} />

      {/* 4. Courses */}
      <section className="space-y-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {t('courses')} <span className="font-normal normal-case">· {num(lang, data.courses.length, 0)}</span>
        </h2>
        {data.courses.map((c) => (
          <CourseCard
            key={c.id}
            course={c}
            items={data.grades.filter((g) => g.courseId === c.id)}
            attendance={attByCourse.get(c.id)}
            settings={settings}
            lang={lang}
            t={t}
            open={isOpen(c.id)}
            onToggle={() => setOpen(c.id, !isOpen(c.id))}
            highlightGradeId={highlight}
            cardRef={(el) => {
              if (el) cardEls.current.set(c.id, el);
              else cardEls.current.delete(c.id);
            }}
          />
        ))}
      </section>
    </div>
  );
}
