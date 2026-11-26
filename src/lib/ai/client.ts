// Shared AI client: Google Gemini (@google/genai). Runs in extension pages, key from settings.
import { GoogleGenAI } from '@google/genai';
import { getSettings } from '../settings';

/** Preferred model, then fallbacks. Gemini models regularly return 503 "high demand"; the demo must not stall on it. */
export const GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
export const GEMINI_MODELS: readonly string[] = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];

/** Give up on a model if it hasn't produced its first chunk within this time. */
export const FIRST_CHUNK_TIMEOUT_MS = 30_000;

/** Weaker models that skip tools unless forced on the first round of a turn. */
export const FORCE_TOOLS_MODELS = new Set(['gemini-3.5-flash-lite']);

export async function getGemini(): Promise<GoogleGenAI> {
  const { geminiApiKey } = await getSettings();
  if (!geminiApiKey) throw new Error('No Gemini API key. Add one in Settings.');
  return new GoogleGenAI({ apiKey: geminiApiKey });
}

/** True for errors where trying the next model makes sense (overload, outage, unknown model, timeout). */
export function isRetriableModelError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : String(e);
  if (status && [404, 500, 502, 503, 504].includes(status)) return true;
  return /UNAVAILABLE|high demand|overloaded|DEADLINE_EXCEEDED|not found for API version|aborted|timed out/i.test(msg);
}

let preferred = 0; // sticky: once a model fails, stay on the one that works for this session

/** Runs `fn` with each model in order until one succeeds. Non-retriable errors are thrown immediately. */
export async function withModelFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = preferred; i < GEMINI_MODELS.length; i++) {
    try {
      const out = await fn(GEMINI_MODELS[i]!);
      preferred = i;
      return out;
    } catch (e) {
      lastErr = e;
      if (!isRetriableModelError(e)) throw e;
      console.warn(`[gemini] ${GEMINI_MODELS[i]} failed, trying next model`, e);
    }
  }
  throw lastErr;
}
