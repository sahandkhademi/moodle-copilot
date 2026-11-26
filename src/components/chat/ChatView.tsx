// AI chat (plan 2.1), Google confirmation card (3.3), voice (4.3). Styled like a Moodle drawer.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
  Calculator,
  KeyRound,
  Mic,
  MicOff,
  RotateCcw,
  SendHorizontal,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  UploadCloud,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { ConfirmGoogleSync } from '@/components/google/ConfirmGoogleSync';
import { Block, Button, cx, inputClass } from '@/components/ui/moodle';
import { classifyError, Conversation, friendlyError, prewarm } from '@/lib/ai/chat';
import { TOOL_HINTS, type ToolHintIcon, type ToolName } from '@/lib/ai/tools';
import type { SyncItem, SyncOptions, SyncResult } from '@/lib/google/sync';
import { useSettings } from '@/lib/settings';
import type { FocusRequest } from '@/lib/storage';
import Markdown from './Markdown';
import { BriefingNote } from './BriefingNote';
import { WorkingSteps } from './WorkingSteps';
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
  /** Assistant messages: the user text that triggered them (for retry). */
  prompt?: string;
  tools?: ToolName[];
  proposals?: Proposal[];
  error?: string;
  errorKind?: string;
  pendingTool?: boolean;
}

const HINT_ICONS: Record<ToolHintIcon, LucideIcon> = {
  courses: BookOpen,
  deadlines: CalendarDays,
  grades: BarChart3,
  attendance: UserCheck,
  calc: Calculator,
  sync: UploadCloud,
};

const CHIPS = [
  'How did I do in my last Logic test?',
  "What's due this week?",
  'What do I need on the Logic final to get a 2?',
  'Am I at risk anywhere because of absences?',
];

const addedNote = (n: number, cal: boolean, tasks: boolean) =>
  `Added ${n} ${n === 1 ? 'deadline' : 'deadlines'} to ${cal && tasks ? 'Google Calendar and Tasks' : cal ? 'Google Calendar' : 'Google Tasks'}.`;

