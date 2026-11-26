// Voice input (Web Speech API) and read-aloud (speechSynthesis) for the chat (plan 4.3).
import { useCallback, useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;

export const voiceSupported = !!SR;

/** Side panels can't show Chrome's mic prompt, so grant it once from a normal extension tab. */
export function openMicPermissionTab() {
  try {
    void chrome.tabs.create({ url: chrome.runtime.getURL('/permission.html' as never) });
  } catch {
    /* not in an extension (plain web preview) */
  }
}

export type VoiceState = 'idle' | 'listening' | 'denied';

export function useVoiceInput(opts: { onInterim: (text: string) => void; onFinal: (text: string) => void }) {
  const [state, setState] = useState<VoiceState>('idle');
  const recRef = useRef<any>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(() => {
    if (!SR) return;
    stop();
    const rec = new SR();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let interim = '';
    let sent = false;
    rec.onstart = () => setState('listening');
    rec.onresult = (e: any) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      optsRef.current.onInterim((finalText + interim).trim());
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setState('denied');
        openMicPermissionTab();
      } else {
        setState('idle');
      }
      sent = true; // don't auto-send after an error
    };
    rec.onend = () => {
      setState((s) => (s === 'denied' ? s : 'idle'));
      const text = (finalText || interim).trim();
      if (!sent && text) {
        sent = true;
        optsRef.current.onFinal(text); // auto-send when speech ends
      }
    };
    try {
      rec.start();
    } catch {
      setState('idle');
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);
  return { state, start, stop, supported: voiceSupported };
}

/** Strip markdown so speech doesn't read out symbols or URLs. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*_>#~|]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useReadAloud() {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (markdown: string) => {
      if (!supported) return;
      const text = stripMarkdown(markdown);
      if (!text) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [supported],
  );

  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  return { speak, stop, speaking, supported };
}
