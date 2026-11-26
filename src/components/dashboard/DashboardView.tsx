// Moodle-style Dashboard: Timeline block (2.2), Grades block with what-if (4.1) and absence alerts (4.2).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttendanceRecord, Course, Deadline, GradeItem } from '@/lib/types';
import { getData } from '@/lib/data';
import { useSettings } from '@/lib/settings';
import { absenceStatus } from '@/lib/attendance';
import { getItem, KEYS, setItem, watchItem, type FocusRequest } from '@/lib/storage';
import { SyncAllButton } from '@/components/google/AddToGoogleButton';
import DeadlineTimeline from './DeadlineTimeline';
import CourseCard from './CourseCard';
import { Block, cx } from '@/components/ui/moodle';
import { TriangleAlert } from 'lucide-react';
import { dayDiff, isOverdue, shortCourse } from './util';

interface Loaded {
  courses: Course[];
  deadlines: Deadline[];
  grades: GradeItem[];
  attendance: AttendanceRecord[];
}

const bar = 'bg-surface-3';
function Skeleton() {
  return (
    <div className="animate-pulse space-y-4 p-4">
      <div className={`h-8 w-40 ${bar}`} />
      <div className="border border-line p-4">
        <div className={`mb-4 h-5 w-24 ${bar}`} />
        <div className="grid grid-cols-2 gap-2">
          <div className={`h-9 ${bar}`} />
          <div className={`h-9 ${bar}`} />
          <div className={`col-span-2 h-9 ${bar}`} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-5 flex gap-3">
            <div className={`h-4 w-10 ${bar}`} />
            <div className={`h-7 w-7 ${bar}`} />
            <div className="flex-1 space-y-2">
              <div className={`h-4 w-3/4 ${bar}`} />
              <div className={`h-3 w-1/2 ${bar}`} />
            </div>
          </div>
        ))}
      </div>
      <div className={`h-40 ${bar}`} />
    </div>
  );
}

export default function DashboardView({ focus }: { focus: FocusRequest | null; onNavigate: (tab: FocusRequest['tab']) => void }) {
  const [settings] = useSettings();

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
      <div className="p-4">
        <h1 className="mb-4 text-[1.75rem] font-bold leading-tight text-ink">Dashboard</h1>
        <Block>
          <p className="py-6 text-center text-muted">No data found. Enable demo mode or check the Moodle URL in Settings.</p>
        </Block>
      </div>
    );
  }

  const courseById = new Map(data.courses.map((c) => [c.id, c]));
  const isDone = (d: Deadline) => done.has(d.id) || !!d.submitted;
  const pending = data.deadlines.filter((d) => !isDone(d));
  const overdue = pending.filter((d) => isOverdue(d, now)).length;
  const dueWeek = pending.filter((d) => !isOverdue(d, now) && dayDiff(new Date(d.due), now) <= 7).length;
  const syncable = pending.filter((d) => !isOverdue(d, now)).map((d) => ({ deadline: d, course: courseById.get(d.courseId) }));

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-[1.75rem] font-bold leading-tight text-ink">Dashboard</h1>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(({ course, status }) => {
            const over = status.state === 'over';
            const name = shortCourse(course.fullname);
            return (
              <button
                key={course.id}
                onClick={() => jumpTo(course.id)}
                className={cx(
                  'flex w-full items-start gap-2.5 border px-3 py-2.5 text-left text-[0.9375rem]',
                  over ? 'border-danger bg-danger-subtle text-danger' : 'border-warning bg-warning-subtle text-warning-ink',
                )}
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <strong>{name}:</strong>{' '}
                  {over
                    ? `absence limit exceeded (${status.absences} of ${status.allowed} allowed). You failed on attendance.`
                    : status.left === 0
                      ? 'no more absences allowed. One more and you fail on attendance.'
                      : `${status.left} more absence${status.left === 1 ? '' : 's'} allowed before you fail on attendance.`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[0.875rem] text-muted">
        <span>
          {dueWeek} due this week{overdue > 0 && ` \u00b7 ${overdue} overdue`}
        </span>
        {syncable.length > 0 && <SyncAllButton items={syncable} />}
      </div>

      <DeadlineTimeline deadlines={data.deadlines} courses={data.courses} done={done} onToggleDone={toggleDone} now={now} />

      <Block title="Grades" id="grades">
        <div className="-mb-3 -mt-2">
          {data.courses.map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              items={data.grades.filter((g) => g.courseId === c.id)}
              attendance={attByCourse.get(c.id)}
              settings={settings}
              open={isOpen(c.id)}
              onToggle={() => setOpen(c.id, !isOpen(c.id))}
              highlightGradeId={highlight}
              cardRef={(el) => {
                if (el) cardEls.current.set(c.id, el);
                else cardEls.current.delete(c.id);
              }}
            />
          ))}
        </div>
      </Block>
    </div>
  );
}
