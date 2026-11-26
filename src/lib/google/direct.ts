// Fast path: call the Zapier Calendar / Tasks tools DIRECTLY, all items in parallel, no LLM in between.
// One listTools + N parallel tool calls instead of a multi-round Gemini ↔ Zapier conversation.
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { SyncedEntry, SyncOutcome, SyncResult, UndoResult } from './sync';
import { detailsText, dueText, eventColorId, eventTitle, eventWindow, taskTitle, TIMEZONE, viennaLocal, type Work } from './zapier';
import type { McpToolInfo } from './mcpTools';

export const CALL_TIMEOUT_MS = 40_000;

type Props = Record<string, { type?: string | string[]; description?: string }>;

export interface DirectTools {
  calendar?: McpToolInfo;
  tasks?: McpToolInfo;
}

/** Zapier names look like "google_calendar_create_detailed_event" and "google_tasks_create_task". */
export function pickTools(tools: McpToolInfo[]): DirectTools {
  const byName = (re: RegExp) => tools.filter((t) => re.test(t.name));
  const cal = byName(/calendar/i).filter((t) => /create|add|quick/i.test(t.name) && /event/i.test(t.name));
  const calendar = cal.find((t) => /detailed/i.test(t.name)) ?? cal.find((t) => !/quick/i.test(t.name)) ?? cal[0];
  const tasks = byName(/task/i).find((t) => /create|add/i.test(t.name) && !/list/i.test(t.name));
  return { calendar, tasks };
}

function props(tool: McpToolInfo): Props {
  return ((tool.inputSchema as { properties?: Props } | undefined)?.properties ?? {}) as Props;
}

/** First property name (as the tool spells it) that matches one of the patterns. */
function field(p: Props, ...patterns: RegExp[]): string | undefined {
  const keys = Object.keys(p);
  for (const re of patterns) {
    const k = keys.find((key) => re.test(key));
    if (k) return k;
  }
  return undefined;
}

const offsetIso = (d: Date) => {
  // "2026-11-30T23:29:00" in Vienna wall-clock; the tool gets the timezone separately where it has a field for it.
  return viennaLocal(d).replace(' ', 'T') + ':00';
};

export function calendarArgs(tool: McpToolInfo, w: Work): Record<string, unknown> {
  const p = props(tool);
  const { start, end } = eventWindow(w.item);
  const title = eventTitle(w.item);
  const desc = detailsText(w.item);
  const args: Record<string, unknown> = {};
  const set = (k: string | undefined, v: unknown) => {
    if (k && v != null && v !== '') args[k] = v;
  };
  set(
    field(p, /^instructions$/i),
    `Create a Google Calendar event "${title}" from ${viennaLocal(start)} to ${viennaLocal(end)} (${TIMEZONE}) in the primary calendar, ` +
      `colored red (Tomato, colorId ${eventColorId(w.item)}), with a popup reminder 1 day before and 1 hour before. ` +
      `It marks the moment the item is due (${dueText(w.item)}). Use this description exactly:\n${desc}`,
  );
  set(field(p, /^summary$/i, /title/i, /^name$/i), title);
  set(field(p, /^start(__)?date_?time$/i, /^start__dateTime$/, /^start(_time)?$/i, /start/i), offsetIso(start));
  set(field(p, /^end(__)?date_?time$/i, /^end__dateTime$/, /^end(_time)?$/i, /end/i), offsetIso(end));
  set(field(p, /time_?zone/i), TIMEZONE);
  set(field(p, /^description$/i, /notes?/i, /details/i), desc);
  set(field(p, /color/i), eventColorId(w.item));
  set(field(p, /^location$/i), w.item.deadline.url);
  set(field(p, /^all_?day$/i), false);
  return args;
}

