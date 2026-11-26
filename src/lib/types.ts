// Shared data model. Every data source (mock or real Moodle) returns these shapes.
// Change only on main, never on a feature branch.

export interface Course {
  id: number;
  shortname: string; // e.g. "LOG"
  fullname: string; // e.g. "Logik"
  url: string; // course page in Moodle
  teacher?: string;
  teacherEmail?: string;
}

export type GradeItemKind = 'test' | 'exam' | 'assignment' | 'quiz' | 'homework' | 'other';

export interface GradeItem {
  id: string;
  courseId: number;
  name: string;
  kind: GradeItemKind;
  /** Points achieved. null = not graded yet (e.g. the final exam still to come). */
  score: number | null;
  maxScore: number;
  /** Share of the course grade, 0..1. All items in a course sum to 1. */
  weight: number;
  gradedAt?: string; // ISO date
  classAverage?: number; // in points, same scale as score
  feedback?: string;
  url?: string;
}

export type SessionStatus = 'present' | 'absent' | 'late' | 'excused';

export interface AttendanceRecord {
  courseId: number;
  /** Sessions planned for the whole semester. */
  totalSessions: number;
  /** Sessions that already happened. */
  sessionsHeld: number;
  /** Unexcused absences so far. */
  absences: number;
  excused?: number;
  /** Max share of totalSessions you may miss, 0..1. Falls back to the settings default. */
  limitPercent?: number;
  sessions?: { date: string; status: SessionStatus }[];
  url?: string;
}

export type DeadlineType = 'assignment' | 'quiz' | 'exam' | 'event';

export interface Deadline {
  id: string; // stable, used for "synced to Google" tracking
  courseId: number;
  title: string;
  type: DeadlineType;
  due: string; // ISO datetime
  url?: string;
  description?: string;
  submitted?: boolean;
  /** Online meeting (Zoom) — shown with the orange meeting icon. */
  meeting?: boolean;
  /** false = Moodle says nothing can be done anymore (e.g. past the cut-off date). Not nagged about. */
  actionable?: boolean;
}

export interface DataSource {
  readonly kind: 'mock' | 'moodle';
  getCourses(): Promise<Course[]>;
  getDeadlines(): Promise<Deadline[]>;
  /** All grade items, or only those of one course. */
  getGrades(courseId?: number): Promise<GradeItem[]>;
  getAttendance(courseId?: number): Promise<AttendanceRecord[]>;
}
