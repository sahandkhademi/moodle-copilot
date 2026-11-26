// Mounts the Copilot widgets into Moodle's own Dashboard (/my/). Called by the content script.
import { createRoot, type Root } from 'react-dom/client';
import { BriefingCard, GradesBlock, TimelineGoogleButton, TimelineSyncAll, type MoodleData } from '@/components/inpage/InMoodle';
import { getData } from '../data';
import { getSettings, type Settings } from '../settings';
import { getItem, KEYS, watchItem, type FocusRequest } from '../storage';
import { activityKey } from './match';
import type { Deadline } from '../types';

const MARK = 'data-copilot';

function injectStyles() {
  if (document.getElementById('copilot-styles')) return;
  const style = document.createElement('style');
  style.id = 'copilot-styles';
  // Only what Moodle's own CSS doesn't have.
  style.textContent = `@keyframes copilot-spin{to{transform:rotate(360deg)}}.copilot-spin{animation:copilot-spin 1s linear infinite}`;
  document.head.appendChild(style);
}

async function loadData(): Promise<MoodleData> {
  const src = await getData();
  const [courses, deadlines, grades, attendance] = await Promise.all([
    src.getCourses(),
    src.getDeadlines(),
    src.getGrades(),
    src.getAttendance(),
  ]);
  const doneRaw = await getItem<string[] | Record<string, unknown>>(KEYS.doneDeadlines, []);
  return {
    courses,
    deadlines,
    grades,
    attendance,
    doneIds: Array.isArray(doneRaw) ? doneRaw : Object.keys(doneRaw),
    unseenGradeIds: await getItem<string[]>(KEYS.unseenGrades, []),
    synced: await getItem(KEYS.googleSynced, {}),
  };
}

function rootIn(el: Element, roots: Root[]): Root {
  const r = createRoot(el);
  roots.push(r);
  return r;
}

