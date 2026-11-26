// Pure parsers for Moodle AJAX (lib/ajax/service.php) responses and small HTML bits.
import type { Course, Deadline, DeadlineType, GradeItem } from '../../types';
import { MoodleAuthError } from './errors';
import { absUrl, EXAM_RE, parseNum, stripHtml } from './util';
import { kindFrom, normalizeWeights } from './parseGrades';

/** Finds the sesskey in a Moodle page (M.cfg JSON, `"sesskey":"abc"`). */
export function parseSesskey(html: string): string | null {
  return html.match(/"sesskey"\s*:\s*"([A-Za-z0-9]+)"/)?.[1] ?? html.match(/sesskey=([A-Za-z0-9]{10})/)?.[1] ?? null;
}

export function parseUserId(html: string): number | null {
  const m = html.match(/"userId"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Moodle's guest account is user id 1; guests also get a sesskey, so check the id, not just the sesskey. */
export function isRealUser(userId: number | null | undefined): userId is number {
  return typeof userId === 'number' && userId > 1;
}

export function looksLikeLoginPage(url: string, html: string): boolean {
  return /\/login\/index\.php/.test(url) || (/id="loginbtn"/.test(html) && /name="password"/.test(html));
}

const AUTH_CODES = /requireloginerror|servicerequireslogin|sessiontimedout|notloggedin|nologin/i;

/** Unwraps the first element of an AJAX response array; throws on error. */
export function unwrapAjax<T>(json: unknown): T {
  const first = Array.isArray(json) ? json[0] : json;
  if (!first || typeof first !== 'object') throw new Error('Unexpected Moodle response');
  const r = first as { error?: boolean; data?: T; exception?: { errorcode?: string; message?: string } };
  if (r.error || r.exception) {
    const code = r.exception?.errorcode ?? '';
    if (AUTH_CODES.test(code)) throw new MoodleAuthError();
    const e = new Error(r.exception?.message || code || 'Moodle error');
    (e as Error & { code?: string }).code = code;
    throw e;
  }
  return r.data as T;
}

// ---- Courses ----
interface RawCourse {
  id: number;
  fullname?: string;
  shortname?: string;
  viewurl?: string;
}

const COURSE_TYPE = /^(VL|UE|VO|KV|KO|KS|KT|PR|PS|SE|IK|VU|AG|EX|PJ|SV)\b/;
const STOP = new Set(['and', 'in', 'for', 'of', 'the', 'to', 'a', 'an', 'und', 'für', 'der', 'die', 'das', 'als', 'mit', 'on']);

/**
 * JKU full names look like "338.001/2/4/…, VL / UE Logic, Jane Doe et al., 2026W".
 * Returns { title: "VL / UE Logic", teacher: "Jane Doe et al." }. Other Moodles pass through unchanged.
 */
export function splitCourseName(fullname: string): { title: string; teacher?: string } {
  const parts = fullname.split(/,\s+/).map((p) => p.trim()).filter(Boolean);
  const i = parts.findIndex((p) => COURSE_TYPE.test(p));
  if (i < 0) return { title: fullname.trim() };
  const teacher = parts[i + 1] && !/^\d{4}[WS]$/.test(parts[i + 1]!) ? parts[i + 1] : undefined;
  return { title: parts[i]!, teacher };
}

/** Short label for pills: "VL / UE Logic" → "LOG", "KV Current Topics in AI" → "CTAI", "KO Mathematics for AI I" → "MAI1". */
export function shortLabel(title: string): string {
  const words = title.replace(COURSE_TYPE, '').replace(/^\s*\/\s*(UE|VL|PR)\b/, '').replace(/[-–]/g, ' ').split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !STOP.has(w.toLowerCase()));
  if (meaningful.length === 1) return meaningful[0]!.slice(0, 3).toUpperCase();
  return meaningful
    .map((w) => (w === 'I' ? '1' : w === 'II' ? '2' : w === 'III' ? '3' : /^[A-Z0-9]{2,3}$/.test(w) ? w : w[0]!.toUpperCase()))
    .join('')
    .slice(0, 5);
}

export function parseCourses(data: { courses?: RawCourse[] }, baseUrl: string): Course[] {
  const courses = (data?.courses ?? []).map((c) => {
    const full = stripHtml(c.fullname ?? c.shortname ?? String(c.id));
    const { title, teacher } = splitCourseName(full);
    const course: Course = {
      id: c.id,
      shortname: title !== full ? shortLabel(title) : c.shortname ?? full,
      fullname: title,
      url: c.viewurl || `${baseUrl}/course/view.php?id=${c.id}`,
    };
    if (teacher) course.teacher = teacher;
    return course;
  });
  // Same label twice (e.g. "VL / UE Mathematics for AI I" and "KO Mathematics for AI I")? Prefix the course type: "UE MAI1", "KO MAI1".
  const count = new Map<string, number>();
  for (const c of courses) count.set(c.shortname, (count.get(c.shortname) ?? 0) + 1);
  return courses.map((c) => {
    if ((count.get(c.shortname) ?? 0) < 2) return c;
    const type = c.fullname.match(/^((?:[A-Z]{2}\s*\/\s*)*[A-Z]{2})\b/)?.[1]?.split('/').pop()?.trim();
    return type ? { ...c, shortname: `${type} ${c.shortname}` } : c;
  });
}

// ---- Deadlines ----
interface RawEvent {
  id: number;
  name?: string;
  activityname?: string;
  component?: string;
  overdue?: boolean;
  description?: string;
  modulename?: string;
  timesort?: number;
  timestart?: number;
  url?: string;
  course?: { id?: number };
  action?: { actionable?: boolean; url?: string } | null;
}
const MEETING_MODULES = new Set(['zoom', 'bigbluebuttonbn', 'webex', 'teams']);

export function deadlineType(ev: Pick<RawEvent, 'modulename' | 'name'>): DeadlineType {
  if (ev.modulename === 'quiz') return 'quiz';
  if (MEETING_MODULES.has(ev.modulename ?? '')) return 'event';
  if (EXAM_RE.test(ev.name ?? '')) return 'exam';
  if (ev.modulename === 'assign') return 'assignment';
  if (ev.modulename === 'quiz') return 'quiz';
  return 'event';
}
export function parseDeadlines(data: { events?: RawEvent[] }, baseUrl: string): Deadline[] {
  const out: Deadline[] = [];
  for (const ev of data?.events ?? []) {
    const ts = ev.timesort ?? ev.timestart;
    if (!ts) continue;
    const desc = ev.description ? stripHtml(ev.description) : undefined;
    // Moodle's event name carries the verb ("Sheet 3 is due", "Practice Quiz closes"); the timeline shows the activity name.
    const title = stripHtml(ev.activityname || (ev.name ?? 'Event').replace(/\s+(is due|closes|opens|is due to be graded|should be completed)$/i, ''));
    const d: Deadline = {
      id: 'mdl-' + ev.id,
      courseId: ev.course?.id ?? 0,
      title,
      type: deadlineType(ev),
      due: new Date(ts * 1000).toISOString(),
      url: absUrl(ev.action?.url || ev.url, baseUrl),
      description: desc || undefined,
      // Not "submitted": Moodle drops submitted items from action events. actionable=false only means "can't act right now".
    };
    if (MEETING_MODULES.has(ev.modulename ?? '')) d.meeting = true;
    out.push(d);
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

// ---- Grades via gradereport_user_get_grade_items ----
interface RawGradeItem {
  id: number;
  itemname?: string | null;
  itemtype?: string; // mod | course | category | manual
  itemmodule?: string | null;
  cmid?: number | null;
  graderaw?: number | null;
  gradeformatted?: string;
  grademax?: number;
  weightraw?: number | null;
  weightformatted?: string;
  feedback?: string;
  gradedategraded?: number | null;
}
export function parseGradeItemsJson(data: { usergrades?: { gradeitems?: RawGradeItem[] }[] }, courseId: number, baseUrl: string): GradeItem[] {
  const raw = (data?.usergrades?.[0]?.gradeitems ?? []).filter((i) => i.itemtype !== 'course' && i.itemtype !== 'category' && i.itemname);
  const items = raw.map((i): GradeItem => {
    const score = i.graderaw != null ? i.graderaw : /\d/.test(i.gradeformatted ?? '') ? parseNum(i.gradeformatted) : null;
    const weight = i.weightraw != null ? i.weightraw : parseNum(i.weightformatted);
    return {
      id: `mdl-g-${i.id}`,
      courseId,
      name: stripHtml(i.itemname ?? ''),
      kind: kindFrom(i.itemname ?? '', i.itemmodule),
      score: score ?? null,
      maxScore: i.grademax ?? 100,
      weight: weight ?? NaN,
      gradedAt: i.gradedategraded ? new Date(i.gradedategraded * 1000).toISOString() : undefined,
      feedback: i.feedback ? stripHtml(i.feedback) || undefined : undefined,
      url: i.cmid && i.itemmodule ? `${baseUrl}/mod/${i.itemmodule}/view.php?id=${i.cmid}` : undefined,
    };
  });
  return normalizeWeights(items);
}

// ---- Attendance module discovery ----
/** cmids of mod_attendance instances linked from a course page. */
export function parseAttendanceCmids(html: string): number[] {
  const ids = new Set<number>();
  for (const m of html.matchAll(/\/mod\/attendance\/view\.php\?id=(\d+)/g)) ids.add(Number(m[1]));
  return [...ids];
}

/** Same from core_course_get_contents JSON. */
export function parseAttendanceCmidsFromContents(sections: { modules?: { modname?: string; id: number }[] }[]): number[] {
  const ids: number[] = [];
  for (const s of sections ?? []) for (const m of s.modules ?? []) if (m.modname === 'attendance') ids.push(m.id);
  return ids;
}
