// Live path: we connect to the user's Zapier MCP server (Google Calendar + Google Tasks) with the MCP
// SDK and hand its tools to Gemini (mcpToTool + automatic function calling). Gemini maps our deadlines
// onto Zapier's instruction-style tool params. Never throws out of runLiveSync / testZapier.
import type { Content, GoogleGenAI, Part } from '@google/genai';
import { relevantTools, toFunctionDeclarations } from './mcpTools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { SyncItem, SyncOutcome, SyncResult } from './sync';
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

export function eventTitle(item: SyncItem): string {
  const tag = item.course?.shortname ?? '';
  return tag ? `[${tag}] ${item.deadline.title}` : item.deadline.title;
}

/** Assignments/quizzes: 30-min block ending at due. Exams: start at due, 90 min. Events: start at due, 60 min. */
export function eventWindow(item: SyncItem): { start: Date; end: Date } {
  const due = new Date(item.deadline.due);
  const min = 60_000;
  switch (item.deadline.type) {
    case 'exam':
      return { start: due, end: new Date(due.getTime() + 90 * min) };
    case 'event':
      return { start: due, end: new Date(due.getTime() + 60 * min) };
    default:
      return { start: new Date(due.getTime() - 30 * min), end: due };
  }
}

export interface PromptItem {
  deadlineId: string;
  title: string;
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
- If "calendar" is true: first use the Google Calendar "Find Event(s)" tool to look for an event with exactly the same title on the same day (eventStart's date). If one exists, do not create another (result "exists"). Otherwise use "Create Detailed Event": summary = title, start = eventStart, end = eventEnd (timezone ${TIMEZONE}), description = the Moodle link (if any) followed by the description text (if any).
- If "tasks" is true: use "Google Tasks: Create Task" in the default task list (or a list called "Moodle" if one exists). Title = title, due date = dueDay, notes = the Moodle link (if any).
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
      config: { systemInstruction: SYSTEM, temperature: 0, tools: [{ functionDeclarations: declarations }] },
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

/** `work` holds only items that need writing; flags say which channel to write for each. */
export async function runLiveSync(work: Work[]): Promise<SyncResult[]> {
  if (!work.length) return [];
  const settings = await getSettings();
  if (!settings.zapierMcpUrl) return allFailed(work, 'No Zapier URL in Settings.');
  let mcp: Client | undefined;
  try {
    const ai = await getGemini();
    mcp = await connectMcp({ url: settings.zapierMcpUrl, token: settings.zapierMcpToken || undefined });
    const text = await withModelFallback((model) => runToolLoop(ai, mcp!, model, buildSyncPrompt(toPromptItems(work))));
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
  } finally {
    await mcp?.close().catch(() => {});
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
