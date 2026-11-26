import { useEffect, useState } from 'react';
import ChatView from '@/components/chat/ChatView';
import DashboardView from '@/components/dashboard/DashboardView';
import SettingsView from '@/components/settings/SettingsView';
import { useSettings } from '@/lib/settings';
import { getItem, KEYS, watchItem, type FocusRequest } from '@/lib/storage';

type Tab = FocusRequest['tab'];

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'dashboard', label: 'Dashboard', icon: '📅' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const [settings] = useSettings();
  const [tab, setTab] = useState<Tab>('chat');
  const [focus, setFocus] = useState<FocusRequest | null>(null);

  // Dark mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.darkMode === 'dark' || (settings.darkMode === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.darkMode]);

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">M</div>
          <span className="font-semibold tracking-tight">Moodle Copilot</span>
        </div>
        {settings.mockMode && (
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-500">
            Demo data
          </span>
        )}
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

      <nav className="grid grid-cols-3 border-t border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
              tab === t.id ? 'text-brand-600 dark:text-brand-500' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
