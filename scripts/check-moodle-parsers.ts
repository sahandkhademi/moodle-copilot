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
assert.equal(deadlines.find((d) => d.id === 'mdl-9002')!.submitted, true);
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
