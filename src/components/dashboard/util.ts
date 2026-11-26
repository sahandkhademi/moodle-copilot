import type { Deadline, DeadlineType } from '@/lib/types';

/** English number format. */
export const num = (n: number, digits = 1) => n.toLocaleString('en-US', { maximumFractionDigits: digits });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export const dayDiff = (due: Date, now: Date) => Math.round((startOfDay(due) - startOfDay(now)) / 86400000);

/** "Thursday, 26 November 2026" (Moodle date heading). */
export function dateHeading(iso: string): string {
  const d = new Date(iso);
  const wd = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const rest = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${wd}, ${rest}`;
}
/** "07:00" */
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "VL / UE Logic" -> "Logic" for compact alerts. */
export const shortCourse = (fullname: string) => fullname.replace(/^(?:(?:VL|UE|KV|SE|PS|VU|IK)\s*\/?\s*)+/, '').trim() || fullname;

export type RangeFilter = 'all' | 'overdue' | '7d' | '30d' | '3m' | '6m';
export const RANGE_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: '7d', label: 'Next 7 days' },
  { value: '30d', label: 'Next 30 days' },
  { value: '3m', label: 'Next 3 months' },
  { value: '6m', label: 'Next 6 months' },
];
const RANGE_DAYS: Record<Exclude<RangeFilter, 'all' | 'overdue'>, number> = { '7d': 7, '30d': 30, '3m': 92, '6m': 183 };

export const isOverdue = (d: Deadline, now: Date) => new Date(d.due).getTime() < now.getTime();

export function inRange(d: Deadline, range: RangeFilter, now: Date): boolean {
  if (range === 'all') return true;
  if (range === 'overdue') return isOverdue(d, now);
  if (isOverdue(d, now)) return true; // Moodle keeps overdue items in the "Next X" views
  return dayDiff(new Date(d.due), now) <= RANGE_DAYS[range];
}

export const TYPE_LABEL: Record<DeadlineType, string> = { assignment: 'Assignment', quiz: 'Quiz', exam: 'Exam', event: 'Event' };

export function subtitle(d: Deadline, course?: string): string {
  const what = d.meeting
    ? 'Zoom meeting requires action'
    : d.type === 'assignment'
      ? 'Assignment is due'
      : d.type === 'quiz'
        ? 'Quiz closes'
        : d.type === 'exam'
          ? 'Exam'
          : 'Event';
  return course ? `${what} · ${course}` : what;
}

export function actionLabel(d: Deadline): string {
  if (d.meeting) return 'Join meeting';
  if (d.type === 'assignment') return 'Add submission';
  if (d.type === 'quiz') return 'Attempt quiz now';
  return 'View';
}
