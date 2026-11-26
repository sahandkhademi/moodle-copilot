// Typed access to Moodle on top of a session, with a 60 s in-memory cache per call.
import { MoodleAuthError } from './errors';
import { looksLikeLoginPage, unwrapAjax } from './parseAjax';
import { openSession, type MoodleSession } from './session';

const TTL_MS = 60_000;

export class MoodleClient {
  private cache = new Map<string, { t: number; p: Promise<unknown> }>();
  private sessionP: { t: number; p: Promise<MoodleSession> } | null = null;

  constructor(readonly baseUrl: string) {}

  /** Memoizes a promise-returning fn for 60 s; failures are not cached. */
  cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.t < TTL_MS) return hit.p as Promise<T>;
    const p = fn();
    this.cache.set(key, { t: Date.now(), p });
    p.catch(() => this.cache.delete(key));
    return p;
  }

  private session(): Promise<MoodleSession> {
    if (!this.sessionP || Date.now() - this.sessionP.t > TTL_MS) {
      const p = openSession(this.baseUrl);
      this.sessionP = { t: Date.now(), p };
      p.catch(() => (this.sessionP = null));
    }
    return this.sessionP.p;
  }

  /** Calls a Moodle AJAX web service method (the same endpoint Moodle's own UI uses). */
  callAjax<T>(methodname: string, args: Record<string, unknown>): Promise<T> {
    return this.cached(`ajax:${methodname}:${JSON.stringify(args)}`, async () => {
      const s = await this.session();
      const url = `${this.baseUrl}/lib/ajax/service.php?sesskey=${encodeURIComponent(s.sesskey)}&info=${encodeURIComponent(methodname)}`;
      const r = await s.fetchText(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      });
      if (r.status === 403 || looksLikeLoginPage(r.url, r.text)) throw new MoodleAuthError();
      let json: unknown;
      try {
        json = JSON.parse(r.text);
      } catch {
        throw new Error(`${methodname}: keine JSON-Antwort (HTTP ${r.status})`);
      }
      return unwrapAjax<T>(json);
    });
  }

  /** GETs a Moodle page and returns its HTML. Throws MoodleAuthError when redirected to the login. */
  getHtml(path: string): Promise<string> {
    return this.cached(`html:${path}`, async () => {
      const s = await this.session();
      const r = await s.fetchText(`${this.baseUrl}${path}`);
      if (looksLikeLoginPage(r.url, r.text)) throw new MoodleAuthError();
      if (r.status >= 400) throw new Error(`${path}: HTTP ${r.status}`);
      return r.text;
    });
  }
}
