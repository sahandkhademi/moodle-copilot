// Shared AI client: Google Gemini (@google/genai). Runs in extension pages, key from settings.
import { GoogleGenAI } from '@google/genai';
import { getSettings } from '../settings';

/** Fast model for chat and tool use. */
export const GEMINI_MODEL = 'gemini-3.8-flash';

export async function getGemini(): Promise<GoogleGenAI> {
  const { geminiApiKey } = await getSettings();
  if (!geminiApiKey) throw new Error('No Gemini API key. Add one in Settings.');
  return new GoogleGenAI({ apiKey: geminiApiKey });
}
