// Seeded demo data (plan 1.3 + 6.2). Dates are relative to "now" so the demo is always fresh.
// Story: Logic's last test went so-so, the final is still to come, Logic is at the absence warning,
// 3 deadlines this week, and one grade is queued for the "new grade" notification.
import type { AttendanceRecord, Course, DataSource, Deadline, GradeItem } from '../types';
import { getItem, KEYS } from '../storage';

const MOODLE = 'https://moodle.jku.at';

function at(daysFromNow: number, hour = 23, minute = 59): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const MOCK_COURSES: Course[] = [
  { id: 101, shortname: 'LOG', fullname: 'VL / UE Logic', url: `${MOODLE}/course/view.php?id=101`, teacher: 'Dr. Eva Huber', teacherEmail: 'eva.huber@example.org' },
  { id: 102, shortname: 'LA', fullname: 'VL / UE Linear Algebra', url: `${MOODLE}/course/view.php?id=102`, teacher: 'Mag. Thomas Berger', teacherEmail: 'thomas.berger@example.org' },
  { id: 103, shortname: 'PRG2', fullname: 'VL / UE Programming 2', url: `${MOODLE}/course/view.php?id=103`, teacher: 'DI Lukas Wagner', teacherEmail: 'lukas.wagner@example.org' },
  { id: 104, shortname: 'DBS', fullname: 'VL / UE Database Systems', url: `${MOODLE}/course/view.php?id=104`, teacher: 'Dr. Sarah Gruber', teacherEmail: 'sarah.gruber@example.org' },
  { id: 105, shortname: 'ENG', fullname: 'KV Technical English', url: `${MOODLE}/course/view.php?id=105`, teacher: 'Emma Clarke, MA', teacherEmail: 'emma.clarke@example.org' },
];

const g = (courseId: number, id: string) => `${MOODLE}/grade/report/user/index.php?id=${courseId}#${id}`;

export const MOCK_GRADES: GradeItem[] = [
  // Logic — current 70 % (a 3). Needs ~85 % on the final for a 2; a 1 is out of reach.
  { id: 'log-hw', courseId: 101, name: 'Homework', kind: 'homework', score: 18, maxScore: 20, weight: 0.1, gradedAt: at(-30, 12, 0), classAverage: 15.5, url: g(101, 'log-hw') },
  { id: 'log-t1', courseId: 101, name: 'Test 1: Propositional logic', kind: 'test', score: 28, maxScore: 40, weight: 0.25, gradedAt: at(-24, 12, 0), classAverage: 26.1, url: g(101, 'log-t1') },
  { id: 'log-t2', courseId: 101, name: 'Test 2: Predicate logic', kind: 'test', score: 31, maxScore: 50, weight: 0.25, gradedAt: at(-3, 16, 30), classAverage: 34.2, feedback: 'Good approach on the proofs, but mistakes when moving quantifiers (tasks 3 and 4).', url: g(101, 'log-t2') },
  { id: 'log-final', courseId: 101, name: 'Final exam', kind: 'exam', score: null, maxScore: 50, weight: 0.4, url: g(101, 'log-final') },

  // Linear Algebra — doing well.
  { id: 'mat-t1', courseId: 102, name: 'Test 1: Vector spaces', kind: 'test', score: 44, maxScore: 50, weight: 0.3, gradedAt: at(-20, 12, 0), classAverage: 35.8, url: g(102, 'mat-t1') },
  { id: 'mat-hw', courseId: 102, name: 'Exercise sheets', kind: 'homework', score: 27, maxScore: 30, weight: 0.2, gradedAt: at(-6, 12, 0), classAverage: 22.4, url: g(102, 'mat-hw') },
  { id: 'mat-t2', courseId: 102, name: 'Test 2: Eigenvalues', kind: 'test', score: null, maxScore: 50, weight: 0.5, url: g(102, 'mat-t2') },

  // Programming 2 — strong.
  { id: 'prg-p1', courseId: 103, name: 'Project 1: CLI tool', kind: 'assignment', score: 46, maxScore: 50, weight: 0.3, gradedAt: at(-15, 12, 0), classAverage: 39.0, url: g(103, 'prg-p1') },
  { id: 'prg-q', courseId: 103, name: 'Quiz: Generics', kind: 'quiz', score: 9, maxScore: 10, weight: 0.1, gradedAt: at(-8, 12, 0), classAverage: 7.2, url: g(103, 'prg-q') },
  { id: 'prg-p2', courseId: 103, name: 'Project 2: REST API', kind: 'assignment', score: null, maxScore: 50, weight: 0.3, url: g(103, 'prg-p2') },
  { id: 'prg-exam', courseId: 103, name: 'Exam', kind: 'exam', score: null, maxScore: 60, weight: 0.3, url: g(103, 'prg-exam') },

  // Database Systems — Exercise 3 is still ungraded (gets graded by the demo notification).
  { id: 'dbs-u1', courseId: 104, name: 'Exercise 1: ER model', kind: 'homework', score: 17, maxScore: 20, weight: 0.15, gradedAt: at(-21, 12, 0), classAverage: 15.1, url: g(104, 'dbs-u1') },
  { id: 'dbs-u2', courseId: 104, name: 'Exercise 2: SQL queries', kind: 'homework', score: 15, maxScore: 20, weight: 0.15, gradedAt: at(-10, 12, 0), classAverage: 14.3, url: g(104, 'dbs-u2') },
  { id: 'dbs-exam', courseId: 104, name: 'Exam', kind: 'exam', score: null, maxScore: 60, weight: 0.55, url: g(104, 'dbs-exam') },

  // Technical English
  { id: 'eng-pres', courseId: 105, name: 'Presentation', kind: 'assignment', score: 22, maxScore: 25, weight: 0.4, gradedAt: at(-12, 12, 0), classAverage: 19.6, url: g(105, 'eng-pres') },
  { id: 'eng-essay', courseId: 105, name: 'Essay: AI in Industry', kind: 'assignment', score: null, maxScore: 25, weight: 0.6, url: g(105, 'eng-essay') },
];

