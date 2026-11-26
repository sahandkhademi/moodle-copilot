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

export function looksLikeLoginPage(url: string, html: string): boolean {
  return /\/login\/index\.php/.test(url) || (/id="loginbtn"/.test(html) && /name="password"/.test(html));
}

const AUTH_CODES = /requireloginerror|servicerequireslogin|sessiontimedout|notloggedin|nologin/i;

/** Unwraps the first element of an AJAX response array; throws on error. */
export function unwrapAjax<T>(json: unknown): T {
  const first = Array.isArray(json) ? json[0] : json;
  if (!first || typeof first !== 'object') throw new Error('Unerwartete Moodle-Antwort');
  const r = first as { error?: boolean; data?: T; exception?: { errorcode?: string; message?: string } };
  if (r.error || r.exception) {
    const code = r.exception?.errorcode ?? '';
    if (AUTH_CODES.test(code)) throw new MoodleAuthError();
    const e = new Error(r.exception?.message || code || 'Moodle-Fehler');
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
export function parseCourses(data: { courses?: RawCourse[] }, baseUrl: string): Course[] {
  return (data?.courses ?? []).map((c) => ({
    id: c.id,
    shortname: c.shortname ?? String(c.fullname ?? c.id),
    fullname: c.fullname ?? c.shortname ?? String(c.id),
    url: c.viewurl || `${baseUrl}/course/view.php?id=${c.id}`,
  }));
}

// ---- Deadlines ----
interface RawEvent {
  id: number;
  name?: string;
  description?: string;
  modulename?: string;
  timesort?: number;
  timestart?: number;
  url?: string;
  course?: { id?: number };
  action?: { actionable?: boolean; url?: string } | null;
}
export function deadlineType(ev: Pick<RawEvent, 'modulename' | 'name'>): DeadlineType {
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
    out.push({
      id: 'mdl-' + ev.id,
      courseId: ev.course?.id ?? 0,
      title: stripHtml(ev.name ?? 'Termin'),
      type: deadlineType(ev),
      due: new Date(ts * 1000).toISOString(),
      url: absUrl(ev.action?.url || ev.url, baseUrl),
      description: desc || undefined,
      submitted: ev.action && ev.action.actionable === false ? true : undefined,
    });
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
