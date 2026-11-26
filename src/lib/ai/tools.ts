// Local tools for the chat. All numbers come from code (grading.ts / attendance.ts); the model only explains.
// Executors are plain async functions so scripts/check-chat-tools.ts can call them without a browser.
import type { FunctionDeclaration } from '@google/genai';
import { getData } from '../data';
import { getSettings } from '../settings';
import { courseStanding, GRADE_LABELS, neededForGrade, percentToGrade, projectedGrade, type AustrianGrade } from '../grading';
import { absenceStatus } from '../attendance';
import type { SyncItem, SyncOptions } from '../google/sync';

export type ToolName =
  | 'get_courses'
  | 'get_deadlines'
  | 'get_grades'
  | 'get_attendance'
  | 'calculate_needed_score'
  | 'what_if'
  | 'propose_google_sync';

export interface ToolOutput {
  /** String returned to the model. */
  content: string;
  /** Set by propose_google_sync: the chat renders a confirmation card. */
  syncProposal?: { items: SyncItem[]; options: SyncOptions };
  isError?: boolean;
}

export type ToolHintIcon = 'courses' | 'deadlines' | 'grades' | 'attendance' | 'calc' | 'sync';
export const TOOL_HINTS: Record<ToolName, { icon: ToolHintIcon; label: string }> = {
  get_courses: { icon: 'courses', label: 'Checked courses' },
  get_deadlines: { icon: 'deadlines', label: 'Checked deadlines' },
  get_grades: { icon: 'grades', label: 'Checked grades' },
  get_attendance: { icon: 'attendance', label: 'Checked attendance' },
  calculate_needed_score: { icon: 'calc', label: 'Calculated needed score' },
  what_if: { icon: 'calc', label: 'Ran a what-if' },
  propose_google_sync: { icon: 'sync', label: 'Prepared Google sync' },
};

const optCourse = { type: 'integer', description: 'Only this course id (from get_courses). Omit for all courses.' } as const;

/** Gemini function declarations (JSON schema in parametersJsonSchema). */
export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_courses',
    description: "List the student's courses (id, short name, full name, Moodle URL, teacher).",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_deadlines',
    description:
      'Upcoming deadlines (assignments, quizzes, exams) incl. overdue unsubmitted ones, sorted by due date. Each has an id usable with propose_google_sync.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        course_id: optCourse,
        days_ahead: { type: 'integer', description: 'Only deadlines within the next N days. Omit for all.' },
      },
    },
  },
  {
    name: 'get_grades',
    description:
      'Grade items (score, max, weight, class average, feedback, Moodle url) plus the per-course standing with the Austrian grade (1-5) and label. score null = not graded yet.',
    parametersJsonSchema: { type: 'object', properties: { course_id: optCourse } },
  },
  {
    name: 'get_attendance',
    description: 'Attendance per course: absences, allowed absences, how many are left and the state (safe / warning / over).',
    parametersJsonSchema: { type: 'object', properties: { course_id: optCourse } },
  },
  {
    name: 'calculate_needed_score',
    description:
      'What average is needed on all remaining (ungraded) items of a course to reach an Austrian grade 1-4? Returns percent and points per item, or impossible/secured.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'integer', description: 'Course id from get_courses' },
        target_grade: { type: 'integer', enum: [1, 2, 3, 4], description: 'Austrian grade to reach' },
      },
      required: ['course_id', 'target_grade'],
    },
  },
  {
    name: 'what_if',
    description: 'Projected final grade of a course if the student scores a given percent on every remaining item.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'integer', description: 'Course id from get_courses' },
        percent_on_remaining: { type: 'number', description: '0-100' },
      },
      required: ['course_id', 'percent_on_remaining'],
    },
  },
  {
    name: 'propose_google_sync',
    description:
      'Show the student a confirmation card to add deadlines to Google Calendar and/or Google Tasks. Writes NOTHING itself; the student confirms on the card. Use for "put X in my calendar" / "make tasks for ...".',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        deadline_ids: { type: 'array', items: { type: 'string' }, description: 'Deadline ids from get_deadlines' },
        calendar: { type: 'boolean', description: 'Create calendar events (default true)' },
        tasks: { type: 'boolean', description: 'Create Google Tasks (default true)' },
      },
      required: ['deadline_ids'],
    },
  },
];

