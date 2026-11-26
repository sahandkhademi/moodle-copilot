// Parses the mod_attendance student view page (/mod/attendance/view.php?id=<cmid>), German + English labels.
import type { AttendanceRecord, SessionStatus } from '../../types';
import { clean, parseHtml, parseNum } from './util';

const STATUS_PATTERNS: [SessionStatus, RegExp][] = [
  ['excused', /entschuldigt|excused/i],
  ['late', /versp(ä|ae)tet|\blate\b/i],
  ['absent', /fehlend|abwesend|\babsent\b/i],
  ['present', /anwesend|\bpresent\b/i],
];

export function statusFromText(t: string): SessionStatus | null {
  for (const [s, re] of STATUS_PATTERNS) if (re.test(t)) return s;
  return null;
}

function parseDate(t: string): string | null {
  const de = t.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})/);
  if (de) {
    const y = de[3]!.length === 2 ? 2000 + Number(de[3]) : Number(de[3]);
    return new Date(Date.UTC(y, Number(de[2]) - 1, Number(de[1]), 12)).toISOString();
  }
  const d = new Date(t.replace(/\(.*\)/, '').trim());
  return isNaN(d.getTime()) || !/\d{4}/.test(t) ? null : d.toISOString();
}

const TAKEN = /erfasste termine|taken sessions|sessions taken/i;
const TOTAL = /termine gesamt|termine insgesamt|gesamtzahl.*termine|total sessions|sessions in total|number of sessions/i;

export function parseAttendanceHtml(html: string, courseId: number, url?: string): AttendanceRecord | null {
  const doc = parseHtml(html);
  const sessions: { date: string; status: SessionStatus }[] = [];
  let sessionRows = 0;

  // Sessions table: rows with a date in the first cell and a status in another.
  for (const row of Array.from(doc.querySelectorAll('table tr'))) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 3) continue;
    const date = parseDate(clean(cells[0]!.textContent));
    if (!date) continue;
    sessionRows++;
    const status = statusFromText(clean((row.querySelector("td.statuscol") ?? cells[2]!).textContent));
    if (status) sessions.push({ date, status });
  }

  // Summary rows: label + number ("Erfasste Termine 8", "Fehlend 2", ...).
  const labels: [string, number][] = [];
  for (const row of Array.from(doc.querySelectorAll('tr'))) {
    const cells = Array.from(row.querySelectorAll('th, td'));
    if (cells.length !== 2) continue;
    const label = clean(cells[0]!.textContent).replace(/:$/, '');
    const value = clean(cells[1]!.textContent);
    if (!/^\d+([.,]\d+)?$/.test(value)) continue;
    labels.push([label, parseNum(value) ?? NaN]);
  }
  const byLabel = (re: RegExp) => labels.find(([k]) => re.test(k))?.[1];
  const statusCount = (s: SessionStatus) =>
    labels.find(([k]) => statusFromText(k) === s && !TAKEN.test(k) && !TOTAL.test(k))?.[1] ?? sessions.filter((x) => x.status === s).length;

  const heldLabel = byLabel(TAKEN);
  const totalLabel = byLabel(TOTAL);
  if (heldLabel == null && totalLabel == null && sessionRows === 0) return null;

  const absent = statusCount('absent');
  const excused = statusCount('excused');
  const held = heldLabel ?? sessions.length;
  const total = totalLabel ?? (sessionRows || held);

  return {
    courseId,
    totalSessions: Math.max(total, held),
    sessionsHeld: held,
    absences: absent,
    excused,
    sessions: sessions.length ? sessions : undefined,
    url,
  };
}
