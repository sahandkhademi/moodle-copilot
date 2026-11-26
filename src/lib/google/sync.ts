// Google Calendar + Tasks via Zapier MCP. Contract used by the chat card, the side-panel dashboard and the
// in-Moodle buttons: syncToGoogle() adds, undoGoogle() removes again. Neither ever throws.
//
// Every call from a page (side panel, Moodle tab) is forwarded to the background service worker, which keeps
// ONE warm Zapier connection for all of them, so a click doesn't pay for connecting + listing tools again.
import type { Course, Deadline } from '../types';
import { getItem, KEYS, setItem } from '../storage';
import { getSettings } from '../settings';
import { eventTitle, prewarmZapier, runLiveSync, runLiveUndo, taskTitle, viennaLocal } from './zapier';

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
  /** Google ids returned by Zapier, so Undo can delete exactly these. */
  calendarEventId?: string;
  taskId?: string;
}
export interface SyncedEntry {
  calendar?: boolean;
  tasks?: boolean;
  calendarEventId?: string;
  taskId?: string;
  /** For Undo when no id came back: Zapier finds the item by title + day. */
  eventTitle?: string;
  taskTitle?: string;
  day?: string;
}
export type SyncedMap = Record<string, SyncedEntry>;

export interface UndoResult {
  deadlineId: string;
  ok: boolean;
  error?: string;
}

export async function getSynced(): Promise<SyncedMap> {
  return getItem<SyncedMap>(KEYS.googleSynced, {});
}

/** True in the side panel / content script (page context), false in the background service worker. */
const inPage = () => typeof window !== 'undefined' && typeof chrome !== 'undefined' && !!chrome.runtime?.id;

async function delegate<T>(msg: Record<string, unknown>): Promise<T | null> {
  if (!inPage()) return null;
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as T | undefined;
    return res ?? null;
  } catch {
    return null; // background unavailable (e.g. preview outside the extension): run here instead
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connect to Zapier ahead of time (e.g. when the Moodle Dashboard opens) so the first click is fast. */
export async function prewarmGoogle(): Promise<void> {
  if ((await delegate<{ ok: boolean }>({ type: 'google-prewarm' })) != null) return;
  const { mockMode, zapierMcpUrl } = await getSettings();
  if (!mockMode && zapierMcpUrl) await prewarmZapier().catch(() => {});
}

/** Creates calendar events and/or tasks for the given deadlines. Never throws: failures are per item. */
export async function syncToGoogle(items: SyncItem[], opts: SyncOptions): Promise<SyncResult[]> {
  const viaBg = await delegate<SyncResult[]>({ type: 'google-sync', items, opts });
  if (viaBg) return viaBg;
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
      await sleep(350 + Math.min(todo.length, 8) * 60); // demo: quick fake success, no Zapier tasks spent
      for (const t of todo) {
        const prev = results.get(t.item.deadline.id)!;
        results.set(t.item.deadline.id, { ...prev, calendar: t.calendar ? 'created' : prev.calendar, tasks: t.tasks ? 'created' : prev.tasks, calendarEventId: t.calendar ? `mock-ev-${t.item.deadline.id}` : undefined, taskId: t.tasks ? `mock-task-${t.item.deadline.id}` : undefined });
      }
    } else if (todo.length) {
      // Hard cap: the button must never spin forever.
      const capped = await Promise.race([
        runLiveSync(todo),
        new Promise<SyncResult[]>((resolve) =>
          setTimeout(() => resolve(todo.map((w) => ({ deadlineId: w.item.deadline.id, calendar: w.calendar ? 'failed' : 'skipped', tasks: w.tasks ? 'failed' : 'skipped', error: 'Google sync timed out. Try again.' }))), 75_000),
        ),
      ]);
      for (const r of capped) {
        const prev = results.get(r.deadlineId)!;
        results.set(r.deadlineId, { ...r, calendar: r.calendar === 'skipped' ? prev.calendar : r.calendar, tasks: r.tasks === 'skipped' ? prev.tasks : r.tasks });
      }
    }
    await markSynced([...results.values()], items);
    return items.map((i) => results.get(i.deadline.id)!);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return items.map(({ deadline }) => ({ deadlineId: deadline.id, calendar: opts.calendar ? 'failed' : 'skipped', tasks: opts.tasks ? 'failed' : 'skipped', error }));
  }
}

async function markSynced(results: SyncResult[], items: SyncItem[]) {
  const map = await getSynced();
  for (const r of results) {
    const prev = map[r.deadlineId] ?? {};
    const item = items.find((i) => i.deadline.id === r.deadlineId);
    const cal = prev.calendar || r.calendar === 'created' || r.calendar === 'exists';
    const tsk = prev.tasks || r.tasks === 'created' || r.tasks === 'exists';
    if (!cal && !tsk) continue;
    map[r.deadlineId] = {
      ...prev,
      calendar: cal,
      tasks: tsk,
      calendarEventId: r.calendarEventId ?? prev.calendarEventId,
      taskId: r.taskId ?? prev.taskId,
      eventTitle: prev.eventTitle ?? (item ? eventTitle(item) : undefined),
      taskTitle: prev.taskTitle ?? (item ? taskTitle(item) : undefined),
      day: prev.day ?? (item ? viennaLocal(new Date(item.deadline.due)).slice(0, 10) : undefined),
    };
  }
  await setItem(KEYS.googleSynced, map);
}

/** Removes what Copilot added to Google for these deadlines (event and/or task). Never throws. */
export async function undoGoogle(deadlineIds: string[]): Promise<UndoResult[]> {
  const viaBg = await delegate<UndoResult[]>({ type: 'google-undo', deadlineIds });
  if (viaBg) return viaBg;
  try {
    const map = await getSynced();
    const entries = deadlineIds.filter((id) => map[id]).map((id) => ({ deadlineId: id, entry: map[id]! }));
    const { mockMode } = await getSettings();
    let results: UndoResult[];
    if (mockMode) {
      await sleep(300);
      results = entries.map((e) => ({ deadlineId: e.deadlineId, ok: true }));
    } else {
      results = await Promise.race([
        runLiveUndo(entries),
        new Promise<UndoResult[]>((resolve) => setTimeout(() => resolve(entries.map((e) => ({ deadlineId: e.deadlineId, ok: false, error: 'Undo timed out. Try again.' }))), 60_000)),
      ]);
    }
    const fresh = await getSynced();
    for (const r of results) if (r.ok) delete fresh[r.deadlineId];
    await setItem(KEYS.googleSynced, fresh);
    // Ids that were never synced count as undone.
    const known = new Set(entries.map((e) => e.deadlineId));
    return [...results, ...deadlineIds.filter((id) => !known.has(id)).map((id) => ({ deadlineId: id, ok: true }))];
  } catch (e) {
    return deadlineIds.map((id) => ({ deadlineId: id, ok: false, error: e instanceof Error ? e.message : String(e) }));
  }
}
