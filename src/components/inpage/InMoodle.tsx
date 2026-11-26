// Copilot widgets rendered INSIDE Moodle's own Dashboard page (content script).
// Styled only with Moodle/Bootstrap classes that the page already has, so they look native.
// No Tailwind here: our CSS must not leak into Moodle.
import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarPlus, CalendarX, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import type { AttendanceRecord, Course, Deadline, GradeItem } from '@/lib/types';
import type { Settings } from '@/lib/settings';
import { courseStanding, GRADE_LABELS, neededForGrade, projectedGrade, type AustrianGrade } from '@/lib/grading';
import { absenceStatus } from '@/lib/attendance';
import { buildBriefing, plainCourse } from '@/lib/briefing';
import { openAssistant, syncViaBackground, undoViaBackground } from '@/lib/inpage/bridge';
import { useGoogleToggle } from '@/lib/google/useGoogleToggle';
import type { SyncItem } from '@/lib/google/sync';

export interface MoodleData {
  courses: Course[];
  deadlines: Deadline[];
  grades: GradeItem[];
  attendance: AttendanceRecord[];
  doneIds: string[];
  unseenGradeIds: string[];
  synced: Record<string, { calendar?: boolean; tasks?: boolean }>;
}

const GRADE_COLORS: Record<AustrianGrade, string> = { 1: '#357a32', 2: '#5a9a3c', 3: '#f0ad4e', 4: '#e07a2e', 5: '#ca3120' };
const fmt = (n: number, d = 1) => n.toLocaleString('en-GB', { maximumFractionDigits: d });

function CopilotTag() {
  return (
    <span className="small text-muted d-inline-flex align-items-center" style={{ gap: 4 }} title="Added by Moodle Copilot">
      <Sparkles size={14} style={{ color: '#0084bb' }} /> Copilot
    </span>
  );
}

// ---------------------------------------------------------------- Briefing (top of the Dashboard)