/** The grade the demo's "simulate new grade" button reveals (plan 4.4). */
export const MOCK_QUEUED_GRADE: GradeItem = {
  id: 'dbs-u3',
  courseId: 104,
  name: 'Exercise 3: Normal forms',
  kind: 'homework',
  score: 18,
  maxScore: 20,
  weight: 0.15,
  gradedAt: new Date().toISOString(),
  classAverage: 14.9,
  feedback: 'Very clean decomposition into 3NF.',
  url: g(104, 'dbs-u3'),
};

export const MOCK_ATTENDANCE: AttendanceRecord[] = [
  // Logic: 15 sessions, 20 % limit → 3 allowed, 2 used → 1 left → 🟠
  { courseId: 101, totalSessions: 15, sessionsHeld: 10, absences: 2, excused: 1, url: `${MOODLE}/mod/attendance/view.php?id=1101` },
  { courseId: 102, totalSessions: 28, sessionsHeld: 19, absences: 1, url: `${MOODLE}/mod/attendance/view.php?id=1102` },
  { courseId: 103, totalSessions: 30, sessionsHeld: 20, absences: 2, url: `${MOODLE}/mod/attendance/view.php?id=1103` },
  { courseId: 104, totalSessions: 28, sessionsHeld: 18, absences: 0, url: `${MOODLE}/mod/attendance/view.php?id=1104` },
  { courseId: 105, totalSessions: 28, sessionsHeld: 18, absences: 1, url: `${MOODLE}/mod/attendance/view.php?id=1105` },
];

