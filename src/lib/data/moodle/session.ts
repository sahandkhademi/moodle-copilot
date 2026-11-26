// Gets an authenticated "fetch" for the student's Moodle session.
// 1. Preferred: run fetch inside an open Moodle tab (same origin, cookie + M.cfg.sesskey).
// 2. Fallback: fetch from the extension page with credentials: 'include' and read the sesskey from /my/.
import { MoodleAuthError } from './errors';
import { looksLikeLoginPage, parseSesskey, parseUserId } from './parseAjax';

export interface FetchResult {
  status: number;
  url: string;
  text: string;
}
export interface FetchInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}
export interface MoodleSession {
  sesskey: string;
  userId: number | null;
  via: 'tab' | 'extension';
  fetchText(url: string, init?: FetchInit): Promise<FetchResult>;
}

async function extensionFetch(url: string, init?: FetchInit): Promise<FetchResult> {
  const r = await fetch(url, { ...init, credentials: 'include' });
  return { status: r.status, url: r.url, text: await r.text() };
}

// Runs inside the Moodle page (serialized by chrome.scripting, so it must be self-contained).
async function pageFetch(url: string, init: FetchInit | null): Promise<FetchResult> {
  const r = await fetch(url, { ...(init ?? {}), credentials: 'same-origin' });
  return { status: r.status, url: r.url, text: await r.text() };
}
function pageInfo(): { sesskey: string | null; userId: number | null } {
  const cfg = (window as unknown as { M?: { cfg?: { sesskey?: string; userId?: number } } }).M?.cfg;
  return { sesskey: cfg?.sesskey ?? null, userId: cfg?.userId ?? null };
}

async function findMoodleTab(baseUrl: string): Promise<number | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.scripting?.executeScript) return null;
  try {
    const tabs = await chrome.tabs.query({ url: `${baseUrl}/*` });
    const usable = tabs.filter((t) => t.id != null && !t.discarded && t.status !== 'unloaded');
    // Prefer the active/most recent one.
    usable.sort((a, b) => Number(!!b.active) - Number(!!a.active));
    return usable[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function tabSession(tabId: number): Promise<MoodleSession | null> {
  try {
    const [info] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageInfo });
    const { sesskey, userId } = info?.result ?? { sesskey: null, userId: null };
    if (!sesskey) return null; // not a Moodle page (error page, still loading)
    if (!userId) throw new MoodleAuthError();
    return {
      sesskey,
      userId,
      via: 'tab',
      async fetchText(url, init) {
        const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageFetch, args: [url, init ?? null] });
        if (!res?.result) throw new Error('Moodle-Tab hat nicht geantwortet');
        return res.result;
      },
    };
  } catch (e) {
    if (e instanceof MoodleAuthError) throw e;
    return null; // no permission / tab closed: use the fallback
  }
}

async function extensionSession(baseUrl: string): Promise<MoodleSession> {
  let res: FetchResult;
  try {
    res = await extensionFetch(`${baseUrl}/my/`);
  } catch (e) {
    throw new Error(`Moodle nicht erreichbar (${baseUrl}): ${e instanceof Error ? e.message : e}`);
  }
  if (looksLikeLoginPage(res.url, res.text)) throw new MoodleAuthError();
  const sesskey = parseSesskey(res.text);
  if (!sesskey) throw new MoodleAuthError('Kein Moodle-Sesskey gefunden. Bitte in Moodle einloggen');
  return { sesskey, userId: parseUserId(res.text), via: 'extension', fetchText: extensionFetch };
}

export async function openSession(baseUrl: string): Promise<MoodleSession> {
  const tabId = await findMoodleTab(baseUrl);
  if (tabId != null) {
    const s = await tabSession(tabId);
    if (s) return s;
  }
  return extensionSession(baseUrl);
}
