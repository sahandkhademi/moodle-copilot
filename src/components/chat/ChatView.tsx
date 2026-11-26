// AI chat (plan 2.1), Google confirmation card (3.3), voice (4.3).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ConfirmGoogleSync } from '@/components/google/ConfirmGoogleSync';
import { friendlyError, runTurn, type History } from '@/lib/ai/chat';
import { TOOL_HINTS, type ToolName } from '@/lib/ai/tools';
import type { SyncItem, SyncOptions, SyncResult } from '@/lib/google/sync';
import { useSettings } from '@/lib/settings';
import type { FocusRequest } from '@/lib/storage';
import Markdown from './Markdown';
import { useReadAloud, useVoiceInput } from './useVoice';

interface Proposal {
  id: string;
  items: SyncItem[];
  options: SyncOptions;
  note?: string;
}
interface UiMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** user messages: history length before this turn (for retry). */
  histLen?: number;
  tools?: ToolName[];
  proposals?: Proposal[];
  error?: string;
  pendingTool?: boolean;
}

const T = {
  de: {
    hello: 'Hallo! Was möchtest du wissen?',
    sub: 'Ich schaue in deine Noten, Fristen und Anwesenheit.',
    chips: [
      'Wie lief mein letzter Logik-Test?',
      'Was ist diese Woche fällig?',
      'Was brauche ich bei der Logik-Prüfung für einen 2er?',
      'Bin ich irgendwo bei den Fehlstunden gefährdet?',
    ],
    placeholder: 'Frag mich etwas…',
    listening: 'Ich höre zu…',
    noKeyTitle: 'Claude-API-Key fehlt',
    noKeyBody: 'Füge deinen API-Key in den Einstellungen ein, dann kann es losgehen.',
    noKeyBtn: 'Einstellungen öffnen',
    retry: 'Nochmal versuchen',
    clear: 'Chat leeren',
    send: 'Senden',
    mic: 'Spracheingabe',
    micDenied: 'Mikrofon freigeben: Ich habe dafür einen Tab geöffnet. Danach nochmal tippen.',
    stop: 'Vorlesen stoppen',
    added: (n: number, cal: boolean, tasks: boolean) =>
      `✓ ${n} ${n === 1 ? 'Frist' : 'Fristen'} zu ${cal && tasks ? 'Google Kalender und Aufgaben' : cal ? 'Google Kalender' : 'Google Aufgaben'} hinzugefügt.`,
    addFailed: 'Das Hinzufügen zu Google hat nicht geklappt.',
  },
  en: {
    hello: 'Hi! What would you like to know?',
    sub: 'I can look into your grades, deadlines and attendance.',
    chips: [
      'How did my last Logic test go?',
      "What's due this week?",
      'What do I need on the Logic exam for a 2?',
      'Am I at risk anywhere on absences?',
    ],
    placeholder: 'Ask me anything…',
    listening: 'Listening…',
    noKeyTitle: 'Claude API key missing',
    noKeyBody: 'Add your API key in Settings and you are good to go.',
    noKeyBtn: 'Open Settings',
    retry: 'Try again',
    clear: 'Clear chat',
    send: 'Send',
    mic: 'Voice input',
    micDenied: 'Allow the microphone: I opened a tab for that. Then tap the mic again.',
    stop: 'Stop reading aloud',
    added: (n: number, cal: boolean, tasks: boolean) =>
      `✓ Added ${n} ${n === 1 ? 'deadline' : 'deadlines'} to ${cal && tasks ? 'Google Calendar and Tasks' : cal ? 'Google Calendar' : 'Google Tasks'}.`,
    addFailed: 'Adding to Google did not work.',
  },
};