export function taskArgs(tool: McpToolInfo, w: Work): Record<string, unknown> {
  const p = props(tool);
  const title = taskTitle(w.item);
  const due = viennaLocal(new Date(w.item.deadline.due)).slice(0, 10);
  const notes = detailsText(w.item);
  const args: Record<string, unknown> = {};
  const set = (k: string | undefined, v: unknown) => {
    if (k && v != null && v !== '') args[k] = v;
  };
  set(field(p, /^instructions$/i), `Create a Google Task "${title}" due ${due} in the default list. Use these notes exactly:\n${notes}`);
  set(field(p, /^title$/i, /title/i, /^name$/i), title);
  set(field(p, /^due/i, /date/i), due);
  set(field(p, /^notes?$/i, /description/i), notes);
  return args;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Finds the created item's id in Zapier's reply (JSON like {"results":[{"id":"…"}]} or similar). */
export function extractId(text: string): string | undefined {
  try {
    const find = (v: unknown, depth = 0): string | undefined => {
      if (!v || typeof v !== 'object' || depth > 5) return undefined;
      if (Array.isArray(v)) {
        for (const x of v) {
          const r = find(x, depth + 1);
          if (r) return r;
        }
        return undefined;
      }
      const o = v as Record<string, unknown>;
      if (typeof o.id === 'string' && o.id.length >= 6) return o.id;
      for (const k of ['results', 'result', 'data', 'event', 'task', 'output']) {
        const r = find(o[k], depth + 1);
        if (r) return r;
      }
      return undefined;
    };
    const parsed = find(JSON.parse(text));
    if (parsed) return parsed;
  } catch {
    /* not JSON */
  }
  return text.match(/"id"\s*:\s*"([A-Za-z0-9_\-@.]{6,})"/)?.[1];
}

async function call(mcp: Client, tool: McpToolInfo, args: Record<string, unknown>): Promise<{ ok: boolean; error?: string; id?: string }> {
  try {
    const out = await withTimeout(mcp.callTool({ name: tool.name, arguments: args }), CALL_TIMEOUT_MS, tool.name);
    const text = ((out.content as { text?: string }[] | undefined) ?? []).map((c) => c.text ?? '').join(' ');
    // Zapier reports problems either as isError or as a JSON body with an error/"status":"error".
    if (out.isError || /"(error|errors)"\s*:|"status"\s*:\s*"(error|failed)"/i.test(text)) return { ok: false, error: text.slice(0, 160) || 'Zapier error' };
    return { ok: true, id: extractId(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs every Calendar + Tasks call at once. Returns null if the needed tools aren't on the server (→ caller falls back). */
export async function directSync(mcp: Client, tools: McpToolInfo[], work: Work[]): Promise<SyncResult[] | null> {
  const { calendar, tasks } = pickTools(tools);
  if ((work.some((w) => w.calendar) && !calendar) || (work.some((w) => w.tasks) && !tasks)) return null;
  return Promise.all(
    work.map(async (w): Promise<SyncResult> => {
      const [cal, tsk] = await Promise.all([
        w.calendar && calendar ? call(mcp, calendar, calendarArgs(calendar, w)) : Promise.resolve(null),
        w.tasks && tasks ? call(mcp, tasks, taskArgs(tasks, w)) : Promise.resolve(null),
      ]);
      const outcome = (r: { ok: boolean } | null): SyncOutcome => (r == null ? 'skipped' : r.ok ? 'created' : 'failed');
      const error = [cal?.error, tsk?.error].filter(Boolean).join(' · ') || undefined;
      return { deadlineId: w.item.deadline.id, calendar: outcome(cal), tasks: outcome(tsk), error, calendarEventId: cal?.id, taskId: tsk?.id };
    }),
  );
}

// ---------------------------------------------------------------- Undo

/** Zapier: "google_calendar_delete_event", "google_tasks_delete_task" (or an update/complete action as a fallback). */
export function pickUndoTools(tools: McpToolInfo[]): { calendar?: McpToolInfo; tasks?: McpToolInfo; tasksComplete?: McpToolInfo } {
  const cal = tools.find((t) => /calendar/i.test(t.name) && /delete|remove|cancel/i.test(t.name) && /event/i.test(t.name));
  const tasks = tools.find((t) => /task/i.test(t.name) && /delete|remove/i.test(t.name) && !/list/i.test(t.name));
  const tasksComplete = tools.find((t) => /task/i.test(t.name) && /complete|update/i.test(t.name) && !/list/i.test(t.name));
  return { calendar: cal, tasks, tasksComplete };
}

function undoArgs(tool: McpToolInfo, kind: 'event' | 'task' | 'complete', e: SyncedEntry): Record<string, unknown> {
  const p = props(tool);
  const args: Record<string, unknown> = {};
  const set = (k: string | undefined, v: unknown) => {
    if (k && v != null && v !== '') args[k] = v;
  };
  const id = kind === 'event' ? e.calendarEventId : e.taskId;
  const main = kind === 'event' ? e.eventTitle : e.taskTitle;
  const title = e.legacyTitle && !id ? `${main}" (or the older title "${e.legacyTitle}")` : `${main}"`;
  const what =
    kind === 'event'
      ? `Delete the Google Calendar event ${id ? `with id ${id}` : ''} titled "${title} on ${e.day} from the primary calendar.`
      : kind === 'task'
        ? `Delete the Google Task ${id ? `with id ${id}` : ''} titled "${title} (due ${e.day}) from the default list.`
        : `Mark the Google Task ${id ? `with id ${id}` : ''} titled "${title} (due ${e.day}) as completed.`;
  set(field(p, /^instructions$/i), what.replace(/\s+/g, ' '));
  set(field(p, /^(event_?id|eventid)$/i, /event.*id/i, kind === 'event' ? /^id$/i : /^$/), kind === 'event' ? id : undefined);
  set(field(p, /^(task_?id|taskid)$/i, /^task$/i, kind !== 'event' ? /^id$/i : /^$/), kind !== 'event' ? id : undefined);
  if (kind === 'event') set(field(p, /^calendar(_?id)?$/i), 'primary');
  if (kind === 'complete') set(field(p, /^status$/i), 'completed');
  return args;
}

/** A delete that fails because the item no longer exists counts as removed. */
const GONE = /not\s*found|404|410|resource has been deleted|already deleted|does not exist|no (such )?(event|task)/i;

/** Removes the event and/or task of each entry, all in parallel. Reports each part separately. */
export async function directUndo(mcp: Client, tools: McpToolInfo[], entries: { deadlineId: string; entry: SyncedEntry }[]): Promise<UndoResult[]> {
  const { calendar, tasks, tasksComplete } = pickUndoTools(tools);
  const run = async (job: Promise<{ ok: boolean; error?: string }>) => {
    const r = await job;
    return r.ok || GONE.test(r.error ?? '') ? { ok: true } : r;
  };
  return Promise.all(
    entries.map(async ({ deadlineId, entry }): Promise<UndoResult> => {
      const [cal, tsk] = await Promise.all([
        entry.calendar
          ? calendar
            ? run(call(mcp, calendar, undoArgs(calendar, 'event', entry)))
            : Promise.resolve({ ok: false, error: 'Turn on the "Google Calendar: Delete Event" action in Zapier to undo.' })
          : null,
        entry.tasks
          ? tasks ?? tasksComplete
            ? run(call(mcp, (tasks ?? tasksComplete)!, undoArgs((tasks ?? tasksComplete)!, tasks ? 'task' : 'complete', entry)))
            : Promise.resolve({ ok: false, error: 'Turn on the "Google Tasks: Delete Task" (or "Update Task") action in Zapier to undo.' })
          : null,
      ]);
      const calendarRemoved = !entry.calendar || !!cal?.ok;
      const taskRemoved = !entry.tasks || !!tsk?.ok;
      const error = [cal && !cal.ok ? cal.error : '', tsk && !tsk.ok ? tsk.error : ''].filter(Boolean).join(' · ') || undefined;
      return { deadlineId, ok: calendarRemoved && taskRemoved, calendarRemoved, taskRemoved, error };
    }),
  );
}