export const MOCK_DEADLINES: Deadline[] = [
  // Overdue
  { id: 'dl-eng-draft', courseId: 105, title: 'Essay outline (draft)', type: 'assignment', due: at(-1, 23, 59), url: `${MOODLE}/mod/assign/view.php?id=2001`, submitted: false, description: 'Upload a one-page outline of your essay.' },
  // Today
  { id: 'dl-mat-blatt6', courseId: 102, title: 'Sheet 6 — scan upload', type: 'assignment', due: at(0, 23, 59), url: `${MOODLE}/mod/assign/view.php?id=2002`, description: 'Tasks 6.1–6.5 as one PDF.' },
  // Tomorrow
  { id: 'dl-log-zoom', courseId: 101, title: 'Logic: Q&A session before the final', type: 'event', meeting: true, due: at(1, 18, 45), url: `${MOODLE}/mod/zoom/view.php?id=2010`, description: 'Zoom meeting' },
  // This week (3)
  { id: 'dl-dbs-u4', courseId: 104, title: 'Exercise 4: Transactions', type: 'assignment', due: at(2, 23, 59), url: `${MOODLE}/mod/assign/view.php?id=2003`, description: 'ACID, isolation levels, one example in SQL.' },
  { id: 'dl-prg-quiz', courseId: 103, title: 'Quiz: Streams & Lambdas', type: 'quiz', due: at(3, 18, 0), url: `${MOODLE}/mod/quiz/view.php?id=2004` },
  { id: 'dl-log-hu7', courseId: 101, title: 'Homework 7: Resolution', type: 'assignment', due: at(4, 23, 59), url: `${MOODLE}/mod/assign/view.php?id=2005`, description: 'Resolution proofs for tasks 1–4.' },
  // Later
  { id: 'dl-prg-p2', courseId: 103, title: 'Project 2: REST API submission', type: 'assignment', due: at(9, 23, 59), url: `${MOODLE}/mod/assign/view.php?id=2006`, description: 'Repo link + short video (max. 3 min).' },
  { id: 'dl-mat-t2', courseId: 102, title: 'Test 2: Eigenvalues', type: 'exam', due: at(11, 9, 0), url: `${MOODLE}/mod/quiz/view.php?id=2007` },
  { id: 'dl-eng-essay', courseId: 105, title: 'Essay: AI in Industry', type: 'assignment', due: at(13, 23, 59), url: `${MOODLE}/mod/assign/view.php?id=2008`, description: '1500 words, APA citations.' },
  { id: 'dl-log-final', courseId: 101, title: 'Logic final exam', type: 'exam', due: at(16, 10, 0), url: `${MOODLE}/course/view.php?id=101`, description: 'HS 2, 90 minutes, one handwritten A4 sheet allowed.' },
  { id: 'dl-dbs-exam', courseId: 104, title: 'Database Systems exam', type: 'exam', due: at(19, 13, 0), url: `${MOODLE}/course/view.php?id=104` },
  { id: 'dl-prg-exam', courseId: 103, title: 'Programming 2 exam', type: 'exam', due: at(21, 9, 0), url: `${MOODLE}/course/view.php?id=103` },
];

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

export const mockSource: DataSource = {
  kind: 'mock',
  async getCourses() {
    await delay();
    return MOCK_COURSES;
  },
  async getDeadlines() {
    await delay();
    return [...MOCK_DEADLINES].sort((a, b) => a.due.localeCompare(b.due));
  },
  async getGrades(courseId?: number) {
    await delay();
    const extra = await getItem<GradeItem[]>(KEYS.mockExtraGrades, []);
    // A revealed grade replaces nothing; it's a new item (Übung 3). Re-balance DBS weights if present.
    let all = [...MOCK_GRADES, ...extra];
    if (extra.some((e) => e.id === MOCK_QUEUED_GRADE.id)) {
      all = all.map((it) => (it.id === 'dbs-exam' ? { ...it, weight: 0.55 } : it));
    } else {
      all = all.map((it) => (it.id === 'dbs-exam' ? { ...it, weight: 0.7 } : it));
    }
    return courseId == null ? all : all.filter((it) => it.courseId === courseId);
  },
  async getAttendance(courseId?: number) {
    await delay();
    return courseId == null ? MOCK_ATTENDANCE : MOCK_ATTENDANCE.filter((r) => r.courseId === courseId);
  },
};
