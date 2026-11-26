// "Test connection" control for the Zapier MCP server in Settings (plan 3.2): lists the MCP tools, no LLM, no writes.
import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useSettings } from '@/lib/settings';
import { testZapier, type ZapierTestResult } from '@/lib/google/zapier';
import { Button } from '@/components/ui/moodle';
import { pickTools, pickUndoTools } from '@/lib/google/direct';

export function ZapierTest() {
  const [s] = useSettings();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ZapierTestResult | null>(null);

  if (s.mockMode) return <p className="text-sm text-muted">Demo data is on: Google writes are simulated.</p>;
  if (!s.zapierMcpUrl) return <p className="text-sm text-muted">Enter the Zapier MCP URL to test the connection.</p>;

  const run = async () => {
    setBusy(true);
    setRes(null);
    setRes(await testZapier());
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={run} busy={busy}>
        {busy ? 'Testing…' : 'Test connection'}
      </Button>
      {res?.ok && (
        <p className="flex items-start gap-1.5 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Connected · {res.tools.length} tool{res.tools.length === 1 ? '' : 's'}: <span className="text-ink">{res.tools.join(', ')}</span>
          </span>
        </p>
      )}
      {res?.ok && <Readiness tools={res.tools} />}
      {res && !res.ok && (
        <p className="flex items-start gap-1.5 text-sm text-danger">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{res.error}</span>
        </p>
      )}
    </div>
  );
}

/** Which Copilot features the enabled Zapier actions cover. */
function Readiness({ tools }: { tools: string[] }) {
  const infos = tools.map((name) => ({ name }));
  const add = pickTools(infos);
  const undo = pickUndoTools(infos);
  const rows: [string, string | undefined, string][] = [
    ['Add to Calendar', add.calendar?.name, 'Google Calendar: Create Detailed Event'],
    ['Add to Tasks', add.tasks?.name, 'Google Tasks: Create Task'],
    ['Undo in Calendar', undo.calendar?.name, 'Google Calendar: Delete Event'],
    ['Undo in Tasks', (undo.tasks ?? undo.tasksComplete)?.name, 'Google Tasks: Delete Task (or Update Task)'],
  ];
  return (
    <ul className="space-y-0.5 text-[0.8125rem]">
      {rows.map(([label, tool, needed]) => (
        <li key={label} className={tool ? 'text-success' : 'text-danger'}>
          {tool ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : <XCircle className="mr-1 inline h-3.5 w-3.5" />}
          {label}
          {!tool && <span className="text-muted"> · turn on “{needed}” in Zapier</span>}
        </li>
      ))}
    </ul>
  );
}
