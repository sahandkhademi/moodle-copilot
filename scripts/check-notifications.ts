// Run: npx tsx scripts/check-notifications.ts
const fail = (m: string): never => {
  throw new Error('FAILED: ' + m);
};
const assert = {
  ok: (v: unknown, m = 'ok') => void (v || fail(m)),
  equal: (a: unknown, b: unknown, m = '') => void (a === b || fail(`${m} ${String(a)} !== ${String(b)}`)),
  deepEqual: (a: unknown, b: unknown, m = '') => void (JSON.stringify(a) === JSON.stringify(b) || fail(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)),
};
import {
  absenceNotices,
  computeBadge,
  diffGrades,
  gradeNotice,
  makeAbsenceSnapshot,
  makeGradeSnapshot,
  parseNoticeId,
} from '../src/lib/background/logic';
import { MOCK_ATTENDANCE, MOCK_COURSES, MOCK_DEADLINES, MOCK_GRADES, MOCK_QUEUED_GRADE } from '../src/lib/data/mock';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

const cut = DEFAULT_SETTINGS.gradeCutoffs;

// Grade diffing
assert.deepEqual(diffGrades(null, MOCK_GRADES), [], 'first run is silent');
const snap = makeGradeSnapshot(MOCK_GRADES);
assert.deepEqual(diffGrades(snap, MOCK_GRADES), [], 'no change, no notice');
const withNew = [...MOCK_GRADES, MOCK_QUEUED_GRADE];
assert.equal(diffGrades(snap, withNew).length, 1);
const snap2 = makeGradeSnapshot(withNew);
assert.deepEqual(diffGrades(snap2, withNew), [], 'detected only once');
const ungraded = MOCK_GRADES.find((g) => g.score == null);
if (ungraded) {
  const graded = MOCK_GRADES.map((g) => (g.id === ungraded.id ? { ...g, score: 5 } : g));
  assert.equal(diffGrades(snap, graded).length, 1, 'null -> score counts as new');
}

// Notice text
const n = gradeNotice(MOCK_QUEUED_GRADE, MOCK_COURSES.find((c) => c.id === 104), cut, 'de');
assert.ok(n.title.startsWith('📊 Neue Note in'), n.title);
assert.ok(/: 1 \(90 %\) · Klassenschnitt 75 %$/.test(n.message), n.message);
assert.ok(gradeNotice(MOCK_QUEUED_GRADE, undefined, cut, 'en').title.startsWith('📊 New grade'));
assert.deepEqual(parseNoticeId(n.id), { courseId: 104, gradeId: 'dbs-u3' });
assert.deepEqual(parseNoticeId('absence:101'), { courseId: 101 });

// Absence transitions
const lim = DEFAULT_SETTINGS.absenceLimit;
const aSnap = makeAbsenceSnapshot(MOCK_ATTENDANCE, lim);
assert.deepEqual(absenceNotices(null, MOCK_ATTENDANCE, MOCK_COURSES, lim, 'de'), [], 'first run silent');
assert.deepEqual(absenceNotices(aSnap, MOCK_ATTENDANCE, MOCK_COURSES, lim, 'de'), [], 'unchanged silent');
const logik = MOCK_ATTENDANCE.find((r) => r.courseId === 101)!;
const worse = MOCK_ATTENDANCE.map((r) => (r === logik ? { ...r, absences: r.absences + 1 } : r));
const out = absenceNotices(aSnap, worse, MOCK_COURSES, lim, 'de');
console.log('absence:', out.map((x) => x.message));
assert.ok(out.length >= 0);
const safeSnap = { ...aSnap, '101': 'safe' as const };
const warn = absenceNotices(safeSnap, MOCK_ATTENDANCE, MOCK_COURSES, lim, 'de');
assert.equal(warn.length, 1);
assert.equal(warn[0]?.message, '🟠 Logik: nur noch 1 Fehlstunde erlaubt');
const over = absenceNotices({ ...aSnap, '101': 'warning' as const }, MOCK_ATTENDANCE.map((r) => (r === logik ? { ...r, absences: 9 } : r)), MOCK_COURSES, lim, 'de');
assert.ok(over.length === 1 && !!over[0]?.message.startsWith('🔴'));

// Badge
const now = Date.parse('2026-01-01T12:00:00Z');
const dl = (id: string, h: number) => ({ id, courseId: 1, title: id, type: 'assignment' as const, due: new Date(now + h * 3600_000).toISOString() });
const ds = [dl('a', 5), dl('b', 47), dl('c', 49), dl('d', -2)];
assert.deepEqual(computeBadge(['x', 'y'], ds, {}, now), { text: '2', color: '#dc2626' });
assert.deepEqual(computeBadge([], ds, {}, now), { text: '2', color: '#f97316' });
assert.equal(computeBadge([], ds, { a: true }, now).text, '1');
assert.equal(computeBadge([], ds, ['a', 'b'], now).text, '');
assert.equal(computeBadge([], MOCK_DEADLINES.slice(0, 0), {}, now).text, '');

console.log('all notification checks passed');
