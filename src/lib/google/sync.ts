// Google Calendar + Tasks via Zapier MCP (plan 3.x). Implemented on branch feat/google-zapier.
// Contract used by the chat (confirmation card) and the dashboard (one-click buttons).
import type { Course, Deadline } from '../types';
import { getItem, KEYS, setItem } from '../storage';
import { getSettings } from '../settings';
import { runLiveSync } from './zapier';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Creates calendar events and/or tasks for the given deadlines. Never throws: failures are per item. */
export async function syncToGoogle(items: SyncItem[], opts: SyncOptions): Promise<SyncResult[]> {
  try {
    const { mockMode } = await getSettings();
    const synced = await getSynced();
    const results = new Map<string, SyncResult>();
    const todo: { item: SyncItem; calendar: boolean; tasks: boolean }[] = [];
    for (const item of items) {
      const id = item.deadline.id;
      if (results.has(id)) continue;
      const wantCal = opts.calendar && !synced[id]?.calendar;
      const wantTasks = opts.tasks && !synced[id]?.tasks;
      if (wantCal || wantTasks) todo.push({ item, calendar: wantCal, tasks: wantTasks });
      results.set(id, {
        deadlineId: id,
        calendar: !opts.calendar ? 'skipped' : synced[id]?.calendar ? 'exists' : 'skipped',
        tasks: !opts.tasks ? 'skipped' : synced[id]?.tasks ? 'exists' : 'skipped',
      });
    }
    if (mockMode) {
      // Staggered fake success so the demo animation looks real; spends no Zapier tasks.
      await sleep(700 + Math.min(todo.length, 8) * 250);
      for (const t of todo) {
        const prev = results.get(t.item.deadline.id)!;
        results.set(t.item.deadline.id, {
          deadlineId: prev.deadlineId,
          calendar: t.calendar ? 'created' : prev.calendar,
          tasks: t.tasks ? 'created' : prev.tasks,
        });
      }
    } else if (todo.length) {
      for (const r of await runLiveSync(todo)) {
        const prev = results.get(r.deadlineId)!;
        results.set(r.deadlineId, {
          deadlineId: r.deadlineId,
          calendar: r.calendar === 'skipped' ? prev.calendar : r.calendar,
          tasks: r.tasks === 'skipped' ? prev.tasks : r.tasks,
          error: r.error,
        });
      }
    }
    await markSynced([...results.values()]);
    return items.map((i) => results.get(i.deadline.id)!);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return items.map(({ deadline }) => ({
      deadlineId: deadline.id,
      calendar: opts.calendar ? 'failed' : 'skipped',
      tasks: opts.tasks ? 'failed' : 'skipped',
      error,
    }));
  }
}
