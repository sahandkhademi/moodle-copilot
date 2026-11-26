import { getItem, KEYS, setItem, type FocusRequest } from '@/lib/storage';
import { queueCheck, updateBadge } from '@/lib/background/check';
import { parseNoticeId } from '@/lib/background/logic';
import { getSettings } from '@/lib/settings';
import { getData } from '@/lib/data';
import { buildBriefing } from '@/lib/briefing';
import { prewarmGoogle, syncToGoogle, undoGoogle } from '@/lib/google/sync';
import type { BridgeMessage } from '@/lib/inpage/bridge';

const BRIEFING_HOUR = 7;
const BRIEFING_MINUTE = 30;

/** Next 07:30 local time, as epoch ms. */
function nextBriefingTime(now = new Date()): number {
  const t = new Date(now);
  t.setHours(BRIEFING_HOUR, BRIEFING_MINUTE, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

/** Daily briefing as a Chrome notification ("You're good to go. …"). */
async function sendBriefing(): Promise<void> {
  try {
    const settings = await getSettings();
    const src = await getData();
    const [courses, deadlines, grades, attendance] = await Promise.all([src.getCourses(), src.getDeadlines(), src.getGrades(), src.getAttendance()]);
    const doneRaw = await getItem<string[] | Record<string, unknown>>(KEYS.doneDeadlines, []);
    const b = buildBriefing(
      { courses, deadlines, grades, attendance, doneIds: Array.isArray(doneRaw) ? doneRaw : Object.keys(doneRaw), unseenGradeIds: await getItem<string[]>(KEYS.unseenGrades, []) },
      settings,
    );
    await chrome.notifications.clear('briefing');
    chrome.notifications.create('briefing', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png' as never),
      title: `Good morning · ${b.headline}`,
      message: b.text,
      priority: 1,
    });
  } catch (e) {
    console.warn('[bg] briefing failed', e);
  }
}

/** Shows the Moodle Dashboard (reuses an open tab). Used when Copilot lives inside Moodle. */
async function openMoodleDashboard(moodleUrl: string): Promise<void> {
  const url = `${moodleUrl.replace(/\/$/, '')}/my/`;
  const [tab] = await chrome.tabs.query({ url: `${moodleUrl.replace(/\/$/, '')}/my/*` });
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.reload(tab.id);
  } else {
    await chrome.tabs.create({ url });
  }
}

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  // Feature 4.4: alarms, notifications, badge. All listeners are registered synchronously.
  const ensureAlarm = () => {
    try {
      chrome.alarms.create('check', { periodInMinutes: 15 });
      chrome.alarms.create('briefing', { when: nextBriefingTime(), periodInMinutes: 24 * 60 });
    } catch (e) {
      console.warn('[bg] alarm failed', e);
    }
  };

  chrome.runtime.onInstalled.addListener(() => {
    ensureAlarm();
    void queueCheck();
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureAlarm();
    void queueCheck();
  });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === 'check') void queueCheck();
    if (a.name === 'briefing') void sendBriefing();
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      const m = msg as BridgeMessage | { type: 'briefing-now' };
      if (m?.type === 'google-sync') {
        // From the Moodle page: run the sync here (host permissions, no page CORS).
        syncToGoogle(m.items, m.opts).then(sendResponse, (e) => sendResponse(m.items.map((i) => ({ deadlineId: i.deadline.id, calendar: 'failed', tasks: 'failed', error: String(e) }))));
        return true;
      }
      if (m?.type === 'google-undo') {
        undoGoogle(m.deadlineIds).then(sendResponse, (e) => sendResponse(m.deadlineIds.map((id) => ({ deadlineId: id, ok: false, error: String(e) }))));
        return true;
      }
      if (m?.type === 'google-prewarm') {
        void prewarmGoogle().finally(() => sendResponse({ ok: true }));
        return true;
      }
      if (m?.type === 'open-panel') {
        // Open first, while the click's user gesture is still valid; then hand the question to the Assistant.
        const windowId = sender.tab?.windowId;
        if (windowId != null) chrome.sidePanel.open({ windowId }).catch((e) => console.log('[bg] sidePanel.open failed', e));
        if (m.prompt) void setItem(KEYS.focus, { tab: 'chat', chatPrompt: m.prompt, at: Date.now() } satisfies FocusRequest);
        sendResponse({ ok: true });
        return false;
      }
      if (m?.type === 'briefing-now') {
        void sendBriefing().then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg?.type === 'check-now') {
        queueCheck({ silent: !!msg.silent }).then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg?.type === 'refresh-badge') {
        void updateBadge().then(() => sendResponse({ ok: true }));
        return true;
      }
    } catch (e) {
      console.warn('[bg] message failed', e);
    }
    return false;
  });

  // Badge follows the keys it depends on.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (KEYS.unseenGrades in changes || KEYS.doneDeadlines in changes)) void updateBadge();
  });

  chrome.notifications.onClicked.addListener(async (id) => {
    try {
      const settings = await getSettings();
      // Copilot lives inside Moodle: show the Moodle Dashboard (the grades block scrolls to the course).
      if (settings.showInMoodle && settings.moodleUrl) {
        const target = id === 'briefing' ? null : parseNoticeId(id);
        if (target) await setItem(KEYS.focus, { tab: 'dashboard', courseId: target.courseId, gradeId: target.gradeId, at: Date.now() } satisfies FocusRequest);
        await openMoodleDashboard(settings.moodleUrl);
        chrome.notifications.clear(id);
        return;
      }
      const target = parseNoticeId(id);
      if (target) {
        const req: FocusRequest = { tab: 'dashboard', courseId: target.courseId, at: Date.now() };
        if (target.gradeId) req.gradeId = target.gradeId;
        await setItem(KEYS.focus, req);
      }
      try {
        const win = await chrome.windows.getLastFocused();
        if (win.id != null) await chrome.sidePanel.open({ windowId: win.id });
      } catch (e) {
        // User-gesture rules: the focus request is applied when the panel is opened manually.
        console.log('[bg] sidePanel.open failed, focus request saved', e);
      }
      chrome.notifications.clear(id);
    } catch (e) {
      console.warn('[bg] click failed', e);
    }
  });

  void updateBadge();
});
