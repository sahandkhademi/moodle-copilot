// The periodic check: fetch data, diff against snapshots, notify, update badge.
// Runs in the service worker (no DOM). Everything is wrapped so it can never throw.
import { getData } from '../data';
import { getSettings } from '../settings';
import { getItem, KEYS, setItem } from '../storage';
import {
  absenceNotices,
  computeBadge,
  diffGrades,
  gradeNotice,
  makeAbsenceSnapshot,
  makeGradeSnapshot,
  type AbsenceSnapshot,
  type GradeSnapshot,
  type Notice,
} from './logic';

/** Last absence state per course (background-only key). */
export const ABSENCE_KEY = 'bg.absenceState';

function notify(n: Notice) {
  try {
    chrome.notifications.create(n.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png' as never),
      title: n.title,
      message: n.message,
      priority: 2,
    });
  } catch (err) {
    console.warn('[bg] notification failed', err);
  }
}

export async function updateBadge(): Promise<void> {
  try {
    const unseen = await getItem<string[]>(KEYS.unseenGrades, []);
    let deadlines: Awaited<ReturnType<Awaited<ReturnType<typeof getData>>['getDeadlines']>> = [];
    if (unseen.length === 0) deadlines = await (await getData()).getDeadlines();
    const done = await getItem<Record<string, unknown> | string[]>(KEYS.doneDeadlines, {});
    const b = computeBadge(unseen, deadlines, done);
    await chrome.action.setBadgeBackgroundColor({ color: b.color });
    await chrome.action.setBadgeText({ text: b.text });
  } catch (err) {
    console.warn('[bg] badge failed', err);
  }
}

/** silent = record snapshots only, never notify (first run, demo reset). */
export async function runCheck(opts: { silent?: boolean } = {}): Promise<void> {
  try {
    const [data, settings] = await Promise.all([getData(), getSettings()]);
    const [grades, courses, attendance] = await Promise.all([data.getGrades(), data.getCourses(), data.getAttendance()]);

    const prevGrades = (await getItem<GradeSnapshot | null>(KEYS.gradeSnapshot, null)) ?? null;
    const prevAbsence = (await getItem<AbsenceSnapshot | null>(ABSENCE_KEY, null)) ?? null;

    const fresh = opts.silent ? [] : diffGrades(prevGrades, grades);
    const absence = opts.silent ? [] : absenceNotices(prevAbsence, attendance, courses, settings.absenceLimit, settings.language);

    // Save snapshots first so a crash while notifying can't cause duplicate notifications later.
    await setItem(KEYS.gradeSnapshot, makeGradeSnapshot(grades));
    await setItem(ABSENCE_KEY, makeAbsenceSnapshot(attendance, settings.absenceLimit));

    if (fresh.length) {
      const unseen = await getItem<string[]>(KEYS.unseenGrades, []);
      const merged = [...new Set([...unseen, ...fresh.map((g) => g.id)])];
      await setItem(KEYS.unseenGrades, merged);
    }
    for (const g of fresh) {
      notify(gradeNotice(g, courses.find((c) => c.id === g.courseId), settings.gradeCutoffs, settings.language));
    }
    for (const n of absence) notify(n);
  } catch (err) {
    console.warn('[bg] check failed', err);
  }
  await updateBadge();
}

// Serialize checks so rapid demo clicks can't race on the snapshots.
let chain: Promise<void> = Promise.resolve();
export function queueCheck(opts: { silent?: boolean } = {}): Promise<void> {
  chain = chain.then(() => runCheck(opts)).catch(() => {});
  return chain;
}
