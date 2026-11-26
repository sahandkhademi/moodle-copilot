// Single entry point for data. Features call getData() and never import mock/moodle directly.
import type { DataSource } from '../types';
import { getSettings } from '../settings';
import { mockSource } from './mock';
import { createMoodleSource } from './moodle';

/** Wraps a source so any failure falls back to mock data. The demo must never show an error screen. */
function withFallback(primary: DataSource): DataSource {
  const wrap =
    <K extends 'getCourses' | 'getDeadlines' | 'getGrades' | 'getAttendance'>(k: K) =>
    async (...args: Parameters<DataSource[K]>) => {
      try {
        return await primary[k](...args);
      } catch (err) {
        console.warn(`[data] ${k} failed on ${primary.kind}, using mock data`, err);
        return mockSource[k](...args);
      }
    };
  return {
    kind: primary.kind,
    getCourses: wrap('getCourses'),
    getDeadlines: wrap('getDeadlines'),
    getGrades: wrap('getGrades'),
    getAttendance: wrap('getAttendance'),
  } as DataSource;
}

export async function getData(): Promise<DataSource> {
  const s = await getSettings();
  if (s.mockMode || !s.moodleUrl) return mockSource;
  return withFallback(createMoodleSource(s.moodleUrl));
}

export { mockSource };
