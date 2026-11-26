// Chrome can't show the mic permission prompt inside a side panel. This page runs in a normal tab,
// asks once, and closes itself. Afterwards the side panel can use the mic.
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@/assets/main.css';

function Page() {
  const [state, setState] = useState<'asking' | 'ok' | 'denied'>('asking');

  const ask = async () => {
    setState('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setState('ok');
      setTimeout(() => window.close(), 1500);
    } catch {
      setState('denied');
    }
  };
  useEffect(() => {
    void ask();
  }, []);

  return (
    <div className="grid min-h-full place-items-center p-8 text-center">
      <div className="max-w-sm space-y-3">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-2xl text-white">🎤</div>
        {state === 'asking' && <p className="text-lg font-semibold">Please click “Allow” for the microphone…</p>}
        {state === 'ok' && (
          <>
            <p className="text-lg font-semibold">🎤 Microphone enabled</p>
            <p className="text-sm text-slate-500">You can close this tab.</p>
          </>
        )}
        {state === 'denied' && (
          <>
            <p className="text-lg font-semibold">Microphone is blocked</p>
            <p className="text-sm text-slate-500">Allow it via the lock icon in the address bar, then try again.</p>
            <button onClick={ask} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Page />);
