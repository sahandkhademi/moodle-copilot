// @ts-nocheck -- Node-only script (no @types/node in the extension project); run with tsx.
// Runs every Moodle parser against the fixtures. Usage: npx tsx scripts/check-moodle-parsers.ts
// Fixtures are hand-written from knowledge of Moodle 4.x, NOT captured from a real Moodle.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';

// Tiny assert so this script needs no @types/node.
const assert = {
  equal(a: unknown, b: unknown) {
    if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  deepEqual(a: unknown, b: unknown) {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  ok(v: unknown, msg = 'assertion failed') {
    if (!v) throw new Error(msg);
  },
  throws(fn: () => unknown, cls: new (...a: never[]) => Error) {
    try {
      fn();
    } catch (e) {
      if (e instanceof cls) return;
      throw new Error(`Wrong error type: ${e}`);
    }
    throw new Error('Expected a throw');
  },
};

(globalThis as unknown as { DOMParser: unknown }).DOMParser = DOMParser;

const { parseAttendanceCmids, parseCourses, parseDeadlines, parseGradeItemsJson, parseSesskey, unwrapAjax } = await import('../src/lib/data/moodle/parseAjax.ts');
const { parseGradeReportHtml } = await import('../src/lib/data/moodle/parseGrades.ts');
const { parseAttendanceHtml } = await import('../src/lib/data/moodle/parseAttendance.ts');
const { MoodleAuthError } = await import('../src/lib/data/moodle/errors.ts');

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/moodle');
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const json = (f: string) => JSON.parse(read(f));
const BASE = 'https://moodle.example.at';
const show = (title: string, v: unknown) => console.log(`\n== ${title}\n`, JSON.stringify(v, null, 1));

const courses = parseCourses(unwrapAjax(json('ajax-courses.json')), BASE);
show('courses', courses);
assert.equal(courses.length, 3);
assert.equal(courses[0]!.url, `${BASE}/course/view.php?id=101`);

const deadlines = parseDeadlines(unwrapAjax(json('ajax-action-events.json')), BASE);
show('deadlines', deadlines);
assert.equal(deadlines.length, 4);
assert.deepEqual(deadlines.map((d) => d.type).sort(), ['assignment', 'assignment', 'exam', 'quiz']);
// actionable=false does NOT mean submitted (JKU: zoom meetings, closed assignments)
assert.equal(deadlines.find((d) => d.id === 'mdl-9002')!.submitted, undefined);
assert.equal(deadlines.find((d) => d.id === 'mdl-9004')!.url, `${BASE}/mod/assign/view.php?id=2041&action=editsubmission`);

const gradesHtml = parseGradeReportHtml(read('grade-report.de.html'), 101, BASE);
show('grades (HTML)', gradesHtml);
assert.equal(gradesHtml.length, 4); // category + course total skipped
assert.equal(gradesHtml[3]!.score, null);
assert.equal(gradesHtml[0]!.score, 18);
assert.equal(gradesHtml[0]!.maxScore, 20);
assert.equal(gradesHtml[1]!.kind, 'test');
assert.equal(gradesHtml[3]!.kind, 'exam');
assert.ok(Math.abs(gradesHtml.reduce((s, g) => s + g.weight, 0) - 1) < 1e-9);

const gradesJson = parseGradeItemsJson(unwrapAjax(json('ajax-grade-items.json')), 101, BASE);
show('grades (AJAX)', gradesJson);
assert.equal(gradesJson.length, 3);
assert.equal(gradesJson[2]!.score, null);
assert.ok(Math.abs(gradesJson.reduce((s, g) => s + g.weight, 0) - 1) < 1e-9);

const att = parseAttendanceHtml(read('attendance-view.de.html'), 101, `${BASE}/mod/attendance/view.php?id=2099`);
show('attendance', att);
if (!att) throw new Error('attendance not parsed');
assert.equal(att.totalSessions, 7);
assert.equal(att.sessionsHeld, 5);
assert.equal(att.absences, 2);
assert.equal(att.excused, 1);
assert.equal(parseAttendanceHtml('<html><body><p>Nope</p></body></html>', 1), null);

assert.deepEqual(parseAttendanceCmids(read('course-page.html')), [2099]);
assert.equal(parseSesskey(read('course-page.html')), 'aB3dE5fG7h');
assert.throws(() => unwrapAjax(json('ajax-auth-error.json')), MoodleAuthError);

console.log('\nAll parser checks passed (fixtures only, not a real Moodle).');


// ---- JKU formats (checked against the live JKU Moodle, values here are made up) ----
import { splitCourseName, shortLabel, parseDeadlines as pd } from '../src/lib/data/moodle/parseAjax';
import { parseSessionDate } from '../src/lib/data/moodle/parseAttendance';
{
  const a = splitCourseName('338.001/2/4/5/8/22, VL / UE Logic, Jane Doe et al., 2026W');
  assert.equal(a.title, 'VL / UE Logic');
  assert.equal(a.teacher, 'Jane Doe et al.');
  assert.equal(splitCourseName('Plain Course Name').title, 'Plain Course Name');
  assert.equal(shortLabel('VL / UE Logic'), 'LOG');
  assert.equal(shortLabel('KV Current Topics in AI'), 'CTAI');
  assert.equal(shortLabel('KO Mathematics for AI I'), 'MAI1');
  assert.equal(parseSessionDate('Tue 13 Oct 2026 1:45PM - 3:15PM'), '2026-10-13T12:00:00.000Z');
  assert.equal(parseSessionDate('13.10.2026 13:45'), '2026-10-13T12:00:00.000Z');
  const evs = pd({ events: [
    { id: 1, name: 'Sheet 3 is due', activityname: 'Sheet 3', modulename: 'assign', timesort: 1800000000, course: { id: 5 }, action: { actionable: true } },
    { id: 2, name: 'Practice Quiz closes', modulename: 'quiz', timesort: 1800000100, course: { id: 5 } },
    { id: 3, name: 'M-2026W: Quiz Monday 18:45', activityname: 'M-2026W: Quiz Monday 18:45', modulename: 'zoom', timesort: 1800000200, course: { id: 5 }, action: { actionable: false } },
  ] as never[] }, 'https://moodle.example');
  assert.equal(evs[0]!.title, 'Sheet 3');
  assert.equal(evs[1]!.title, 'Practice Quiz');
  assert.equal(evs[1]!.type, 'quiz');
  assert.equal(evs[2]!.meeting, true);
  assert.equal(evs[2]!.type, 'event');
  const dup = parseCourses({ courses: [
    { id: 1, fullname: '326.600, VL / UE Mathematics for AI I, Jane Doe et al., 2026W' },
    { id: 2, fullname: '531.955, KO Mathematics for AI I, John Roe, 2026W' },
  ] } as never, 'https://moodle.example');
  assert.equal(dup[0]!.shortname, 'UE MAI1');
  assert.equal(dup[1]!.shortname, 'KO MAI1');
  console.log('JKU format checks passed');
}