export default function ChatView({ focus, onNavigate }: { focus: FocusRequest | null; onNavigate: (tab: FocusRequest['tab']) => void }) {
  const [settings, , loaded] = useSettings();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const convRef = useRef<Conversation | null>(null);
  const busyRef = useRef(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusAt = useRef(0);
  const readAloud = useReadAloud();
  const hasKey = !!settings.geminiApiKey;

  const patch = useCallback((id: number, fn: (m: UiMessage) => UiMessage) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const runAssistant = useCallback(
    async (aid: number, prompt: string) => {
      busyRef.current = true;
      setBusy(true);
      readAloud.stop();
      try {
        convRef.current ??= await Conversation.create();
        const text = await convRef.current.send(prompt, {
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
        patch(aid, (m) => ({ ...m, pendingTool: false, error: friendlyError(e), errorKind: classifyError(e) }));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [patch, readAloud, settings.voiceReadAloud],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current || !hasKey) return;
      const uid = idRef.current++;
      const aid = idRef.current++;
      stickRef.current = true;
      setMessages((ms) => [...ms, { id: uid, role: 'user', text }, { id: aid, role: 'assistant', text: '', tools: [], prompt: text }]);
      setInput('');
      void runAssistant(aid, text);
    },
    [hasKey, runAssistant],
  );
  const sendRef = useRef(send);
  sendRef.current = send;

  const retry = useCallback(
    (aid: number) => {
      if (busyRef.current) return;
      const m = messages.find((x) => x.id === aid);
      if (!m?.prompt) return;
      patch(aid, (mm) => ({ ...mm, text: '', tools: [], proposals: [], error: undefined }));
      stickRef.current = true;
      void runAssistant(aid, m.prompt);
    },
    [messages, patch, runAssistant],
  );

  const clear = () => {
    if (busyRef.current) return;
    convRef.current = null; // next message starts a new Gemini chat
    setMessages([]);
    readAloud.stop();
  };

  // Voice
  const voice = useVoiceInput({
    onInterim: (txt) => setInput(txt),
    onFinal: (txt) => sendRef.current(txt),
  });

  // Load the data snapshot as soon as the chat opens, so the first question doesn't wait for it.
  useEffect(() => {
    if (hasKey) prewarm();
  }, [hasKey]);

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
  const noKey = !hasKey && loaded;

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* toolbar */}
      {(!empty || readAloud.speaking) && (
        <div className="flex items-center justify-end gap-2 border-b border-line px-3 py-1.5">
          {readAloud.speaking && (
            <Button variant="outline" size="sm" onClick={readAloud.stop}>
              <Square className="h-3 w-3 fill-current" />
              Stop reading
            </Button>
          )}
          {!empty && (
            <button
              onClick={clear}
              disabled={busy}
              title="New conversation"
              aria-label="New conversation"
              className="grid h-8 w-8 place-items-center text-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {empty && (
          <div className="flex min-h-full flex-col justify-center gap-4 py-4">
            <div>
              <h2 className="text-[1.25rem] font-bold text-ink">Hi! What would you like to know?</h2>
              <p className="mt-1 text-muted">I can look into your grades, deadlines and attendance.</p>
            </div>
            <BriefingNote />
            {noKey ? (
              <Block title={<span className="flex items-center gap-2 font-bold"><KeyRound className="h-4 w-4 text-brand-500" />Gemini API key missing</span>}>
                <p className="text-muted">Add your Gemini API key in Settings and you are good to go.</p>
                <Button className="mt-3" onClick={() => onNavigate('settings')}>
                  <SettingsIcon className="h-4 w-4" />
                  Open Settings
                </Button>
              </Block>
            ) : (
              <div className="flex w-full flex-col gap-2">
                {CHIPS.map((c) => (
                  <Button key={c} variant="outline" className="w-full justify-start whitespace-normal text-left" onClick={() => send(c)}>
                    {c}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words border border-line bg-surface-2 px-3 py-2">{m.text}</div>
            </div>
          ) : (
            <AssistantMessage key={m.id} m={m} busy={busy} onRetry={() => retry(m.id)} onNavigate={onNavigate} patch={patch} />
          ),
        )}
      </div>

      {/* input */}
      <div className="border-t border-line bg-surface px-3 py-2.5">
        {voice.state === 'denied' && (
          <p className="mb-2 flex items-start gap-2 border border-warning bg-warning-subtle px-2.5 py-1.5 text-[0.8125rem] text-warning-ink">
            <MicOff className="mt-0.5 h-4 w-4 shrink-0" />
            Allow the microphone: a tab was opened for that. Then tap the mic again.
          </p>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            ref={taRef}
            value={input}
            rows={1}
            disabled={noKey}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={listening ? 'Listening…' : 'Ask me anything…'}
            className={cx(inputClass, 'max-h-[120px] min-h-[36px] flex-1 resize-none disabled:opacity-50', listening && 'border-brand-500')}
          />
          {voice.supported && (
            <button
              onClick={() => (listening ? voice.stop() : voice.start())}
              disabled={busy || noKey}
              title="Voice input"
              aria-label="Voice input"
              className={cx(
                'relative grid h-9 w-9 shrink-0 place-items-center border transition-colors disabled:opacity-40',
                listening ? 'border-danger bg-danger text-white' : 'border-[#8f959e] bg-white text-ink hover:bg-surface-3',
              )}
            >
              {listening && <span className="absolute inset-0 animate-ping bg-danger/50" />}
              {listening ? <MicOff className="relative h-4 w-4" /> : <Mic className="relative h-4 w-4" />}
            </button>
          )}
          <Button variant="primary" className="h-9 w-9 shrink-0 !px-0" onClick={() => send(input)} disabled={busy || !input.trim() || noKey} aria-label="Send" title="Send">
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  m,
  busy,
  onRetry,
  onNavigate,
  patch,
}: {
  m: UiMessage;
  busy: boolean;
  onRetry: () => void;
  onNavigate: (tab: FocusRequest['tab']) => void;
  patch: (id: number, fn: (m: UiMessage) => UiMessage) => void;
}) {
  const waiting = busy && !m.error && (m.pendingTool || (!m.text && !m.proposals?.length));
  const onDone = (pid: string) => (results: SyncResult[]) => {
    const ok = results.filter((r) => r.calendar === 'created' || r.calendar === 'exists' || r.tasks === 'created' || r.tasks === 'exists').length;
    patch(m.id, (mm) => ({
      ...mm,
      proposals: mm.proposals?.map((p) => {
        if (p.id !== pid) return p;
        return { ...p, note: ok > 0 ? addedNote(ok, p.options.calendar, p.options.tasks) : 'Adding to Google did not work.' };
      }),
    }));
  };
  const keyProblem = m.errorKind === 'bad_key' || m.errorKind === 'no_key';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[0.8125rem] font-bold text-muted">
        <Sparkles className="h-4 w-4 text-brand-500" />
        Copilot
      </div>
      {!!m.tools?.length && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {m.tools.map((n) => {
            const h = TOOL_HINTS[n];
            const Icon = h ? HINT_ICONS[h.icon] : Calculator;
            return (
              <span key={n} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted">
                <Icon className="h-3.5 w-3.5" />
                {h?.label ?? n}
              </span>
            );
          })}
        </div>
      )}
      {(m.text || waiting) && (
        <div>
          {m.text && <Markdown>{m.text}</Markdown>}
          {waiting && <WorkingSteps prompt={m.prompt ?? ''} compact={!!m.text} />}
        </div>
      )}
      {m.proposals?.map((p) => (
        <div key={p.id} className="w-full space-y-1.5">
          <ConfirmGoogleSync items={p.items} defaultOptions={p.options} onDone={onDone(p.id)} />
          {p.note && <p className="text-[0.8125rem] font-bold text-success">{p.note}</p>}
        </div>
      ))}
      {m.error && (
        <div className="flex items-start gap-2 border border-danger bg-danger-subtle px-3 py-2 text-[0.875rem] text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <p>{m.error}</p>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={onRetry} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </Button>
              {keyProblem && (
                <Button variant="outline" size="sm" onClick={() => onNavigate('settings')}>
                  Open Settings
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
