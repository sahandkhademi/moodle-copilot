import { useEffect, useState } from 'react';
import { getItem, KEYS, setItem, watchItem } from './storage';

export type GradeCutoffs = { 1: number; 2: number; 3: number; 4: number };

export interface Settings {
  /** e.g. https://moodle.yotkao.at — empty means mock data. */
  moodleUrl: string;
  /** Google AI Studio key (Gemini). */
  geminiApiKey: string;
  /** Zapier MCP server URL from mcp.zapier.com (Google Calendar + Tasks actions enabled). */
  zapierMcpUrl: string;
  /** Optional bearer token, if the Zapier server URL needs one. */
  zapierMcpToken: string;
  /** Demo safety: use seeded data and fake external writes. */
  mockMode: boolean;
  /** UI is English-only for now. Kept as a field so German can come back later. */
  language: 'de' | 'en';
  /** Minimum percentage for each Austrian grade. Below cutoff 4 is a 5 (Nicht genügend). */
  gradeCutoffs: GradeCutoffs;
  /** Default max share of sessions you may miss, 0..1. */
  absenceLimit: number;
  /** Read chat answers aloud (feature 4.3). */
  voiceReadAloud: boolean;
  /**
   * Show Copilot inside Moodle's own Dashboard (grades block, absence alerts, Google buttons on the Timeline)
   * instead of a second dashboard in the side panel. The side panel then only has the Assistant + Settings.
   */
  showInMoodle: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  moodleUrl: '',
  geminiApiKey: '',
  zapierMcpUrl: '',
  zapierMcpToken: '',
  mockMode: true,
  language: 'en',
  gradeCutoffs: { 1: 89, 2: 76, 3: 63, 4: 50 },
  absenceLimit: 0.2,
  voiceReadAloud: false,
  showInMoodle: true,
};

export async function getSettings(): Promise<Settings> {
  const stored = await getItem<Partial<Settings>>(KEYS.settings, {});
  // English-only for now: ignore any stored 'de'.
  return { ...DEFAULT_SETTINGS, ...stored, language: 'en', gradeCutoffs: { ...DEFAULT_SETTINGS.gradeCutoffs, ...stored.gradeCutoffs } };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await setItem(KEYS.settings, next);
  return next;
}

/** React hook: current settings, live-updated across extension pages. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    return watchItem(KEYS.settings, () => getSettings().then(setSettings));
  }, []);
  const update = async (patch: Partial<Settings>) => {
    setSettings(await updateSettings(patch));
  };
  return [settings, update, loaded];
}
