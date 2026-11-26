// Pure logic for new-grade / absence notifications and the toolbar badge (plan 4.2, 4.4).
// No chrome, no DOM: unit-checked by scripts/check-notifications.ts.
import type { AttendanceRecord, Course, Deadline, GradeItem } from '../types';
import type { GradeCutoffs, Settings } from '../settings';
import { percentToGrade } from '../grading';
import { absenceStatus, ABSENCE_EMOJI, type AbsenceState } from '../attendance';

type Lang = Settings['language'];

/** gradeId -> score (null = not graded yet) */
export type GradeSnapshot = Record<string, number | null>;
/** courseId -> last known absence state */
export type AbsenceSnapshot = Record<string, AbsenceState>;

export function makeGradeSnapshot(grades: GradeItem[]): GradeSnapshot {
  const snap: GradeSnapshot = {};
  for (const g of grades) snap[g.id] = g.score;
  return snap;
}

/** Items that now have a score but did not before. `prev` null = first run, nothing is new. */
export function diffGrades(prev: GradeSnapshot | null, grades: GradeItem[]): GradeItem[] {
  if (!prev) return [];
  return grades.filter((g) => g.score != null && prev[g.id] == null);
}

export interface Notice {
  id: string;
  title: string;
  message: string;
  courseId: number;
  gradeId?: string;
}

export function gradeNotice(item: GradeItem, course: Course | undefined, cutoffs: GradeCutoffs, lang: Lang): Notice {
  const name = course?.fullname ?? course?.shortname ?? '';
  const pct = Math.round(((item.score ?? 0) / item.maxScore) * 100);
  const grade = percentToGrade(pct, cutoffs);
  let message = `${item.name}: ${grade} (${pct} %)`;
  if (item.classAverage != null) {
    const avg = Math.round((item.classAverage / item.maxScore) * 100);
    message += ` · ${lang === 'de' ? 'Klassenschnitt' : 'Class average'} ${avg} %`;
  }
  return {
    id: `grade:${item.courseId}:${item.id}`,
    title: lang === 'de' ? `📊 Neue Note in ${name}` : `📊 New grade in ${name}`,
    message,
    courseId: item.courseId,
    gradeId: item.id,
  };
}

export function makeAbsenceSnapshot(records: AttendanceRecord[], defaultLimit: number): AbsenceSnapshot {
  const snap: AbsenceSnapshot = {};
  for (const r of records) snap[String(r.courseId)] = absenceStatus(r, defaultLimit).state;
  return snap;
}

const SEVERITY: Record<AbsenceState, number> = { safe: 0, warning: 1, over: 2 };

/** Courses that just got worse (safe->warning/over, warning->over). `prev` null = first run. */
export function absenceNotices(
  prev: AbsenceSnapshot | null,
  records: AttendanceRecord[],
  courses: Course[],
  defaultLimit: number,
  lang: Lang,
): Notice[] {
  if (!prev) return [];
  const out: Notice[] = [];
  for (const r of records) {
    const st = absenceStatus(r, defaultLimit);
    const before = prev[String(r.courseId)] ?? 'safe';
    if (SEVERITY[st.state] <= SEVERITY[before]) continue;
    const c = courses.find((x) => x.id === r.courseId);
    const name = c?.fullname ?? c?.shortname ?? '';
    let text: string;
    if (st.state === 'over') {
      text = lang === 'de' ? 'Fehlstunden-Limit überschritten' : 'absence limit exceeded';
    } else if (st.left <= 0) {
      text = lang === 'de' ? 'keine Fehlstunde mehr erlaubt' : 'no more absences allowed';
    } else if (lang === 'de') {
      text = `nur noch ${st.left} Fehlstunde${st.left === 1 ? '' : 'n'} erlaubt`;
    } else {
      text = `only ${st.left} absence${st.left === 1 ? '' : 's'} left`;
    }
    out.push({
      id: `absence:${r.courseId}`,
      title: lang === 'de' ? 'Anwesenheit' : 'Attendance',
      message: `${ABSENCE_EMOJI[st.state]} ${name}: ${text}`,
      courseId: r.courseId,
    });
  }
  return out;
}

export interface BadgeState {
  text: string;
  color: string;
}

export const BADGE_RED = '#dc2626';
export const BADGE_ORANGE = '#f97316';

/** Unseen grades -> red count. Else open deadlines due within 48 h -> orange count. Else empty. */
export function computeBadge(
  unseen: string[],
  deadlines: Deadline[],
  done: Record<string, unknown> | string[] | null | undefined,
  now = Date.now(),
): BadgeState {
  if (unseen.length > 0) return { text: String(unseen.length), color: BADGE_RED };
  const isDone = (id: string) => (Array.isArray(done) ? done.includes(id) : !!done && !!(done as Record<string, unknown>)[id]);
  const n = deadlines.filter((d) => {
    const t = Date.parse(d.due);
    return !d.submitted && !isDone(d.id) && t >= now && t - now <= 48 * 3600_000;
  }).length;
  return n > 0 ? { text: String(n), color: BADGE_ORANGE } : { text: '', color: BADGE_ORANGE };
}

/** Notification id -> focus target. */
export function parseNoticeId(id: string): { courseId: number; gradeId?: string } | null {
  const m = /^(grade|absence):(\d+)(?::(.+))?$/.exec(id);
  if (!m) return null;
  return m[1] === 'grade' ? { courseId: Number(m[2]), gradeId: m[3] } : { courseId: Number(m[2]) };
}
