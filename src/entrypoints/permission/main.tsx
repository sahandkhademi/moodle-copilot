// Chrome can't show the mic permission prompt inside a side panel. This page runs in a normal tab,
// asks once, and closes itself. Afterwards the side panel can use the mic.
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Mic, MicOff } from 'lucide-react';
import '@/assets/main.css';
import { Block, Button } from '@/components/ui/moodle';

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
    <div className="grid min-h-full place-items-center bg-surface-2 p-6">
      <Block className="w-full max-w-md" title="Microphone access">
        <div className="space-y-3">
          {state === 'asking' && (
            <p className="flex items-start gap-2">
              <Mic className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
              <span>Please click "Allow" in the browser prompt to let Moodle Copilot use your microphone.</span>
            </p>
          )}
          {state === 'ok' && (
            <>
              <p className="flex items-start gap-2 font-bold text-success">
                <Mic className="mt-0.5 h-5 w-5 shrink-0" />
                Microphone enabled
              </p>
              <p className="text-muted">You can close this tab.</p>
            </>
          )}
          {state === 'denied' && (
            <>
              <p className="flex items-start gap-2 font-bold text-danger">
                <MicOff className="mt-0.5 h-5 w-5 shrink-0" />
                Microphone is blocked
              </p>
              <p className="text-muted">Allow it via the lock icon in the address bar, then try again.</p>
              <Button onClick={ask}>Try again</Button>
            </>
          )}
        </div>
      </Block>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Page />);