export default function ChatView({ focus, onNavigate }: { focus: FocusRequest | null; onNavigate: (tab: FocusRequest['tab']) => void }) {
  const [settings, , loaded] = useSettings();
  const t = T[settings.language] ?? T.de;
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<History>([]);
  const busyRef = useRef(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusAt = useRef(0);
  const readAloud = useReadAloud(settings.language);
  const hasKey = !!settings.anthropicApiKey;

  const patch = useCallback((id: number, fn: (m: UiMessage) => UiMessage) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const runAssistant = useCallback(
    async (aid: number, histLen: number) => {
      busyRef.current = true;
      setBusy(true);
      readAloud.stop();
      try {
        const text = await runTurn(historyRef.current, {
          onText: (d) => patch(aid, (m) => ({ ...m, text: m.text + d, pendingTool: false })),
          onToolStart: (name) =>
            patch(aid, (m) => ({ ...m, pendingTool: true, tools: m.tools?.includes(name) ? m.tools : [...(m.tools ?? []), name] })),
          onToolResult: (name, out) =>
            patch(aid, (m) => ({
              ...m,
              pendingTool: false,
              proposals:
                name === 'propose_google_sync' && out.syncProposal
                  ? [...(m.proposals ?? []), { id: `${aid}-${(m.proposals?.length ?? 0) + 1}`, ...out.syncProposal }]
                  : m.proposals,
            })),
        });
        if (settings.voiceReadAloud && text.trim()) readAloud.speak(text);
      } catch (e) {
        console.warn('[chat] turn failed', e);
        historyRef.current.length = histLen; // drop half-finished turn so the next request stays valid
        patch(aid, (m) => ({ ...m, pendingTool: false, error: friendlyError(e, settings.language) }));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [patch, readAloud, settings.language, settings.voiceReadAloud],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current || !hasKey) return;
      const histLen = historyRef.current.length;
      historyRef.current.push({ role: 'user', content: text });
      const uid = idRef.current++;
      const aid = idRef.current++;
      stickRef.current = true;
      setMessages((ms) => [...ms, { id: uid, role: 'user', text, histLen }, { id: aid, role: 'assistant', text: '', tools: [] }]);
      setInput('');
      void runAssistant(aid, histLen);
    },
    [hasKey, runAssistant],
  );
  const sendRef = useRef(send);
  sendRef.current = send;

  const retry = useCallback(
    (aid: number) => {
      if (busyRef.current) return;
      const idx = messages.findIndex((m) => m.id === aid);
      const user = messages[idx - 1];
      if (!user || user.role !== 'user') return;
      historyRef.current.length = user.histLen ?? 0;
      historyRef.current.push({ role: 'user', content: user.text });
      patch(aid, (m) => ({ ...m, text: '', tools: [], proposals: [], error: undefined }));
      stickRef.current = true;
      void runAssistant(aid, user.histLen ?? 0);
    },
    [messages, patch, runAssistant],
  );

  const clear = () => {
    if (busyRef.current) return;
    historyRef.current = [];
    setMessages([]);
    readAloud.stop();
  };

  // Voice
  const voice = useVoiceInput({
    lang: settings.language,
    onInterim: (txt) => setInput(txt),
    onFinal: (txt) => sendRef.current(txt),
  });

  // focus.chatPrompt: send automatically, once per focus.at
  useEffect(() => {
    if (!loaded || !focus?.chatPrompt || focus.at === lastFocusAt.current) return;
    lastFocusAt.current = focus.at;
    sendRef.current(focus.chatPrompt);
  }, [focus, loaded]);

  // Auto-scroll (unless the user scrolled up)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Textarea auto-grow
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [input]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const listening = voice.state === 'listening';
  const empty = messages.length === 0;

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      {/* toolbar */}
      {(!empty || readAloud.speaking) && (
        <div className="flex items-center justify-end gap-2 px-3 pt-2">
          {readAloud.speaking && (
            <button
              onClick={readAloud.stop}
              className="flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-500/20 dark:bg-brand-700/20 dark:text-brand-500"
            >
              <span className="inline-block h-2 w-2 animate-pulse rounded-sm bg-brand-600" />
              {t.stop}
            </button>
          )}
          {!empty && (
            <button
              onClick={clear}
              disabled={busy}
              className="rounded-full px-2.5 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
            >
              🗑️ {t.clear}
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {empty && (
          <div className="flex min-h-full flex-col items-center justify-center gap-5 py-6 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-2xl text-white shadow-lg shadow-brand-500/30">
              💬
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{t.hello}</h2>
              <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">{t.sub}</p>
            </div>
            {!hasKey && loaded ? (
              <div className="w-full rounded-2xl border border-brand-500/30 bg-brand-50 p-4 text-left dark:border-brand-500/30 dark:bg-brand-700/10">
                <div className="text-sm font-semibold">🔑 {t.noKeyTitle}</div>
                <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">{t.noKeyBody}</p>
                <button
                  onClick={() => onNavigate('settings')}
                  className="mt-3 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600"
                >
                  ⚙️ {t.noKeyBtn}
                </button>
              </div>
            ) : (
              <div className="flex w-full flex-col gap-2">
                {t.chips.map((c) => (
                  <button
                    key={c}
                    onClick={() => send(c)}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-[13px] shadow-sm transition-all hover:-translate-y-px hover:border-brand-500/60 hover:shadow-md active:translate-y-0 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/60"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-brand-500 to-brand-600 px-3.5 py-2 text-[13.5px] text-white shadow-sm">
                {m.text}
              </div>
            </div>
          ) : (
            <AssistantBubble key={m.id} m={m} lang={settings.language} t={t} busy={busy} onRetry={() => retry(m.id)} patch={patch} />
          ),
        )}
      </div>

      {/* input */}
      <div className="border-t border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        {voice.state === 'denied' && <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">🎤 {t.micDenied}</p>}
        <div
          className={`flex items-end gap-1.5 rounded-2xl border bg-slate-50 py-1.5 pl-3.5 pr-1.5 transition-colors focus-within:border-brand-500 dark:bg-slate-950 ${
            listening ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-200 dark:border-slate-700'
          }`}
        >
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            disabled={!hasKey && loaded}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={listening ? t.listening : t.placeholder}
            className="max-h-[120px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13.5px] outline-none placeholder:text-slate-400 disabled:opacity-50"
          />
          {voice.supported && (
            <button
              onClick={() => (listening ? voice.stop() : voice.start())}
              disabled={busy}
              title={t.mic}
              aria-label={t.mic}
              className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-base transition-colors disabled:opacity-40 ${
                listening ? 'bg-red-500 text-white' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              {listening && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/60" />}
              <span className="relative">🎤</span>
            </button>
          )}
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim() || (!hasKey && loaded)}
            aria-label={t.send}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500 text-white shadow-sm transition-colors hover:bg-brand-600 disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({
  m,
  lang,
  t,
  busy,
  onRetry,
  patch,
}: {
  m: UiMessage;
  lang: 'de' | 'en';
  t: (typeof T)['de'];
  busy: boolean;
  onRetry: () => void;
  patch: (id: number, fn: (m: UiMessage) => UiMessage) => void;
}) {
  const waiting = busy && !m.error && (m.pendingTool || (!m.text && !m.proposals?.length));
  const onDone = (pid: string) => (results: SyncResult[]) => {
    const ok = results.filter((r) => r.calendar === 'created' || r.calendar === 'exists' || r.tasks === 'created' || r.tasks === 'exists').length;
    patch(m.id, (mm) => ({
      ...mm,
      proposals: mm.proposals?.map((p) => {
        if (p.id !== pid) return p;
        return { ...p, note: ok > 0 ? t.added(ok, p.options.calendar, p.options.tasks) : t.addFailed };
      }),
    }));
  };
  return (
    <div className="flex flex-col items-start gap-1.5">
      {!!m.tools?.length && (
        <div className="flex flex-wrap gap-1 px-1">
          {m.tools.map((n) => (
            <span key={n} className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10.5px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {TOOL_HINTS[n]?.icon ?? '🔧'} {TOOL_HINTS[n]?.[lang] ?? n}
            </span>
          ))}
        </div>
      )}
      {(m.text || waiting) && (
        <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {m.text && <Markdown>{m.text}</Markdown>}
          {waiting && (
            <div className={`flex items-center gap-1 ${m.text ? 'mt-1.5' : ''}`} aria-label="typing">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          )}
        </div>
      )}
      {m.proposals?.map((p) => (
        <div key={p.id} className="w-full max-w-[96%] space-y-1.5">
          <ConfirmGoogleSync items={p.items} defaultOptions={p.options} onDone={onDone(p.id)} />
          {p.note && <p className="px-1 text-[12.5px] font-medium text-emerald-700 dark:text-emerald-400">{p.note}</p>}
        </div>
      ))}
      {m.error && (
        <div className="flex max-w-[92%] items-center gap-2 rounded-2xl rounded-bl-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span>⚠️ {m.error}</span>
          <button onClick={onRetry} disabled={busy} className="shrink-0 rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {t.retry}
          </button>
        </div>
      )}
    </div>
  );
}
