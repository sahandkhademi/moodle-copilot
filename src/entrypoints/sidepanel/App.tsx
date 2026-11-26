import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import ChatView from '@/components/chat/ChatView';
import DashboardView from '@/components/dashboard/DashboardView';
import SettingsView from '@/components/settings/SettingsView';
import { useSettings } from '@/lib/settings';
import { useSidepanelPresence } from '@/lib/background/useSidepanelPresence';
import { getItem, KEYS, watchItem, type FocusRequest } from '@/lib/storage';

type Tab = FocusRequest['tab'];

// Moodle-style primary navigation (like "Home  Dashboard  My courses" in the top bar).
const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Assistant' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
];

/** Wordmark in Moodle's style: bold, black, all caps. */
function Wordmark() {
  return (
    <div className="flex items-baseline gap-1.5 select-none">
      <span className="text-[1.35rem] font-black uppercase leading-none tracking-tight text-ink">Moodle</span>
      <span className="text-[0.95rem] font-semibold leading-none text-brand-500">Copilot</span>
    </div>
  );
}

export default function App() {
  const [settings] = useSettings();
  useSidepanelPresence();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [unseen, setUnseen] = useState(0);

  // Focus requests (e.g. clicking a "new grade" notification opens the right tab)
  useEffect(() => {
    const handle = (f: unknown) => {
      const req = f as FocusRequest | undefined;
      if (!req || Date.now() - req.at > 60_000) return;
      setTab(req.tab);
      setFocus(req);
    };
    getItem<FocusRequest | undefined>(KEYS.focus, undefined).then(handle);
    return watchItem(KEYS.focus, handle);
  }, []);

  useEffect(() => {
    const apply = (v: unknown) => setUnseen(Array.isArray(v) ? v.length : 0);
    getItem<string[]>(KEYS.unseenGrades, []).then(apply);
    return watchItem(KEYS.unseenGrades, apply);
  }, []);

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="border-b border-line bg-surface shadow-[0_2px_4px_rgba(0,0,0,0.08)]">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <Wordmark />
          <div className="flex items-center gap-3">
            {settings.mockMode && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">Demo data</span>}
            <button className="relative text-ink" title="Notifications" onClick={() => setTab('dashboard')}>
              <Bell className="h-5 w-5" strokeWidth={2} />
              {unseen > 0 && (
                <span className="absolute -right-2 -top-1.5 rounded-sm bg-danger px-1 text-[0.65rem] font-bold leading-4 text-white">{unseen}</span>
              )}
            </button>
          </div>
        </div>
        <nav className="flex gap-1 px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-2.5 py-2.5 text-[0.9375rem] font-semibold transition-colors ${
                tab === t.id ? 'text-ink' : 'text-ink/80 hover:text-ink'
              }`}
            >
              {t.label}
              {tab === t.id && <span className="absolute inset-x-1.5 bottom-0 h-[3px] bg-brand-500" />}
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {/* Keep views mounted so chat history survives tab switches */}
        <div className={tab === 'chat' ? 'h-full' : 'hidden'}>
          <ChatView focus={focus?.tab === 'chat' ? focus : null} onNavigate={setTab} />
        </div>
        <div className={tab === 'dashboard' ? 'h-full overflow-y-auto' : 'hidden'}>
          <DashboardView focus={focus?.tab === 'dashboard' ? focus : null} onNavigate={setTab} />
        </div>
        <div className={tab === 'settings' ? 'h-full overflow-y-auto' : 'hidden'}>
          <SettingsView />
        </div>
      </main>
    </div>
  );
}
