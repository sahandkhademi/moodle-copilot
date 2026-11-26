// Small pure helpers shared by the parsers.

/** "18,00" / "1.234,5" / "18.5" → number. Returns null if not numeric. */
export function parseNum(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d.,\-]/g, '');
  if (!/\d/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function absUrl(href: string | null | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, baseUrl.replace(/\/?$/, '/')).toString();
  } catch {
    return undefined;
  }
}

export const EXAM_RE = /pr(ü|ue|u)fung|klausur|\bexam\b|\btest\b|\bschularbeit\b|\bmatura\b/i;
