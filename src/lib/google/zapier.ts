// Live path: we connect to the user's Zapier MCP server (Google Calendar + Google Tasks) with the MCP
// SDK and hand its tools to Gemini (mcpToTool + automatic function calling). Gemini maps our deadlines
// onto Zapier's instruction-style tool params. Never throws out of runLiveSync / testZapier.
import type { Content, GoogleGenAI, Part } from '@google/genai';
import { relevantTools, toFunctionDeclarations } from './mcpTools';
import { directSync, directUndo } from './direct';
import type { McpToolInfo } from './mcpTools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { SyncedEntry, SyncItem, SyncOutcome, SyncResult, UndoResult } from './sync';
import { getGemini, withModelFallback } from '../ai/client';
import { getSettings } from '../settings';

export const TIMEZONE = 'Europe/Vienna';
/** Upper bound for tool calls in one sync (find + create calendar, create task, per item). */
const MAX_TOOL_CALLS = 60;

export interface Work {
  item: SyncItem;
  calendar: boolean;
  tasks: boolean;
}

/** Wall-clock "YYYY-MM-DD HH:mm" in Vienna for an instant. */
export function viennaLocal(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/ /g, ' ');
}

/** Short course name for titles: "VL / UE Logic" → "Logic". */
function courseName(item: SyncItem): string {
  const full = item.course?.fullname ?? '';
  return full.replace(/^((VL|UE|VO|KV|KO|KS|KT|PR|PS|SE|IK|VU)\s*\/?\s*)+/, '').trim() || item.course?.shortname || '';
}

const KIND: Record<string, string> = { assignment: 'Assignment', quiz: 'Quiz', exam: 'Exam', event: 'Event' };

/** Calendar title, like "Due: FOB2B · Logic" or "Exam: Logic final exam · Logic". */
export function eventTitle(item: SyncItem): string {
  const c = courseName(item);
  const prefix = item.deadline.type === 'exam' ? 'Exam' : item.deadline.type === 'event' ? 'Event' : 'Due';
  return `${prefix}: ${item.deadline.title}${c ? ` · ${c}` : ''}`;
}

/** Google Tasks has no due *time* in its API, so the time goes into the title: "FOB2B (Logic) · due 17:00". */
export function taskTitle(item: SyncItem): string {
  const c = courseName(item);
  const time = viennaLocal(new Date(item.deadline.due)).slice(11, 16);
  return `${item.deadline.title}${c ? ` (${c})` : ''} · due ${time}`;
}

