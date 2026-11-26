// "Data up front": one compact text block with the student's courses, grades, needed scores, absences and deadlines,
// placed in the system prompt so the model can answer without a tool round trip. All numbers come from code.
import { getData } from '../data';
import { absenceStatus } from '../attendance';
import { courseStanding, GRADE_LABELS, neededForGrade, percentToGrade, type AustrianGrade } from '../grading';
import { getSettings, type Settings } from '../settings';
import { KEYS, watchItem } from '../storage';
import type { Course, Deadline, GradeItem } from '../types';

export interface Snapshot {
  text: string;
  builtAt: number;
  settings: Settings;
}

/** Rebuild when older than this at the start of a turn. */
export const SNAPSHOT_MAX_AGE_MS = 3 * 60_000;
const DEADLINE_WINDOW_DAYS = 21;
const MAX_GRADED_PER_COURSE = 8;

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : String(r1(n)));
const gradeStr = (g: AustrianGrade) => `${g} (${GRADE_LABELS[g].en})`;
const vienna = (iso: string, now: number) => {
  const d = new Date(iso);
  const s = d.toLocaleString('en-GB', { timeZone: 'Europe/Vienna', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const days = Math.round((d.getTime() - now) / 86400_000);
  return `${s} (${days < 0 ? `${-days}d ago` : days === 0 ? 'today' : `in ${days}d`})`;
};

function courseBlock(c: Course, items: GradeItem[], att: { absences: number; allowed: number; left: number; state: string } | undefined, s: Settings): string {
  const cut = s.gradeCutoffs;
  const st = courseStanding(items, cut);
  const lines: string[] = [];
  lines.push(`## ${c.shortname} | ${c.fullname} | course_id ${c.id} | ${c.url}`);
  lines.push(
    st.currentPercent == null
      ? 'Standing: nothing graded yet'
      : `Standing: ${r1(st.currentPercent)}% on graded items -> current_grade ${gradeStr(st.currentGrade!)}; ${r1(st.gradedWeight * 100)}% of the course graded`,
  );
  if (st.remaining.length) {
    const rem = st.remaining.map((i) => `${i.name} (${i.maxScore} pts, weight ${r1(i.weight * 100)}%)`).join('; ');
    lines.push(`Remaining: ${rem}`);
    const needs = ([1, 2, 3, 4] as const).map((g) => {
      const r = neededForGrade(items, g, cut);
      if (r.status === 'secured') return `grade ${g}: secured`;
      if (r.status === 'impossible') return `grade ${g}: impossible`;
      const per = r.perItem.map((p) => `${p.item.name} ${fmtPts(p.neededPoints)}/${p.item.maxScore}`).join(', ');
      return `grade ${g}: avg ${r1(r.neededPercent)}% on remaining (${per})`;
    });
    lines.push(`Needed on remaining items: ${needs.join(' | ')}`);
  } else {
    lines.push('Remaining: none, all items graded');
  }
  const graded = items
    .filter((i) => i.score != null)
    .sort((a, b) => (b.gradedAt ?? '').localeCompare(a.gradedAt ?? ''))
    .slice(0, MAX_GRADED_PER_COURSE);
  if (graded.length) {
    lines.push('Graded, newest first:');
    for (const i of graded) {
      const pct = (i.score! / i.maxScore) * 100;
      const g = percentToGrade(pct, cut);
      const avg = i.classAverage == null ? '' : ` | class avg ${r1((i.classAverage / i.maxScore) * 100)}%`;
      const fb = i.feedback ? ` | feedback: ${i.feedback}` : '';
      lines.push(`- ${i.name} | ${fmtPts(i.score!)}/${i.maxScore} = ${r1(pct)}% | item_grade ${gradeStr(g)}${avg}${fb} | ${i.url ?? ''}`);
    }
  }
  lines.push(
    att
      ? `Absences: ${att.absences} of ${att.allowed} allowed, ${att.left} left, state ${att.state}`
      : 'Absences: no attendance data',
  );
  return lines.join('\n');
}

function deadlineLine(d: Deadline, label: Map<number, string>, now: number): string {
  return `- id ${d.id} | ${d.title} | ${d.type}${d.meeting ? ' (online meeting)' : ''} | due ${vienna(d.due, now)} | ${label.get(d.courseId) ?? d.courseId} | ${d.url ?? ''}`;
}

export async function buildSnapshot(now = new Date()): Promise<Snapshot> {
  const [data, settings] = await Promise.all([getData(), getSettings()]);
  const [courses, grades, deadlines, attendance] = await Promise.all([data.getCourses(), data.getGrades(), data.getDeadlines(), data.getAttendance()]);
  const t = now.getTime();
  const label = new Map(courses.map((c) => [c.id, c.shortname]));
  const att = new Map(attendance.map((r) => [r.courseId, absenceStatus(r, settings.absenceLimit)]));

  const blocks = courses.map((c) =>
    courseBlock(c, grades.filter((g) => g.courseId === c.id), att.get(c.id), settings),
  );

  const limit = t + DEADLINE_WINDOW_DAYS * 86400_000;
  const overdue = deadlines.filter((d) => new Date(d.due).getTime() < t && !d.submitted).sort((a, b) => a.due.localeCompare(b.due));
  const upcoming = deadlines.filter((d) => {
    const x = new Date(d.due).getTime();
    return x >= t && x <= limit;
  }).sort((a, b) => a.due.localeCompare(b.due));

  const text = [
    `# Student data snapshot (loaded ${now.toLocaleString('en-GB', { timeZone: 'Europe/Vienna', dateStyle: 'medium', timeStyle: 'short' })} Vienna time)`,
    ...blocks,
    `# Deadlines: overdue (unsubmitted) and next ${DEADLINE_WINDOW_DAYS} days, sorted by due date`,
    overdue.length ? `Overdue:\n${overdue.map((d) => deadlineLine(d, label, t)).join('\n')}` : 'Overdue: none',
    upcoming.length ? `Upcoming:\n${upcoming.map((d) => deadlineLine(d, label, t)).join('\n')}` : 'Upcoming: none',
  ].join('\n');
  return { text, builtAt: t, settings };
}

// ---- cache shared by all conversations in this panel ----
let cached: Promise<Snapshot> | null = null;
let dirty = false;
let watching = false;

function watchChanges() {
  if (watching) return;
  watching = true;
  // Settings (cutoffs, absence limit) and mock grades ("simulate new grade") change what the snapshot says.
  watchItem(KEYS.settings, () => (dirty = true));
  watchItem(KEYS.mockExtraGrades, () => (dirty = true));
}

/** Cached snapshot; rebuilt when older than 3 min or after a settings / mock-grade change. Never throws, returns null on failure. */
/** Benchmarks: run without the snapshot (tools only). */
export let snapshotDisabled = false;
export function setSnapshotDisabled(v: boolean) {
  snapshotDisabled = v;
}

export function getSnapshot(): Promise<Snapshot | null> {
  if (snapshotDisabled) return Promise.resolve(null);
  watchChanges();
  const stale = !cached || dirty;
  if (stale) {
    dirty = false;
    const p = buildSnapshot();
    cached = p;
    p.catch(() => {
      if (cached === p) cached = null;
    });
  }
  return cached!.then(
    async (s) => {
      if (Date.now() - s.builtAt <= SNAPSHOT_MAX_AGE_MS) return s;
      dirty = true;
      return getSnapshot();
    },
    () => null,
  );
}

/** Start loading the snapshot (call when the chat view opens) so the first question doesn't wait for it. */
export function prewarmSnapshot(): void {
  void getSnapshot();
}
