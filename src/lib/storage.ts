// Tiny key-value wrapper over chrome.storage.local.
// Falls back to localStorage when chrome.storage is missing, so the side panel
// can also be previewed as a plain web page (e.g. served from .output/).

type Listener = (value: unknown) => void;

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;

export async function getItem<T>(key: string, fallback: T): Promise<T> {
  if (hasChrome) {
    const res = await chrome.storage.local.get(key);
    return (res[key] as T | undefined) ?? fallback;
  }
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  if (hasChrome) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('local-storage', { detail: { key, value } }));
}

/** Calls listener whenever `key` changes (from any extension page). Returns an unsubscribe fn. */
export function watchItem(key: string, listener: Listener): () => void {
  if (hasChrome) {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && key in changes) listener(changes[key]?.newValue);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
  const handler = (e: Event) => {
    const { detail } = e as CustomEvent<{ key: string; value: unknown }>;
    if (detail.key === key) listener(detail.value);
  };
  window.addEventListener('local-storage', handler);
  return () => window.removeEventListener('local-storage', handler);
}

/** Storage keys shared across features. Add new keys here (on main) to avoid collisions. */
export const KEYS = {
  settings: 'settings',
  /** UI focus request, e.g. a notification click asking the side panel to show a grade. */
  focus: 'ui.focus',
  /** Grade items "revealed" by the demo's simulate-new-grade button (mock mode only). */
  mockExtraGrades: 'mock.extraGrades',
  /** Deadline IDs already synced to Google: Record<deadlineId, { calendar?: boolean; tasks?: boolean }> */
  googleSynced: 'google.synced',
  /** Deadline IDs the user ticked off locally. */
  doneDeadlines: 'dashboard.done',
  /** Last-seen grades snapshot for new-grade detection. */
  gradeSnapshot: 'bg.gradeSnapshot',
  /** Grade IDs the user hasn't looked at yet (drives the red badge). */
  unseenGrades: 'bg.unseenGrades',
} as const;

export interface FocusRequest {
  tab: 'chat' | 'dashboard' | 'settings';
  courseId?: number;
  gradeId?: string;
  /** Pre-fill (and send) a chat message. */
  chatPrompt?: string;
  at: number; // Date.now(), so repeated requests still trigger
}
