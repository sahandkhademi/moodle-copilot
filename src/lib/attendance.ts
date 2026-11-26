// Absence limit math (feature 4.2). Pure functions.
import type { AttendanceRecord } from './types';

export type AbsenceState = 'safe' | 'warning' | 'over';

export interface AbsenceStatus {
  courseId: number;
  absences: number;
  /** Max absences allowed over the semester. */
  allowed: number;
  /** How many more you may miss. 0 = at the limit, one more fails. Negative = over. */
  left: number;
  state: AbsenceState;
  limitPercent: number;
}

export function absenceStatus(rec: AttendanceRecord, defaultLimit: number): AbsenceStatus {
  const limitPercent = rec.limitPercent ?? defaultLimit;
  const allowed = Math.floor(rec.totalSessions * limitPercent);
  const left = allowed - rec.absences;
  const state: AbsenceState = left < 0 ? 'over' : left <= 2 ? 'warning' : 'safe';
  return { courseId: rec.courseId, absences: rec.absences, allowed, left, state, limitPercent };
}

