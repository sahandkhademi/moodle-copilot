// Streaming chat engine on Gemini (@google/genai chats API). UI-agnostic so it can also run from node scripts.
// The SDK chat object keeps the history (incl. Gemini thought signatures needed for multi-turn function calling).
import type { Chat, Content, FunctionResponse, GenerateContentConfig, GoogleGenAI, Part } from '@google/genai';
import { FIRST_CHUNK_TIMEOUT_MS, FORCE_TOOLS_MODELS, GEMINI_MODELS, getGemini, isRetriableModelError } from './client';
import { FunctionCallingConfigMode } from '@google/genai';
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

/** Last model that worked, shared by all conversations in this panel, so new chats skip overloaded models. */
let lastGoodModelIdx = 0;

/** Thought signatures are model-specific; drop them when moving history to another model. */
function stripSignatures(history: Content[]): Content[] {
  return history.map((c) => ({ ...c, parts: c.parts?.map(({ thoughtSignature: _sig, ...p }) => p) }));
}

export class Conversation {
  private chat: Chat;
  /** Index into GEMINI_MODELS. Moves down the list when a model is overloaded, and stays there. */
  private modelIdx = lastGoodModelIdx;
  private constructor(private ai: GoogleGenAI, private system: string) {
    this.chat = this.make();
  }

  get model(): string {
    return GEMINI_MODELS[this.modelIdx]!;
  }

  /** Reads the key from settings (throws if missing). Pass `ai` to inject a client (scripts). */
  static async create(ai?: GoogleGenAI, opts: { model?: string } = {}): Promise<Conversation> {
    const settings = await getSettings();
    const conv = new Conversation(ai ?? (await getGemini()), buildSystemPrompt(settings));
    const idx = opts.model ? GEMINI_MODELS.indexOf(opts.model) : -1;
    if (idx > 0) {
      conv.modelIdx = idx;
      conv.chat = conv.make();
    }
    return conv;
  }

  /** Base request config. NOTE: a per-message `config` REPLACES the chat's config in @google/genai, so always spread this in. */
  private get baseConfig(): GenerateContentConfig {
    return { systemInstruction: this.system, tools: [{ functionDeclarations: TOOLS }] };
  }

  private make(history?: Content[]): Chat {
    return this.ai.chats.create({ model: this.model, config: this.baseConfig, history });
  }

  /**
   * Runs one user turn to completion (text streaming + tool loop). Returns the full answer text.
   * On error the chat history is rolled back to before this turn, so a retry starts clean.
   */
  async send(text: string, cb: ChatCallbacks = {}): Promise<string> {
    const snapshot = structuredClone(this.chat.getHistory(true));
    for (;;) {
      let emitted = false;
      const tracked: ChatCallbacks = {
        onText: (d) => {
          emitted = true;
          cb.onText?.(d);
        },
        onToolStart: (n) => {
          emitted = true;
          cb.onToolStart?.(n);
        },
        onToolResult: cb.onToolResult,
      };
      try {
        const out = await this.attempt(text, tracked);
        lastGoodModelIdx = this.modelIdx;
        return out;
      } catch (e) {
        // Overloaded / unavailable before anything reached the user → silently switch to the next model.
        const canFallback = !emitted && isRetriableModelError(e) && this.modelIdx < GEMINI_MODELS.length - 1;
        if (canFallback) {
          console.warn(`[chat] ${this.model} unavailable, switching model`, e);
          this.modelIdx++;
          this.chat = this.make(stripSignatures(snapshot));
          continue;
        }
        this.chat = this.make(snapshot);
        throw e;
      }
    }
  }

  private async attempt(text: string, cb: ChatCallbacks): Promise<string> {
    let full = '';
    {
      let message: Part[] = [{ text }];
      for (let round = 0; round < MAX_ROUNDS; round++) {
        // Abort if the model doesn't start answering in time (some models hang under load).
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error('Gemini timed out')), FIRST_CHUNK_TIMEOUT_MS);
        let stream: AsyncGenerator<import('@google/genai').GenerateContentResponse>;
        try {
          const force = round === 0 && FORCE_TOOLS_MODELS.has(this.model);
          stream = await this.chat.sendMessageStream({
            message,
            config: {
              ...this.baseConfig,
              abortSignal: ctrl.signal,
              ...(force ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } } : {}),
            },
          });
        } catch (e) {
          clearTimeout(timer);
          throw e;
        }
        const calls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
        let roundText = '';
        let first = true;
        for await (const chunk of stream) {
          if (first) {
            clearTimeout(timer);
            first = false;
          }
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
    }
  }
}

export type ChatErrorKind = 'no_key' | 'api_disabled' | 'bad_key' | 'billing' | 'rate' | 'overloaded' | 'network' | 'other';

export function classifyError(e: unknown): ChatErrorKind {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  if (/No Gemini API key/i.test(msg)) return 'no_key';
  if (/SERVICE_DISABLED|has not been used in project|API_KEY_SERVICE_BLOCKED|accessNotConfigured/i.test(msg)) return 'api_disabled';
  if (/API_KEY_INVALID|API key not valid/i.test(msg) || status === 401) return 'bad_key';
  if (status === 402 || /credits are depleted|billing/i.test(msg)) return 'billing';
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
    case 'billing':
      return 'The Gemini project for this key has no credits left. Add credits or billing in Google AI Studio (ai.studio/projects).';
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
