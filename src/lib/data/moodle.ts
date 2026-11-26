// Real Moodle data source (plan 1.5): uses the student's existing logged-in browser session.
import type { AttendanceRecord, Course, DataSource, Deadline, GradeItem } from '../types';
import { MoodleClient } from './moodle/client';
import {
  parseAttendanceCmids,
  parseAttendanceCmidsFromContents,
  parseCourses,
  parseDeadlines,
  parseGradeItemsJson,
} from './moodle/parseAjax';
import { parseAttendanceHtml } from './moodle/parseAttendance';
import { parseGradeReportHtml } from './moodle/parseGrades';

export { MoodleAuthError } from './moodle/errors';

const DAY = 86_400;

export function createMoodleSource(rawBaseUrl: string): DataSource {
  const baseUrl = rawBaseUrl.trim().replace(/\/+$/, '');
  const client = new MoodleClient(baseUrl);

  const getCourses = (): Promise<Course[]> =>
    client.cached('courses', async () => {
      const data = await client.callAjax<{ courses: never[] }>('core_course_get_enrolled_courses_by_timeline_classification', {
        classification: 'inprogress',
        limit: 0,
        offset: 0,
        sort: 'fullname',
      });
      return parseCourses(data, baseUrl);
    });

  const getDeadlines = (): Promise<Deadline[]> =>
    client.cached('deadlines', async () => {
      const now = Math.floor(Date.now() / 1000);
      // Moodle returns at most 50 per call (JKU has many Zoom events), so page with aftereventid.
      const events: { id: number }[] = [];
      for (let page = 0; page < 4; page++) {
        const data = await client.callAjax<{ events: { id: number }[] }>('core_calendar_get_action_events_by_timesort', {
          timesortfrom: now - 7 * DAY,
          timesortto: now + 60 * DAY,
          limitnum: 50,
          ...(events.length ? { aftereventid: events[events.length - 1]!.id } : {}),
        });
        events.push(...(data?.events ?? []));
        if ((data?.events ?? []).length < 50) break;
      }
      return parseDeadlines({ events: events as never[] }, baseUrl);
    });

  const gradesOfCourse = (courseId: number): Promise<GradeItem[]> =>
    client.cached(`grades:${courseId}`, async () => {
      try {
        const data = await client.callAjax<{ usergrades?: never[] }>('gradereport_user_get_grade_items', { courseid: courseId, userid: 0 });
        const items = parseGradeItemsJson(data, courseId, baseUrl);
        if (items.length) return items;
      } catch (e) {
        if (e instanceof Error && e.name === 'MoodleAuthError') throw e;
        // Not AJAX-enabled on this Moodle: scrape the report instead.
      }
      const html = await client.getHtml(`/grade/report/user/index.php?id=${courseId}`);
      return parseGradeReportHtml(html, courseId, baseUrl);
    });

  const getGrades = async (courseId?: number): Promise<GradeItem[]> => {
    if (courseId != null) return gradesOfCourse(courseId);
    const courses = await getCourses();
    const all = await Promise.all(courses.map((c) => gradesOfCourse(c.id).catch(() => [] as GradeItem[])));
    return all.flat();
  };

  const attendanceOfCourse = (courseId: number): Promise<AttendanceRecord | null> =>
    client.cached(`attendance:${courseId}`, async () => {
      let cmids: number[] = [];
      try {
        cmids = parseAttendanceCmids(await client.getHtml(`/course/view.php?id=${courseId}`));
      } catch (e) {
        if (e instanceof Error && e.name === 'MoodleAuthError') throw e;
      }
      if (!cmids.length) {
        try {
          const sections = await client.callAjax<never[]>('core_course_get_contents', { courseid: courseId, options: [] });
          cmids = parseAttendanceCmidsFromContents(sections);
        } catch (e) {
          if (e instanceof Error && e.name === 'MoodleAuthError') throw e;
        }
      }
      for (const cmid of cmids) {
        const url = `${baseUrl}/mod/attendance/view.php?id=${cmid}`;
        const html = await client.getHtml(`/mod/attendance/view.php?id=${cmid}&view=5`);
        const rec = parseAttendanceHtml(html, courseId, url);
        if (rec) return rec;
      }
      return null;
    });

  const getAttendance = async (courseId?: number): Promise<AttendanceRecord[]> => {
    const ids = courseId != null ? [courseId] : (await getCourses()).map((c) => c.id);
    const recs = await Promise.all(ids.map((id) => attendanceOfCourse(id).catch((e) => (courseId != null ? Promise.reject(e) : null))));
    return recs.filter((r): r is AttendanceRecord => r !== null);
  };

  return { kind: 'moodle', getCourses, getDeadlines, getGrades, getAttendance };
}
