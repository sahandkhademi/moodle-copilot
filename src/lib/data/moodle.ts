// Real Moodle data source (plan 1.4 + 1.5). Implemented on branch feat/moodle-data.
import type { DataSource } from '../types';

export function createMoodleSource(_baseUrl: string): DataSource {
  const notYet = async (): Promise<never> => {
    throw new Error('Moodle data source not implemented yet');
  };
  return { kind: 'moodle', getCourses: notYet, getDeadlines: notYet, getGrades: notYet, getAttendance: notYet };
}
