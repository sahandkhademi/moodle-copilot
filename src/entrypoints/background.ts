import { KEYS, setItem, type FocusRequest } from '@/lib/storage';
import { queueCheck, updateBadge } from '@/lib/background/check';
import { parseNoticeId } from '@/lib/background/logic';

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  // Feature 4.4: alarms, notifications, badge. All listeners are registered synchronously.
  const ensureAlarm = () => {
    try {
      chrome.alarms.create('check', { periodInMinutes: 15 });
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
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
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