export function BriefingCard({ data, settings }: { data: MoodleData | null; settings: Settings }) {
  const b = useMemo(() => (data ? buildBriefing(data, settings) : null), [data, settings]);
  if (!b) {
    return (
      <div className="alert alert-info d-flex align-items-center" style={{ gap: 8 }}>
        <Loader2 size={16} className="copilot-spin" /> Copilot is checking your courses…
      </div>
    );
  }
  const cls = b.tone === 'good' ? 'alert-success' : b.tone === 'heads-up' ? 'alert-warning' : 'alert-danger';
  return (
    <div className={`alert ${cls} mb-3`} role="status">
      <div className="d-flex justify-content-between align-items-start" style={{ gap: 12 }}>
        <div>
          <div className="fw-bold mb-1">{b.headline}</div>
          <div>{b.text}</div>
        </div>
        <CopilotTag />
      </div>
      <button type="button" className="btn btn-link p-0 mt-2 small" onClick={() => openAssistant()}>
        Ask Copilot about it
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Timeline: per-item Google button

const BOTH = { calendar: true, tasks: true };

function UndoLink({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button type="button" className="btn btn-link btn-sm p-0 ms-1 align-baseline" style={{ fontSize: '0.8rem' }} onClick={onClick} disabled={busy} title="Remove from Google Calendar and Tasks">
      {busy ? 'Removing…' : 'Undo'}
    </button>
  );
}

/** Calendar icon next to a Timeline item: one click adds (tick shows instantly), Undo is always there afterwards. */
export function TimelineGoogleButton({ item, alreadySynced }: { item: SyncItem; alreadySynced: boolean }) {
  const t = useGoogleToggle({ ids: [item.deadline.id], alreadySynced, add: () => syncViaBackground([item], BOTH), undo: undoViaBackground });
  const added = t.phase === 'added' || t.phase === 'undoing';
  const title = t.phase === 'error' ? `Couldn't add to Google: ${t.error} (click to retry)` : added ? (t.pending ? 'Adding to Google…' : 'In Google Calendar and Tasks') : 'Add to Google Calendar and Tasks';
  const Icon = t.phase === 'undoing' ? Loader2 : added ? CalendarCheck : t.phase === 'error' ? CalendarX : CalendarPlus;
  const color = added ? '#357a32' : t.phase === 'error' ? '#ca3120' : '#0084bb';
  return (
    <span className="d-inline-flex align-items-center text-nowrap">
      <button type="button" className="btn btn-link btn-sm p-1 ms-1" title={title} aria-label={title} onClick={added ? undefined : t.add} style={{ color, lineHeight: 1, cursor: added ? 'default' : 'pointer' }}>
        <Icon size={18} className={t.phase === 'undoing' ? 'copilot-spin' : t.pending ? 'copilot-pulse' : undefined} />
      </button>
      {added && <UndoLink onClick={t.undo} busy={t.phase === 'undoing'} />}
    </span>
  );
}

export function TimelineSyncAll({ items, syncedCount }: { items: SyncItem[]; syncedCount: number }) {
  const todo = items.length - syncedCount;
  const t = useGoogleToggle({ ids: items.map((i) => i.deadline.id), alreadySynced: items.length > 0 && todo <= 0, add: () => syncViaBackground(items, BOTH), undo: undoViaBackground });
  if (!items.length) return null;
  const btn = { gap: 6, color: '#1d2125', borderColor: '#8f959e' };
  if (t.phase === 'added' || t.phase === 'undoing') {
    return (
      <span className="d-inline-flex align-items-center small" style={{ gap: 6, color: '#357a32' }}>
        <CalendarCheck size={14} className={t.pending ? 'copilot-pulse' : undefined} /> {items.length} in Google
        <UndoLink onClick={t.undo} busy={t.phase === 'undoing'} />
      </span>
    );
  }
  return (
    <button type="button" className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center" style={btn} onClick={t.add} title={t.phase === 'error' ? t.error : 'Adds the next 7 days to Google Calendar and Tasks'}>
      {t.phase === 'error' ? <CalendarX size={14} /> : <CalendarPlus size={14} />}
      {t.phase === 'error' ? 'Retry' : `Add ${todo} to Google`}
    </button>
  );
}

// ---------------------------------------------------------------- Grades block (below the Timeline)

function GradeBadge({ grade }: { grade: AustrianGrade | null }) {
  return (
    <span
      className="d-inline-flex align-items-center justify-content-center fw-bold rounded"
      style={{ width: 30, height: 30, background: grade ? GRADE_COLORS[grade] : '#e9ecef', color: grade === 3 || !grade ? '#1d2125' : '#fff', flexShrink: 0 }}
    >
      {grade ?? '–'}
    </span>
  );
}

function CourseRow({ course, items, attendance, settings, open, onToggle, highlight }: {
  course: Course;
  items: GradeItem[];
  attendance?: AttendanceRecord;
  settings: Settings;
  open: boolean;
  onToggle: () => void;
  highlight: boolean;
}) {
  const s = courseStanding(items, settings.gradeCutoffs);
  const [whatIf, setWhatIf] = useState(80);
  const target = s.currentGrade && s.currentGrade > 1 ? ((s.currentGrade - 1) as AustrianGrade) : null;
  const need = target && s.remaining.length ? neededForGrade(items, target, settings.gradeCutoffs) : null;
  const abs = attendance ? absenceStatus(attendance, settings.absenceLimit) : null;
  const proj = s.remaining.length ? projectedGrade(items, whatIf, settings.gradeCutoffs) : null;
  const graded = items.filter((i) => i.score != null);

  let needText = '';
  if (need && target) {
    const first = need.perItem[0];
    if (need.status === 'possible' && first) needText = `For a ${target} you need ${fmt(need.neededPercent, 0)}% on what's left${need.perItem.length === 1 ? ` (${fmt(first.neededPoints)}/${first.item.maxScore} on ${first.item.name})` : ''}.`;
    else if (need.status === 'impossible') needText = `A ${target} is out of reach; keep the ${s.currentGrade}.`;
    else if (need.status === 'secured') needText = `The ${target} is already secured.`;
  }

  return (
    <div className="border-bottom py-2" id={`copilot-course-${course.id}`} style={highlight ? { boxShadow: 'inset 3px 0 0 #0084bb', paddingLeft: 8 } : undefined}>
      <div className="d-flex align-items-center" style={{ gap: 10, cursor: 'pointer' }} onClick={onToggle}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <GradeBadge grade={s.currentGrade} />
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <a href={course.url} className="aalink fw-bold text-truncate d-block" onClick={(e) => e.stopPropagation()}>
            {course.fullname}
          </a>
          <small className="text-muted">
            {s.currentGrade ? `${GRADE_LABELS[s.currentGrade].en} · ${fmt(s.currentPercent ?? 0)}%` : 'No grades yet'}
            {graded.length ? ` · ${graded.length} of ${items.length} graded` : ''}
            {abs && abs.state !== 'safe' ? ` · ${abs.left <= 0 ? 'no' : abs.left} absence${abs.left === 1 ? '' : 's'} left` : ''}
          </small>
        </div>
        {abs && abs.state !== 'safe' && <span className={`badge ${abs.state === 'over' ? 'bg-danger' : 'bg-warning text-dark'}`}>Attendance</span>}
      </div>

      {open && (
        <div className="mt-2" style={{ paddingLeft: 26 }}>
          {needText && <div className="alert alert-info py-2 px-3 mb-2 small">{needText}</div>}
          {graded.length > 0 && (
            <table className="table table-sm generaltable mb-2 small">
              <thead>
                <tr><th>Item</th><th className="text-end">Grade</th><th className="text-end">%</th><th className="text-end">Class avg</th></tr>
              </thead>
              <tbody>
                {graded.slice(-8).reverse().map((g) => (
                  <tr key={g.id}>
                    <td>{g.url ? <a href={g.url}>{g.name}</a> : g.name}</td>
                    <td className="text-end">{fmt(g.score!, 2)}/{g.maxScore}</td>
                    <td className="text-end">{fmt((g.score! / g.maxScore) * 100, 0)}%</td>
                    <td className="text-end text-muted">{g.classAverage != null ? `${fmt((g.classAverage / g.maxScore) * 100, 0)}%` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {proj && (
            <div className="d-flex align-items-center small mb-2" style={{ gap: 10 }}>
              <label htmlFor={`copilot-whatif-${course.id}`} className="mb-0 text-nowrap">What if I get</label>
              <input id={`copilot-whatif-${course.id}`} type="range" className="form-range" min={0} max={100} value={whatIf} onChange={(e) => setWhatIf(Number(e.target.value))} style={{ maxWidth: 220, accentColor: '#0084bb' }} />
              <span className="text-nowrap">{whatIf}% on the rest → final <GradeBadge grade={proj.grade} /></span>
            </div>
          )}
          {abs && (
            <div className="small text-muted mb-2">
              Attendance: {abs.absences} of {abs.allowed} allowed absences used
              {attendance?.url && (<> · <a href={attendance.url}>details</a></>)}
            </div>
          )}
          <button type="button" className="btn btn-secondary btn-sm d-inline-flex align-items-center" style={{ gap: 6 }} onClick={() => openAssistant(`How am I doing in ${plainCourse(course)}?`)}>
            <Sparkles size={14} /> Ask Copilot
          </button>
        </div>
      )}
    </div>
  );
}

export function GradesBlock({ data, settings, focusCourseId }: { data: MoodleData | null; settings: Settings; focusCourseId?: number }) {
  const [openId, setOpenId] = useState<number | null>(focusCourseId ?? null);
  useEffect(() => {
    if (focusCourseId == null) return;
    setOpenId(focusCourseId);
    setTimeout(() => document.getElementById(`copilot-course-${focusCourseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  }, [focusCourseId]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.courses
      .map((c) => ({ c, items: data.grades.filter((g) => g.courseId === c.id), att: data.attendance.find((a) => a.courseId === c.id) }))
      .filter((r) => r.items.length || r.att)
      .sort((a, b) => Number(b.items.some((i) => i.score != null)) - Number(a.items.some((i) => i.score != null)));
  }, [data]);

  return (
    <section className="block card mb-3" data-copilot="grades">
      <div className="card-body p-3">
        <div className="d-flex justify-content-between align-items-center">
          <h3 className="h5 card-title mb-2">Grades and attendance</h3>
          <CopilotTag />
        </div>
        {!data ? (
          <div className="text-muted small d-flex align-items-center" style={{ gap: 8 }}>
            <Loader2 size={14} className="copilot-spin" /> Loading your grades…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-muted small">No grades yet.</div>
        ) : (
          rows.map(({ c, items, att }) => (
            <CourseRow key={c.id} course={c} items={items} attendance={att} settings={settings} open={openId === c.id} highlight={focusCourseId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
          ))
        )}
      </div>
    </section>
  );
}