/** True if this page is a Moodle Dashboard we should enhance. */
export async function shouldMount(settings: Settings): Promise<boolean> {
  if (!settings.showInMoodle) return false;
  if (document.body?.id !== 'page-my-index') return false; // Moodle's Dashboard page
  if (settings.moodleUrl) {
    try {
      if (new URL(settings.moodleUrl).origin !== location.origin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function mountCopilot(): Promise<() => void> {
  injectStyles();
  let settings = await getSettings();
  const roots: Root[] = [];
  const main = document.querySelector('#region-main') ?? document.body;
  const timeline = document.querySelector('section.block_timeline');

  // 1. Briefing at the top of the Dashboard content.
  const briefingHost = document.createElement('div');
  briefingHost.setAttribute(MARK, 'briefing');
  const firstBlock = main.querySelector('section.block');
  if (firstBlock?.parentElement) firstBlock.parentElement.insertBefore(briefingHost, firstBlock);
  else main.prepend(briefingHost);
  const briefing = rootIn(briefingHost, roots);

  // 2. Grades block right below the Timeline.
  const gradesHost = document.createElement('div');
  gradesHost.setAttribute(MARK, 'grades-host');
  if (timeline?.parentElement) timeline.parentElement.insertBefore(gradesHost, timeline.nextSibling);
  else main.appendChild(gradesHost);
  const grades = rootIn(gradesHost, roots);

  // 3. "Add N to Google" next to the Timeline title.
  let syncAll: Root | null = null;
  const title = timeline?.querySelector('h3.card-title, h5.card-title, .card-title');
  if (title?.parentElement) {
    // Put the title and our button on one flex row: "Timeline ............ [Add N to Google]".
    const row = document.createElement('div');
    row.setAttribute(MARK, 'title-row');
    row.className = 'd-flex align-items-center justify-content-between flex-wrap';
    row.style.gap = '8px';
    title.parentElement.insertBefore(row, title);
    row.appendChild(title);
    const wrap = document.createElement('div');
    wrap.setAttribute(MARK, 'sync-all');
    row.appendChild(wrap);
    syncAll = rootIn(wrap, roots);
  }

  let data: MoodleData | null = null;
  let focusCourseId: number | undefined;
  let disposed = false;
  const render = () => {
    if (disposed) return; // a reload can finish after the setting was switched off
    briefing.render(<BriefingCard data={data} settings={settings} />);
    grades.render(<GradesBlock data={data} settings={settings} focusCourseId={focusCourseId} />);
    if (syncAll && data) {
      const now = Date.now();
      const week = data.deadlines.filter((d) => !d.meeting && !data!.doneIds.includes(d.id) && new Date(d.due).getTime() >= now && new Date(d.due).getTime() - now <= 7 * 86_400_000);
      const items = week.map((deadline) => ({ deadline, course: data!.courses.find((c) => c.id === deadline.courseId) }));
      const syncedCount = week.filter((d) => data!.synced[d.id]?.calendar).length;
      syncAll.render(<TimelineSyncAll items={items} syncedCount={syncedCount} />);
    }
    decorateTimeline();
  };

  // 4. Per-item Google buttons. Moodle renders the Timeline asynchronously (and again on filter changes), so observe it.
  const itemRoots = new WeakMap<Element, Root>();
  const decorateTimeline = () => {
    if (disposed || !timeline || !data) return;
    const byKey = new Map<string, Deadline>();
    for (const d of data.deadlines) {
      const k = activityKey(d.url);
      if (k && !byKey.has(k)) byKey.set(k, d);
    }
    for (const el of Array.from(timeline.querySelectorAll('[data-region="event-list-item"]'))) {
      const link = el.querySelector<HTMLAnchorElement>('.event-name a, a[href*="/mod/"]');
      const d = byKey.get(activityKey(link?.href) ?? '');
      if (!d || d.meeting) continue;
      let host = el.querySelector(`[${MARK}="item"]`);
      if (!host) {
        // Right after the activity name (inside the name row), so it never wraps under the time on JKU.
        const nameRow = el.querySelector('.event-name-container > .d-flex') ?? el.querySelector('.event-name')?.parentElement;
        host = document.createElement('span');
        host.setAttribute(MARK, 'item');
        host.className = 'flex-shrink-0 align-self-start';
        (nameRow ?? el.querySelector('.d-flex.flex-wrap') ?? el).appendChild(host);
      }
      let r = itemRoots.get(host);
      if (!r) {
        r = rootIn(host, roots);
        itemRoots.set(host, r);
      }
      r.render(<TimelineGoogleButton item={{ deadline: d, course: data.courses.find((c) => c.id === d.courseId) }} alreadySynced={!!data.synced[d.id]?.calendar} />);
    }
  };
  let pending = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(pending);
    pending = window.setTimeout(decorateTimeline, 120);
  });
  if (timeline) observer.observe(timeline, { childList: true, subtree: true });

  // A notification click asked to show a course (written by the background before opening this page).
  const focus = await getItem<FocusRequest | undefined>(KEYS.focus, undefined);
  if (focus && Date.now() - focus.at < 60_000 && focus.courseId != null) focusCourseId = focus.courseId;

  render();
  const reload = async () => {
    try {
      settings = await getSettings();
      data = await loadData();
    } catch (e) {
      console.warn('[copilot] could not load Moodle data', e);
    }
    render();
  };
  await reload();

  // Live updates: new grade simulated, deadline done, Google sync from the side panel, settings.
  const unwatch = [KEYS.mockExtraGrades, KEYS.doneDeadlines, KEYS.googleSynced, KEYS.unseenGrades, KEYS.settings].map((k) => watchItem(k, () => void reload()));

  return () => {
    disposed = true;
    window.clearTimeout(pending);
    observer.disconnect();
    unwatch.forEach((u) => u());
    roots.forEach((r) => r.unmount());
    const row = document.querySelector(`[${MARK}="title-row"]`);
    if (row && title) row.parentElement?.insertBefore(title, row);
    document.querySelectorAll(`[${MARK}]`).forEach((n) => n.remove());
  };
}
