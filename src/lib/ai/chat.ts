// Streaming chat engine with a manual tool loop. UI-agnostic so it can also run from node scripts.
import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, getClaude } from './client';
import { buildSystemPrompt } from './prompt';
import { executeTool, TOOLS, type ToolName, type ToolOutput } from './tools';
import { getSettings } from '../settings';

export type History = Anthropic.MessageParam[];

export interface ChatCallbacks {
  /** Streamed text delta. */
  onText?: (delta: string) => void;
  /** A tool is about to run. */
  onToolStart?: (name: ToolName) => void;
  onToolResult?: (name: ToolName, out: ToolOutput) => void;
}

const MAX_TURNS = 8;

/**
 * Runs one user turn to completion. Mutates `history` (appends assistant + tool_result messages).
 * Returns the final assistant text (all text blocks of the whole turn, in order).
 * Throws on API errors; the caller shows a friendly message and offers a retry.
 */
export async function runTurn(history: History, cb: ChatCallbacks = {}, client?: Anthropic): Promise<string> {
  const settings = await getSettings();
  const claude = client ?? (await getClaude());
  const system = buildSystemPrompt(settings);
  let fullText = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = claude.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system,
      tools: TOOLS,
      output_config: { effort: 'low' },
      messages: history,
    });
    stream.on('text', (t) => {
      fullText += t;
      cb.onText?.(t);
    });
    const msg = await stream.finalMessage();

    // Always keep the full content (incl. tool_use) in history.
    history.push({ role: 'assistant', content: msg.content });

    if (msg.stop_reason === 'refusal') {
      const note = settings.language === 'de' ? '\n\nDazu kann ich leider nichts sagen.' : "\n\nI can't help with that.";
      fullText += note;
      cb.onText?.(note);
      return fullText;
    }
    if (msg.stop_reason === 'max_tokens') {
      const note = settings.language === 'de' ? '\n\n(Antwort gekürzt.)' : '\n\n(Answer was cut off.)';
      fullText += note;
      cb.onText?.(note);
      if (!msg.content.some((b) => b.type === 'tool_use')) return fullText;
    }
    if (msg.stop_reason !== 'tool_use' && msg.stop_reason !== 'max_tokens' && msg.stop_reason !== 'pause_turn') return fullText;
    if (msg.stop_reason === 'pause_turn') continue;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      const name = block.name as ToolName;
      cb.onToolStart?.(name);
      const out = await executeTool(block.name, (block.input ?? {}) as Record<string, unknown>);
      cb.onToolResult?.(name, out);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
    }
    if (!results.length) return fullText;
    // ALL tool results go in ONE user message.
    history.push({ role: 'user', content: results });
    // Separate text before/after tool calls visually.
    if (fullText && !fullText.endsWith('\n')) {
      fullText += '\n\n';
      cb.onText?.('\n\n');
    }
  }
  return fullText;
}

/** Friendly message for an API/network error. */
export function friendlyError(e: unknown, lang: 'de' | 'en'): string {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 401) return lang === 'de' ? 'Der API-Key wurde abgelehnt. Bitte prüfe ihn in den Einstellungen.' : 'The API key was rejected. Please check it in Settings.';
  if (status === 429) return lang === 'de' ? 'Gerade zu viele Anfragen. Versuch es in ein paar Sekunden nochmal.' : 'Too many requests right now. Try again in a few seconds.';
  if (status && status >= 500) return lang === 'de' ? 'Claude ist gerade überlastet. Bitte nochmal versuchen.' : 'Claude is overloaded right now. Please try again.';
  if (/fetch|network|Failed to/i.test(msg)) return lang === 'de' ? 'Keine Verbindung zu Claude. Prüfe dein Internet.' : "Can't reach Claude. Check your connection.";
  return lang === 'de' ? 'Das hat leider nicht geklappt. Bitte nochmal versuchen.' : "That didn't work. Please try again.";
}
