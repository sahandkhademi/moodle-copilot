// Streaming chat engine on Gemini (@google/genai chats API). UI-agnostic so it can also run from node scripts.
// The SDK chat object keeps the history (incl. Gemini thought signatures needed for multi-turn function calling).
import type { Chat, Content, FunctionResponse, GoogleGenAI, Part } from '@google/genai';
import { GEMINI_MODEL, getGemini } from './client';
import { buildSystemPrompt } from './prompt';
import { executeTool, TOOLS, type ToolName, type ToolOutput } from './tools';
import { getSettings } from '../settings';

export interface ChatCallbacks {
  /** Streamed text delta. */
  onText?: (delta: string) => void;
  /** A tool is about to run. */
  onToolStart?: (name: ToolName) => void;
  onToolResult?: (name: ToolName, out: ToolOutput) => void;
}

const MAX_ROUNDS = 6;

export class Conversation {
  private chat: Chat;
  private constructor(private ai: GoogleGenAI, private system: string) {
    this.chat = this.make();
  }

  /** Reads the key from settings (throws if missing). Pass `ai` to inject a client (scripts). */
  static async create(ai?: GoogleGenAI): Promise<Conversation> {
    const settings = await getSettings();
    return new Conversation(ai ?? (await getGemini()), buildSystemPrompt(settings));
  }

  private make(history?: Content[]): Chat {
    return this.ai.chats.create({
      model: GEMINI_MODEL,
      config: { systemInstruction: this.system, tools: [{ functionDeclarations: TOOLS }] },
      history,
    });
  }

  /**
   * Runs one user turn to completion (text streaming + tool loop). Returns the full answer text.
   * On error the chat history is rolled back to before this turn, so a retry starts clean.
   */
  async send(text: string, cb: ChatCallbacks = {}): Promise<string> {
    const snapshot = structuredClone(this.chat.getHistory(true));
    let full = '';
    try {
      let message: Part[] = [{ text }];
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const stream = await this.chat.sendMessageStream({ message });
        const calls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
        let roundText = '';
        for await (const chunk of stream) {
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.text && !part.thought) {
              roundText += part.text;
              full += part.text;
              cb.onText?.(part.text);
            }
            if (part.functionCall?.name) {
              calls.push({ id: part.functionCall.id, name: part.functionCall.name, args: (part.functionCall.args ?? {}) as Record<string, unknown> });
            }
          }
        }
        if (!calls.length) {
          if (!full.trim()) {
            full = "I couldn't come up with an answer. Please try rephrasing.";
            cb.onText?.(full);
          }
          return full;
        }
        const responses: Part[] = [];
        for (const c of calls) {
          const name = c.name as ToolName;
          cb.onToolStart?.(name);
          const out = await executeTool(c.name, c.args);
          cb.onToolResult?.(name, out);
          const fr: FunctionResponse = { name: c.name, response: out.isError ? { error: out.content } : { output: out.content } };
          if (c.id) fr.id = c.id;
          responses.push({ functionResponse: fr });
        }
        // ALL function responses go back in ONE message.
        message = responses;
        if (roundText && !full.endsWith('\n')) {
          full += '\n\n';
          cb.onText?.('\n\n');
        }
      }
      const note = '\n\n(I had to stop here. Ask again if something is missing.)';
      full += note;
      cb.onText?.(note);
      return full;
    } catch (e) {
      this.chat = this.make(snapshot);
      throw e;
    }
  }
}

export type ChatErrorKind = 'no_key' | 'api_disabled' | 'bad_key' | 'rate' | 'overloaded' | 'network' | 'other';

export function classifyError(e: unknown): ChatErrorKind {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  if (/No Gemini API key/i.test(msg)) return 'no_key';
  if (/SERVICE_DISABLED|has not been used in project|API_KEY_SERVICE_BLOCKED|accessNotConfigured/i.test(msg)) return 'api_disabled';
  if (/API_KEY_INVALID|API key not valid/i.test(msg) || status === 401) return 'bad_key';
  if (status === 403) return 'api_disabled';
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(msg)) return 'rate';
  if (status && status >= 500) return 'overloaded';
  if (/fetch|network|Failed to/i.test(msg)) return 'network';
  return 'other';
}

/** Friendly message for an API/network error. */
export function friendlyError(e: unknown): string {
  switch (classifyError(e)) {
    case 'no_key':
      return 'Add your Gemini API key in Settings first.';
    case 'api_disabled':
      return "The Gemini API isn't enabled for this key yet. Enable the Generative Language API for its Google Cloud project, or create a new key in Google AI Studio.";
    case 'bad_key':
      return 'The Gemini API key was rejected. Please check it in Settings.';
    case 'rate':
      return 'Too many requests right now. Try again in a few seconds.';
    case 'overloaded':
      return 'Gemini is overloaded right now. Please try again.';
    case 'network':
      return "Can't reach Gemini. Check your connection.";
    default:
      return "That didn't work. Please try again.";
  }
}
