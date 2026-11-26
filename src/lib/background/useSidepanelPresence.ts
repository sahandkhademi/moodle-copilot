// Called once by the side panel App. While the panel is open and visible, unseen grades count as
// seen: clear them (after a short delay so the badge visibly clears) and refresh the badge.
import { useEffect } from 'react';
import { getItem, KEYS, setItem, watchItem } from '../storage';

export function useSidepanelPresence(): void {
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      try {
        chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
      } catch {
        /* ignore */
      }
    };

    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const unseen = await getItem<string[]>(KEYS.unseenGrades, []);
          if (unseen.length > 0 && document.visibilityState === 'visible') await setItem(KEYS.unseenGrades, []);
        } catch {
          /* ignore */
        }
        refresh();
      }, 1500);
    };

    try {
      chrome.runtime.connect({ name: 'sidepanel' });
    } catch {
      /* ignore */
    }
    refresh();
    schedule();
    const unwatch = watchItem(KEYS.unseenGrades, (v) => {
      if (Array.isArray(v) && v.length > 0) schedule();
    });
    document.addEventListener('visibilitychange', schedule);
    return () => {
      clearTimeout(timer);
      unwatch();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, []);
}
