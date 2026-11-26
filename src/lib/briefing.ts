// Daily briefing: a short plain-English "here's your day" built locally from Moodle data.
// No LLM: instant, works offline/in demo mode, and the facts are always exact.
import type { AttendanceRecord, Course, Deadline, GradeItem } from './types';
import { absenceStatus } from './attendance';
import { GRADE_LABELS, percentToGrade } from './grading';
import type { Settings } from './settings';

export type BriefingTone = 'good' | 'heads-up' | 'action';

export interface BriefingPoint {
  kind: 'overdue' | 'due-soon' | 'absence' | 'exam' | 'new-grade' | 'week';
  text: string;
  url?: string;
  courseId?: number;
}

export interface Briefing {
  tone: BriefingTone;
  /** "You're good to go" / "A couple of things this week" / "Needs your attention" */
  headline: string;
  /** The whole briefing as 1–4 plain sentences. */
  text: string;
  points: BriefingPoint[];
  generatedAt: string;
}

export interface BriefingInput {
  courses: Course[];
  deadlines: Deadline[];
  grades: GradeItem[];
  attendance: AttendanceRecord[];
  doneIds?: string[];
  unseenGradeIds?: string[];
}

const DAY = 86_400_000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** "today", "tomorrow", "in 3 days", "on Monday" (within a week), "on 12 Dec". */
export function relDay(iso: string, now = new Date()): string {
  const days = Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / DAY);
  if (days < 0) return days === -1 ? 'yesterday' : `${-days} days ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days} days`;
  return `on ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Short course name for sentences: "VL / UE Logic" → "Logic". */
export function plainCourse(c?: Course): string {
  if (!c) return 'a course';
  return c.fullname.replace(/^((VL|UE|VO|KV|KO|KS|KT|PR|PS|SE|IK|VU)\s*\/?\s*)+/, '').trim() || c.fullname;
}

export function buildBriefing(input: BriefingInput, settings: Pick<Settings, 'absenceLimit' | 'gradeCutoffs'>, now = new Date()): Briefing {
  const course = (id: number) => input.courses.find((c) => c.id === id);
  const done = new Set(input.doneIds ?? []);
  const t = now.getTime();
  const open = input.deadlines.filter((d) => !d.submitted && !done.has(d.id) && !d.meeting);

  const overdue = open.filter((d) => new Date(d.due).getTime() < t && t - new Date(d.due).getTime() < 7 * DAY);
  const soon = open.filter((d) => new Date(d.due).getTime() >= t && new Date(d.due).getTime() - t <= 3 * DAY);
  const week = open.filter((d) => new Date(d.due).getTime() >= t && new Date(d.due).getTime() - t <= 7 * DAY);
  const exams = open.filter((d) => d.type === 'exam' && new Date(d.due).getTime() - t > 3 * DAY && new Date(d.due).getTime() - t <= 21 * DAY);
  const absences = input.attendance
    .map((r) => ({ r, s: absenceStatus(r, settings.absenceLimit) }))
    .filter(({ s }) => s.state !== 'safe')
    .sort((a, b) => a.s.left - b.s.left);
  const newGrades = input.grades.filter((g) => g.score != null && (input.unseenGradeIds ?? []).includes(g.id));

  const points: BriefingPoint[] = [];
  const sentences: string[] = [];

  // 1. Overdue: the only thing that makes it "action needed" on its own.
  if (overdue.length) {
    const names = overdue.slice(0, 2).map((d) => `${d.title} (${plainCourse(course(d.courseId))})`);
    sentences.push(`${listJoin(names)} ${overdue.length === 1 ? 'is' : 'are'} overdue${overdue.length > 2 ? `, plus ${overdue.length - 2} more` : ''}.`);
    overdue.forEach((d) => points.push({ kind: 'overdue', text: `${d.title} was due ${relDay(d.due, now)}`, url: d.url, courseId: d.courseId }));
  }

  // 2. Due in the next 3 days.
  if (soon.length) {
    const names = soon.slice(0, 3).map((d) => `${d.title} ${relDay(d.due, now)}`);
    sentences.push(`You have ${listJoin(names)}${soon.length > 3 ? ` and ${soon.length - 3} more` : ''}.`);
    soon.forEach((d) => points.push({ kind: 'due-soon', text: `${d.title} (${plainCourse(course(d.courseId))}) — ${relDay(d.due, now)}`, url: d.url, courseId: d.courseId }));
  } else if (week.length) {
    sentences.push(`Nothing due in the next 3 days; ${week.length} thing${week.length === 1 ? '' : 's'} later this week.`);
    points.push({ kind: 'week', text: `${week.length} due later this week` });
  }

  // 3. Absences.
  for (const { r, s } of absences.slice(0, 2)) {
    const name = plainCourse(course(r.courseId));
    const text =
      s.state === 'over'
        ? `You're over the absence limit in ${name} (${s.absences} of ${s.allowed}). Talk to the lecturer.`
        : s.left === 0
          ? `Don't miss the next ${name} class: you've used all ${s.allowed} allowed absences.`
          : `Make sure you don't miss ${name} next time: only ${s.left} more absence${s.left === 1 ? '' : 's'} allowed.`;
    sentences.push(text);
    points.push({ kind: 'absence', text, url: r.url, courseId: r.courseId });
  }

  // 4. New grades.
  for (const g of newGrades.slice(0, 2)) {
    const pct = (g.score! / g.maxScore) * 100;
    const grade = percentToGrade(pct, settings.gradeCutoffs);
    const text = `New grade in ${plainCourse(course(g.courseId))}: ${g.name}, ${grade} (${GRADE_LABELS[grade].en}, ${Math.round(pct)}%).`;
    sentences.push(text);
    points.push({ kind: 'new-grade', text, url: g.url, courseId: g.courseId });
  }

  // 5. Upcoming exams (only mentioned if nothing more pressing fills the briefing).
  if (exams.length && sentences.length < 3) {
    const e = exams[0]!;
    sentences.push(`Coming up: ${e.title} ${relDay(e.due, now)}.`);
    points.push({ kind: 'exam', text: `${e.title} ${relDay(e.due, now)}`, url: e.url, courseId: e.courseId });
  }

  const tone: BriefingTone = overdue.length || absences.some(({ s }) => s.state === 'over') ? 'action' : soon.length || absences.length ? 'heads-up' : 'good';
  const headline = tone === 'good' ? "You're good to go" : tone === 'heads-up' ? "You're mostly good" : 'Needs your attention';

  let text: string;
  if (!sentences.length) {
    text = "You're good to go. Nothing is due in the next 7 days and your attendance is fine everywhere.";
  } else if (tone === 'good') {
    text = `You're good to go. Nothing is due in the next 3 days. ${sentences.join(' ')}`;
  } else if (tone === 'heads-up' && !overdue.length) {
    // "You're good to go. You have X in 2 days, but other than that, you're fine. Just make sure …"
    const [first, ...rest] = sentences;
    text = `You're good to go. ${first!.replace(/\.$/, '')}${soon.length ? ', but other than that, you\'re fine.' : '.'}${rest.length ? ' ' + rest.map((s) => s.replace(/^Make sure/, 'Just make sure')).join(' ') : ''}`;
  } else {
    text = sentences.join(' ');
  }

  return { tone, headline, text, points, generatedAt: now.toISOString() };
}
