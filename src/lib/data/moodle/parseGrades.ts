// Parses the HTML of grade/report/user/index.php?id=<courseId> (Moodle 4.x, German or English).
import type { GradeItem, GradeItemKind } from '../../types';
import { absUrl, clean, parseHtml, parseNum } from './util';

/** Name keywords win ("Test 2" stays a test even if it is an assign module); the module type is the fallback. */
export function kindFrom(name: string, modname?: string | null): GradeItemKind {
  const k = kindFromName(name);
  if (k !== 'other' && k !== 'assignment') return k;
  if (modname === 'quiz') return 'quiz';
  if (modname === 'assign') return 'assignment';
  return k;
}

export function kindFromName(name: string): GradeItemKind {
  if (/pr(ü|ue|u)fung|klausur|\bexam\b|abschluss|matura/i.test(name)) return 'exam';
  if (/\bquiz\b/i.test(name)) return 'quiz';
  if (/\btest\b|schularbeit/i.test(name)) return 'test';
  if (/haus(ü|ue|u)bung|(ü|ue)bung|homework|hausaufgabe/i.test(name)) return 'homework';
  if (/projekt|aufgabe|assignment|abgabe|presentation|essay/i.test(name)) return 'assignment';
  return 'other';
}

/**
 * Normalizes weights to sum 1. Missing (NaN) weights get the mean of the known ones.
 * If no weight is known at all (JKU shows "-"), weight by max points, like Moodle's default "Natural" aggregation.
 */
export function normalizeWeights(items: GradeItem[]): GradeItem[] {
  if (!items.length) return items;
  const ok = (w: number) => Number.isFinite(w) && w >= 0;
  const known = items.filter((i) => ok(i.weight) && i.weight > 0);
  const fallback = known.length ? known.reduce((s, i) => s + i.weight, 0) / known.length : 1;
  const raw = items.map((i) => (known.length ? (ok(i.weight) ? i.weight : fallback) : Math.max(i.maxScore, 0)));
  const sum = raw.reduce((s, w) => s + w, 0) || 1;
  return items.map((i, idx) => ({ ...i, weight: raw[idx]! / sum }));
}

function cellText(row: Element, ...classes: string[]): string {
  for (const c of classes) {
    const el = row.querySelector(`.column-${c}`);
    if (el) return clean(el.textContent);
  }
  return '';
}

export function parseGradeReportHtml(html: string, courseId: number, baseUrl: string): GradeItem[] {
  const doc = parseHtml(html);
  const table = doc.querySelector('table.user-grade') ?? doc.querySelector('table[class*="user-grade"]');
  if (!table) return [];
  const items: GradeItem[] = [];
  let n = 0;
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    const th = row.querySelector('.column-itemname');
    if (!th || th.closest('thead') || th.getAttribute('scope') === 'col') continue;
    const cls = `${row.className} ${th.className}`;
    // Skip category headers and totals (Kursgesamtsumme / Kategoriesumme).
    if (/\b(category|courseitem|categoryitem|baggt)\b/.test(cls)) continue;
    const link = th.querySelector('a.gradeitemheader, a');
    if (!link && /gesamt|summe|total/i.test(clean(th.textContent))) continue;
    const name = clean(link?.textContent || th.textContent);
    if (!name) continue;
    const gradeTxt = cellText(row, 'grade');
    const rangeTxt = cellText(row, 'range');
    const range = rangeTxt.match(/([\d.,]+)\s*[–—-]\s*([\d.,]+)/);
    const maxScore = (range ? parseNum(range[2]) : null) ?? 100;
    const score = /\d/.test(gradeTxt) ? parseNum(gradeTxt.split(/\s/)[0]) : null;
    const wTxt = cellText(row, 'weight', 'calculatedweight');
    const weight = /\d/.test(wTxt) ? (parseNum(wTxt) ?? NaN) : NaN;
    const href = link?.getAttribute('href');
    const modMatch = href?.match(/\/mod\/(\w+)\//)?.[1];
    const kind = kindFrom(name, modMatch);
    const feedback = cellText(row, 'feedback');
    const item: GradeItem = {
      // JKU puts the stable row id on the <th> (row_<itemid>_<userid>); a counter would shift when items are added.
      id: `mdl-g-${courseId}-${row.id || th.id || `n${++n}`}`,
      courseId,
      name,
      kind,
      score,
      maxScore,
      weight,
      url: absUrl(href, baseUrl),
    };
    if (feedback) item.feedback = feedback;
    items.push(item);
  }
  return normalizeWeights(items);
}