/** Human due date in Vienna: "Monday, 30 November 2026, 17:00". */
export function dueText(item: SyncItem): string {
  return new Date(item.deadline.due).toLocaleString('en-GB', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Description / notes for both the event and the task. */
export function detailsText(item: SyncItem): string {
  const d = item.deadline;
  const lines = [
    [item.course?.fullname, KIND[d.type] ?? 'Deadline'].filter(Boolean).join(' · '),
    `Due: ${dueText(item)}`,
    d.description ? `\n${d.description.slice(0, 600)}` : '',
    d.url ? `\nOpen in Moodle: ${d.url}` : '',
    '\n— Added by Moodle Copilot',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * The calendar block sits at the moment it is really due (like "Due: Report 24.11" at 12:45):
 * assignments/quizzes 30 min starting at the due time, exams 90 min, other events 60 min.
 */
export function eventWindow(item: SyncItem): { start: Date; end: Date } {
  const due = new Date(item.deadline.due);
  const min = 60_000;
  const len = item.deadline.type === 'exam' ? 90 : item.deadline.type === 'event' ? 60 : 30;
  const end = new Date(due.getTime() + len * min);
  // A 23:59 deadline would spill past midnight onto the next day: then the block ends at the due time instead.
  if (viennaLocal(end).slice(0, 10) !== viennaLocal(due).slice(0, 10)) return { start: new Date(due.getTime() - len * min), end: due };
  return { start: due, end };
}

/** Google Calendar color id 11 = Tomato (red), like the user's "Due:" blocks. Exams: 6 = Tangerine. */
export function eventColorId(item: SyncItem): string {
  return item.deadline.type === 'exam' ? '6' : '11';
}

export interface PromptItem {
  deadlineId: string;
  title: string;
  taskTitle?: string;
  details?: string;
  type: string;
  course?: string;
  calendar: boolean;
  tasks: boolean;
  eventStart: string;
  eventEnd: string;
  dueDay: string;
  link?: string;
  description?: string;
}

export function toPromptItems(work: Work[]): PromptItem[] {
  return work.map(({ item, calendar, tasks }) => {
    const { start, end } = eventWindow(item);
    return {
      deadlineId: item.deadline.id,
      title: eventTitle(item),
      taskTitle: taskTitle(item),
      details: detailsText(item),
      type: item.deadline.type,
      course: item.course?.fullname,
      calendar,
      tasks,
      eventStart: viennaLocal(start),
      eventEnd: viennaLocal(end),
      dueDay: viennaLocal(new Date(item.deadline.due)).slice(0, 10),
      link: item.deadline.url,
      description: item.deadline.description,
    };
  });
}

const SYSTEM = `You are a sync worker. You write university deadlines into the user's Google Calendar and Google Tasks using ONLY the connected Zapier tools. Be quick and do not ask questions. Never create anything that was not requested. The timezone is ${TIMEZONE}.`;

export function buildSyncPrompt(prompt: PromptItem[]): string {
  return `Sync these deadlines. All times are wall-clock ${TIMEZONE} ("YYYY-MM-DD HH:mm").

${JSON.stringify(prompt, null, 2)}

Rules per item:
- If "calendar" is true: first use the Google Calendar "Find Event(s)" tool to look for an event with exactly the same title on the same day (eventStart's date). If one exists, do not create another (result "exists"). Otherwise use "Create Detailed Event": summary = title, start = eventStart, end = eventEnd (timezone ${TIMEZONE}), description = details, color red (Tomato).
- If "tasks" is true: use "Google Tasks: Create Task" in the default task list (or a list called "Moodle" if one exists). Title = taskTitle, due date = dueDay, notes = details.
- If "calendar" or "tasks" is false, do not touch that service for that item (result "skipped").

When finished, reply with ONLY a JSON array (no prose, no code fence), one entry per item:
[{"deadlineId":"…","calendar":"created"|"exists"|"failed"|"skipped","tasks":"created"|"failed"|"skipped","error":"short reason, only if something failed"}]`;
}

export interface McpServerCfg {
  url: string;
  token?: string;
}

/** Connects to the Zapier MCP server: Streamable HTTP first, SSE as a fallback. */
export async function connectMcp(srv: McpServerCfg): Promise<Client> {
  const requestInit = srv.token ? { headers: { Authorization: `Bearer ${srv.token}` } } : undefined;
  const make = () => new Client({ name: 'moodle-copilot', version: '1.0.0' });
  let first: unknown;
  const client = make();
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(srv.url), { requestInit }));
    return client;
  } catch (e) {
    first = e;
    await client.close().catch(() => {});
  }
  const fallback = make();
  try {
    await fallback.connect(new SSEClientTransport(new URL(srv.url), { requestInit }));
    return fallback;
  } catch {
    await fallback.close().catch(() => {});
    throw first;
  }
}

/** Pulls the first JSON array out of text, tolerating code fences and prose. */
export function parseJsonArray(text: string): unknown[] | null {
  const stripped = text.replace(/```(?:json)?/gi, '');
  for (let s = stripped.indexOf('['); s !== -1; s = stripped.indexOf('[', s + 1)) {
    for (let e = stripped.lastIndexOf(']'); e > s; e = stripped.lastIndexOf(']', e - 1)) {
      try {
        const v = JSON.parse(stripped.slice(s, e + 1));
        if (Array.isArray(v)) return v;
      } catch {
        /* try a shorter slice */
      }
    }
  }
  return null;
}


export function friendlyError(e: unknown): string {
  const err = e as { status?: number; code?: number; message?: string };
  const raw = err?.message ?? String(e);
  if (/SERVICE_DISABLED|has not been used|PERMISSION_DENIED/i.test(raw) || err?.status === 403) return 'Gemini API is not enabled for this key (403). Check the key in Settings.';
  if (err?.status === 401 || /API key|UNAUTHENTICATED/i.test(raw)) {
    return /zapier|mcp/i.test(raw) ? 'Zapier rejected the request (401). Check the URL or token in Settings.' : 'Gemini API key missing or invalid (Settings).';
  }
  if (err?.status === 402 || /credits are depleted/i.test(raw)) return 'Gemini project has no credits left (402). Add credits in Google AI Studio.';
  if (err?.status === 429 || /RESOURCE_EXHAUSTED/i.test(raw)) return 'Rate limited, wait a moment and try again.';
  if (/No Gemini API key/i.test(raw)) return raw;
  if (/mcp|zapier|sse|streamable/i.test(raw)) return `Zapier connection failed: ${raw.slice(0, 160)}`;
  if (/fetch|network|Failed to/i.test(raw)) return 'Network error. Are you online?';
  return raw.slice(0, 200);
}

const OUTCOMES: SyncOutcome[] = ['created', 'exists', 'failed', 'skipped'];
const asOutcome = (v: unknown, wanted: boolean): SyncOutcome =>
  !wanted ? 'skipped' : OUTCOMES.includes(v as SyncOutcome) ? (v as SyncOutcome) : 'failed';

function allFailed(work: Work[], error: string): SyncResult[] {
  return work.map(({ item, calendar, tasks }) => ({
    deadlineId: item.deadline.id,
    calendar: calendar ? 'failed' : 'skipped',
    tasks: tasks ? 'failed' : 'skipped',
    error,
  }));
}

const MAX_ROUNDS = 12;

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

/**
 * Gemini ↔ Zapier tool loop. We list the MCP tools ourselves and clean their schemas (Zapier's raw schemas have
 * $ref loops that Gemini rejects), then run each function call through the MCP client. Returns Gemini's final text.
 */
export async function runToolLoop(ai: GoogleGenAI, mcp: Client, model: string, prompt: string): Promise<string> {
  const { tools } = await mcp.listTools();
  const { declarations, nameMap } = toFunctionDeclarations(relevantTools(tools));
  const contents: Content[] = [{ role: 'user', parts: [{ text: prompt }] }];
  let calls = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await ai.models.generateContent({
      model,
      contents,
      config: { systemInstruction: SYSTEM, temperature: 0, tools: [{ functionDeclarations: declarations }], abortSignal: AbortSignal.timeout(25_000) },
    });
    const fcs = res.functionCalls ?? [];
    if (!fcs.length) {
      const reason = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason;
      const text = res.text ?? '';
      if (!text && reason) throw new Error(`Gemini stopped (${reason})`);
      return text;
    }
    // Keep the model turn exactly as returned (thought signatures are needed for the next round).
    const modelTurn = res.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);
    const parts: Part[] = [];
    for (const fc of fcs) {
      if (++calls > MAX_TOOL_CALLS) throw new Error('Too many tool calls');
      const mcpName = nameMap.get(fc.name ?? '') ?? fc.name ?? '';
      let response: Record<string, unknown>;
      try {
        const out = await mcp.callTool({ name: mcpName, arguments: (fc.args ?? {}) as Record<string, unknown> });
        const text = (out.content as { type: string; text?: string }[] | undefined)?.map((c) => c.text ?? '').join('\n').slice(0, 4000) ?? '';
        response = out.isError ? { error: text || 'Tool error' } : { output: text };
      } catch (e) {
        response = { error: e instanceof Error ? e.message : String(e) };
      }
      parts.push({ functionResponse: { name: fc.name ?? mcpName, ...(fc.id ? { id: fc.id } : {}), response } });
    }
    contents.push({ role: 'user', parts });
  }
  throw new Error('Gemini did not finish within the round limit');
}

// ---- One warm Zapier session, reused across clicks (lives in the background service worker) ----
interface Session {
  key: string;
  client: Client;
  tools: McpToolInfo[];
  at: number;
}
let session: Promise<Session> | null = null;
const SESSION_TTL = 10 * 60_000;

async function openSession(url: string, token?: string): Promise<Session> {
  const client = await withDeadline(connectMcp({ url, token }), 15_000, 'Connecting to Zapier');
  const { tools } = await withDeadline(client.listTools(), 15_000, 'Listing Zapier tools');
  return { key: `${url}|${token ?? ''}`, client, tools, at: Date.now() };
}

/** Cached connection + tool list. `fresh` forces a reconnect (after an error). */
export async function getZapierSession(fresh = false): Promise<Session> {
  const settings = await getSettings();
  if (!settings.zapierMcpUrl) throw new Error('No Zapier URL in Settings.');
  const key = `${settings.zapierMcpUrl}|${settings.zapierMcpToken ?? ''}`;
  if (session && !fresh) {
    const s = await session.catch(() => null);
    if (s && s.key === key && Date.now() - s.at < SESSION_TTL) return s;
    s?.client.close().catch(() => {});
  }
  session = openSession(settings.zapierMcpUrl, settings.zapierMcpToken || undefined);
  session.catch(() => (session = null));
  return session;
}

export async function prewarmZapier(): Promise<void> {
  await getZapierSession();
}

/** Runs `fn` on the warm session; if it fails on a stale connection, reconnects once and retries. */
async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  try {
    return await fn(await getZapierSession());
  } catch (e) {
    if (e instanceof Error && /No Zapier URL/.test(e.message)) throw e;
    return fn(await getZapierSession(true));
  }
}

/** Deletes what we created (by id, or by title + day when Zapier gave no id). */
export async function runLiveUndo(entries: { deadlineId: string; entry: SyncedEntry }[]): Promise<UndoResult[]> {
  if (!entries.length) return [];
  try {
    return await withSession((s) => directUndo(s.client, s.tools, entries));
  } catch (e) {
    return entries.map((x) => ({ deadlineId: x.deadlineId, ok: false, error: friendlyError(e) }));
  }
}

/** `work` holds only items that need writing; flags say which channel to write for each. */
export async function runLiveSync(work: Work[]): Promise<SyncResult[]> {
  if (!work.length) return [];
  const settings = await getSettings();
  if (!settings.zapierMcpUrl) return allFailed(work, 'No Zapier URL in Settings.');
  let mcp: Client | undefined;
  try {
    // Fast path: warm session + Zapier's Calendar/Tasks tools called directly, in parallel.
    const direct = await withSession((s) => {
      mcp = s.client;
      return directSync(s.client, s.tools, work);
    });
    if (direct) return direct;
    // Only if those tools are missing: let Gemini figure out the server's tools.
    const ai = await getGemini();
    const text = await withModelFallback((model) => withDeadline(runToolLoop(ai, mcp!, model, buildSyncPrompt(toPromptItems(work))), 90_000, 'Gemini'));
    const arr = parseJsonArray(text);
    if (!arr) return allFailed(work, `Unexpected reply from Gemini. ${text.slice(0, 120)}`.trim());
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of arr) {
      const id = (r as { deadlineId?: unknown } | null)?.deadlineId;
      if (typeof id === 'string') byId.set(id, r as Record<string, unknown>);
    }
    return work.map(({ item, calendar, tasks }): SyncResult => {
      const r = byId.get(item.deadline.id);
      if (!r) {
        return {
          deadlineId: item.deadline.id,
          calendar: calendar ? 'failed' : 'skipped',
          tasks: tasks ? 'failed' : 'skipped',
          error: 'No result for this item.',
        };
      }
      const cal = asOutcome(r.calendar, calendar);
      const tsk = asOutcome(r.tasks, tasks);
      const failed = cal === 'failed' || tsk === 'failed';
      return { deadlineId: item.deadline.id, calendar: cal, tasks: tsk, error: failed ? String(r.error ?? 'Failed') : undefined };
    });
  } catch (e) {
    return allFailed(work, friendlyError(e));
  }
}

export interface ZapierTestResult {
  ok: boolean;
  tools: string[];
  error?: string;
}

/** Connects to the MCP server and lists its tools. No LLM, no writes. */
export async function testZapier(): Promise<ZapierTestResult> {
  const settings = await getSettings();
  if (!settings.zapierMcpUrl) return { ok: false, tools: [], error: 'No Zapier URL' };
  let mcp: Client | undefined;
  try {
    mcp = await connectMcp({ url: settings.zapierMcpUrl, token: settings.zapierMcpToken || undefined });
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    if (!tools.length) return { ok: false, tools: [], error: 'Connected, but no tools are enabled. Add Google Calendar and Google Tasks actions on mcp.zapier.com.' };
    return { ok: true, tools };
  } catch (e) {
    return { ok: false, tools: [], error: friendlyError(e) };
  } finally {
    await mcp?.close().catch(() => {});
  }
}
