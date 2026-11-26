// Google Calendar + Tasks via Zapier MCP (plan 3.x). Implemented on branch feat/google-zapier.
// Contract used by the chat (confirmation card) and the dashboard (one-click buttons).
import type { Course, Deadline } from '../types';
import { getItem, KEYS, setItem } from '../storage';
import { getSettings } from '../settings';

export interface SyncItem {
  deadline: Deadline;
  course?: Course;
}
export interface SyncOptions {
  calendar: boolean;
  tasks: boolean;
}
export type SyncOutcome = 'created' | 'exists' | 'failed' | 'skipped';
export interface SyncResult {
  deadlineId: string;
  calendar: SyncOutcome;
  tasks: SyncOutcome;
  error?: string;
}
export type SyncedMap = Record<string, { calendar?: boolean; tasks?: boolean }>;

export async function getSynced(): Promise<SyncedMap> {
  return getItem<SyncedMap>(KEYS.googleSynced, {});
}

async function markSynced(results: SyncResult[]) {
  const map = await getSynced();
  for (const r of results) {
    const prev = map[r.deadlineId] ?? {};
    map[r.deadlineId] = {
      calendar: prev.calendar || r.calendar === 'created' || r.calendar === 'exists',
      tasks: prev.tasks || r.tasks === 'created' || r.tasks === 'exists',
    };
  }
  await setItem(KEYS.googleSynced, map);
}

/** Creates calendar events and/or tasks for the given deadlines. Never throws: failures are per item. */
export async function syncToGoogle(items: SyncItem[], opts: SyncOptions): Promise<SyncResult[]> {
  const { mockMode } = await getSettings();
  // Stub: mock mode fakes success. The real Zapier path is added on feat/google-zapier.
  await new Promise((r) => setTimeout(r, mockMode ? 900 : 300));
  const synced = await getSynced();
  const results: SyncResult[] = items.map(({ deadline }) => ({
    deadlineId: deadline.id,
    calendar: !opts.calendar ? 'skipped' : synced[deadline.id]?.calendar ? 'exists' : mockMode ? 'created' : 'failed',
    tasks: !opts.tasks ? 'skipped' : synced[deadline.id]?.tasks ? 'exists' : mockMode ? 'created' : 'failed',
    error: mockMode ? undefined : 'Zapier sync not implemented yet',
  }));
  await markSynced(results);
  return results;
}
