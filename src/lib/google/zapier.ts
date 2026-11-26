// Live path: one Claude request per sync, using the Messages API MCP connector to reach the
// user's Zapier MCP server (Google Calendar + Google Tasks). Claude maps our deadlines onto
// Zapier's instruction-style tool params. Never throws out of runLiveSync / testZapier.
import type Anthropic from '@anthropic-ai/sdk';
import type { SyncItem, SyncOutcome, SyncResult } from './sync';
import { getClaude, CLAUDE_MODEL } from '../ai/client';
import { getSettings, type Settings } from '../settings';

export const MCP_BETA = 'mcp-client-2025-11-20';
export const TIMEZONE = 'Europe/Vienna';
const MAX_CONTINUATIONS = 6;

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
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

export function buildRequest(prompt: string, srv: McpServerCfg, system: string = SYSTEM): CreateParams {
  return {
    model: CLAUDE_MODEL,
    betas: [MCP_BETA],
    max_tokens: 16000,
    output_config: { effort: 'low' },
    system,
    mcp_servers: [{ type: 'url', url: srv.url, name: 'zapier', ...(srv.token ? { authorization_token: srv.token } : {}) }],
    tools: [{ type: 'mcp_toolset', mcp_server_name: 'zapier' }],
    messages: [{ role: 'user', content: prompt }],
  };
}

export function buildSyncRequest(work: Work[], srv: McpServerCfg): CreateParams {
  return buildRequest(buildSyncPrompt(toPromptItems(work)), srv);
}

type Msg = Anthropic.Beta.Messages.BetaMessage;
type Block = Msg['content'][number];

/** Runs the request, continuing on pause_turn. Returns the final message plus every block seen. */
async function runTurn(client: Anthropic, params: CreateParams): Promise<{ msg: Msg; blocks: Block[] }> {
  const messages = [...params.messages];
  const blocks: Block[] = [];
  let msg: Msg | undefined;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    msg = await client.beta.messages.create({ ...params, messages });
    blocks.push(...msg.content);
    if (msg.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: msg.content as never });
  }
  return { msg: msg!, blocks };
}

function finalText(blocks: Block[]): string {
  // Text after the last tool activity is the final answer.
  let lastTool = -1;
  blocks.forEach((b, i) => {
    if (b.type === 'mcp_tool_use' || b.type === 'mcp_tool_result') lastTool = i;
  });
  return blocks
    .slice(lastTool + 1)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');
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

export function friendlyError(e: unknown, lang: Settings['language'] = 'de'): string {
  const de = lang === 'de';
  const err = e as { status?: number; message?: string };
  const raw = err?.message ?? String(e);
  if (err?.status === 401 || /api key|authentication/i.test(raw)) return de ? 'Claude-API-Key ungültig oder fehlt (Einstellungen).' : 'Claude API key missing or invalid (Settings).';
  if (err?.status === 429) return de ? 'Zu viele Anfragen, bitte kurz warten.' : 'Rate limited, wait a moment.';
  if (/mcp|zapier/i.test(raw)) return de ? `Zapier-Verbindung fehlgeschlagen: ${raw.slice(0, 160)}` : `Zapier connection failed: ${raw.slice(0, 160)}`;
  if (/fetch|network|Failed to/i.test(raw)) return de ? 'Netzwerkfehler. Bist du online?' : 'Network error. Are you online?';
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

/** `work` holds only items that need writing; flags say which channel to write for each. */
export async function runLiveSync(work: Work[]): Promise<SyncResult[]> {
  if (!work.length) return [];
  const settings = await getSettings();
  const de = settings.language === 'de';
  if (!settings.zapierMcpUrl) return allFailed(work, de ? 'Keine Zapier-URL in den Einstellungen.' : 'No Zapier URL in Settings.');
  try {
    const client = await getClaude();
    const params = buildSyncRequest(work, { url: settings.zapierMcpUrl, token: settings.zapierMcpToken || undefined });
    const { msg, blocks } = await runTurn(client, params);
    if (msg.stop_reason === 'refusal') return allFailed(work, de ? 'Claude hat die Anfrage abgelehnt.' : 'Claude declined the request.');
    if (msg.stop_reason === 'max_tokens') return allFailed(work, de ? 'Antwort abgeschnitten (zu lang).' : 'Response was cut off.');
    const arr = parseJsonArray(finalText(blocks));
    if (!arr) {
      const toolErr = blocks.find((b) => b.type === 'mcp_tool_result' && b.is_error) as { content: unknown } | undefined;
      const detail = toolErr ? JSON.stringify(toolErr.content).slice(0, 160) : '';
      return allFailed(work, (de ? 'Unerwartete Antwort von Claude. ' : 'Unexpected reply from Claude. ') + detail);
    }
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
          error: de ? 'Keine Rückmeldung für diesen Eintrag.' : 'No result for this item.',
        };
      }
      const cal = asOutcome(r.calendar, calendar);
      const tsk = asOutcome(r.tasks, tasks);
      const failed = cal === 'failed' || tsk === 'failed';
      return { deadlineId: item.deadline.id, calendar: cal, tasks: tsk, error: failed ? String(r.error ?? (de ? 'Fehlgeschlagen' : 'Failed')) : undefined };
    });
  } catch (e) {
    return allFailed(work, friendlyError(e, settings.language));
  }
}

export interface ZapierTestResult {
  ok: boolean;
  tools: string[];
  error?: string;
}

/** Minimal no-write request: asks Claude to list the MCP tools it can see. */
export async function testZapier(): Promise<ZapierTestResult> {
  const settings = await getSettings();
  if (!settings.zapierMcpUrl) return { ok: false, tools: [], error: 'No Zapier URL' };
  try {
    const client = await getClaude();
    const params = buildRequest(
      'List the names of every tool you can use from the connected MCP server. Do NOT call any of them. Reply with ONLY a JSON array of tool name strings.',
      { url: settings.zapierMcpUrl, token: settings.zapierMcpToken || undefined },
      'You are a connection tester. Never call tools. Reply only with the requested JSON.',
    );
    params.max_tokens = 2000;
    const { msg, blocks } = await runTurn(client, params);
    if (msg.stop_reason === 'refusal') return { ok: false, tools: [], error: 'Claude declined the request.' };
    const tools = (parseJsonArray(finalText(blocks)) ?? []).filter((x): x is string => typeof x === 'string');
    if (!tools.length) return { ok: false, tools: [], error: 'Claude sees no tools. Check the URL/token and that the actions are enabled.' };
    return { ok: true, tools };
  } catch (e) {
    return { ok: false, tools: [], error: friendlyError(e, settings.language) };
  }
}