const ok = (data: unknown): ToolOutput => ({ content: JSON.stringify(data) });
const err = (message: string): ToolOutput => ({ content: JSON.stringify({ error: message }), isError: true });
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function executeTool(name: string, input: Record<string, unknown>, now = new Date()): Promise<ToolOutput> {
  try {
    const data = await getData();
    const settings = await getSettings();
    const cid = typeof input.course_id === 'number' ? input.course_id : undefined;
    const courses = await data.getCourses();
    const courseName = (id: number) => courses.find((c) => c.id === id)?.fullname ?? String(id);

    switch (name) {
      case 'get_courses':
        return ok(courses);

      case 'get_deadlines': {
        const days = typeof input.days_ahead === 'number' ? input.days_ahead : undefined;
        const limit = days == null ? Infinity : now.getTime() + days * 86400_000;
        const list = (await data.getDeadlines())
          .filter((d) => cid == null || d.courseId === cid)
          .filter((d) => {
            const t = new Date(d.due).getTime();
            if (t < now.getTime()) return !d.submitted; // overdue only if unsubmitted
            return t <= limit;
          })
          .sort((a, b) => a.due.localeCompare(b.due))
          .map((d) => ({
            ...d,
            course: courseName(d.courseId),
            overdue: new Date(d.due).getTime() < now.getTime(),
            dueLocal: new Date(d.due).toLocaleString('en-GB', { timeZone: 'Europe/Vienna', dateStyle: 'full', timeStyle: 'short' }),
          }));
        return ok(list);
      }

      case 'get_grades': {
        const items = await data.getGrades(cid);
        const byCourse = new Map<number, typeof items>();
        for (const it of items) byCourse.set(it.courseId, [...(byCourse.get(it.courseId) ?? []), it]);
        const standings = [...byCourse.entries()].map(([id, its]) => {
          const s = courseStanding(its, settings.gradeCutoffs);
          return {
            course_id: id,
            course: courseName(id),
            current_percent: s.currentPercent == null ? null : r1(s.currentPercent),
            current_grade: s.currentGrade,
            current_grade_label: s.currentGrade ? GRADE_LABELS[s.currentGrade].en : null,
            graded_weight_percent: r1(s.gradedWeight * 100),
            remaining_items: s.remaining.map((i) => i.name),
          };
        });
        return ok({
          // item_grade = the Austrian grade of this single item; current_grade in standings = the whole course so far.
          items: items.map((i) => {
            const pct = i.score == null ? null : (i.score / i.maxScore) * 100;
            const g = pct == null ? null : percentToGrade(pct, settings.gradeCutoffs);
            return {
              ...i,
              course: courseName(i.courseId),
              percent: pct == null ? null : r1(pct),
              item_grade: g,
              item_grade_label: g ? GRADE_LABELS[g].en : null,
              class_average_percent: i.classAverage == null ? null : r1((i.classAverage / i.maxScore) * 100),
            };
          }),
          standings,
          cutoffs: settings.gradeCutoffs,
        });
      }

      case 'get_attendance': {
        const recs = await data.getAttendance(cid);
        return ok(
          recs.map((r) => {
            const s = absenceStatus(r, settings.absenceLimit);
            return {
              course_id: r.courseId,
              course: courseName(r.courseId),
              absences: s.absences,
              excused: r.excused ?? 0,
              allowed_absences: s.allowed,
              absences_left: s.left,
              state: s.state,
              sessions_held: r.sessionsHeld,
              total_sessions: r.totalSessions,
              url: r.url,
            };
          }),
        );
      }

      case 'calculate_needed_score': {
        if (cid == null) return err('course_id required');
        const target = input.target_grade as AustrianGrade;
        if (![1, 2, 3, 4].includes(target)) return err('target_grade must be 1-4');
        const items = await data.getGrades(cid);
        const res = neededForGrade(items, target, settings.gradeCutoffs);
        const s = courseStanding(items, settings.gradeCutoffs);
        return ok({
          course: courseName(cid),
          target_grade: target,
          target_label: GRADE_LABELS[target].en,
          target_percent_of_course: res.targetPercent,
          status: res.status, // secured | possible | impossible
          earned_percent_so_far: r1(s.earnedPercent),
          needed_average_percent_on_remaining: Number.isFinite(res.neededPercent) ? r1(res.neededPercent) : null,
          per_item: res.perItem.map((p) => ({
            item: p.item.name,
            needed_points: Number.isFinite(p.neededPoints) ? p.neededPoints : null,
            max_points: p.item.maxScore,
            weight_percent: r1(p.item.weight * 100),
            url: p.item.url,
          })),
        });
      }

      case 'what_if': {
        if (cid == null) return err('course_id required');
        const pct = Number(input.percent_on_remaining);
        if (!Number.isFinite(pct)) return err('percent_on_remaining must be a number');
        const items = await data.getGrades(cid);
        const res = projectedGrade(items, Math.max(0, Math.min(100, pct)), settings.gradeCutoffs);
        return ok({
          course: courseName(cid),
          assumed_percent_on_remaining: pct,
          projected_final_percent: r1(res.finalPercent),
          projected_grade: res.grade,
          projected_grade_label: GRADE_LABELS[res.grade].en,
        });
      }

      case 'propose_google_sync': {
        const ids = Array.isArray(input.deadline_ids) ? (input.deadline_ids as string[]) : [];
        const all = await data.getDeadlines();
        const items: SyncItem[] = ids
          .map((id) => all.find((d) => d.id === id))
          .filter((d): d is NonNullable<typeof d> => !!d)
          .map((deadline) => ({ deadline, course: courses.find((c) => c.id === deadline.courseId) }));
        if (!items.length) return err('No matching deadline ids. Call get_deadlines first.');
        const options: SyncOptions = { calendar: input.calendar !== false, tasks: input.tasks !== false };
        return { content: 'Confirmation card shown to the user.', syncProposal: { items, options } };
      }

      default:
        return err(`Unknown tool ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
