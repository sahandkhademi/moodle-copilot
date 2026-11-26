// One course row of the "Grades" block (Moodle course-overview style), expandable.
import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { AttendanceRecord, Course, GradeItem } from '@/lib/types';
import type { Settings } from '@/lib/settings';
import { courseStanding, GRADE_LABELS, neededForGrade, projectedGrade, type AustrianGrade } from '@/lib/grading';
import { absenceStatus } from '@/lib/attendance';
import { KEYS, setItem } from '@/lib/storage';
import { Button, GradeChip, MLink, cx } from '@/components/ui/moodle';
import { num } from './util';

interface Props {
  course: Course;
  items: GradeItem[];
  attendance?: AttendanceRecord;
  settings: Settings;
  open: boolean;
  onToggle(): void;
  highlightGradeId: string | null;
  cardRef(el: HTMLElement | null): void;
}

const ABS_BAR = { safe: 'bg-success', warning: 'bg-[#eb6200]', over: 'bg-danger' } as const;

export default function CourseCard({ course, items, attendance, settings, open, onToggle, highlightGradeId, cardRef }: Props) {
  const cutoffs = settings.gradeCutoffs;
  const standing = courseStanding(items, cutoffs);
  const graded = items.filter((i) => i.score != null);
  const abs = attendance ? absenceStatus(attendance, settings.absenceLimit) : null;

  const [whatIf, setWhatIf] = useState<number | null>(null);
  const wi = whatIf ?? Math.round(standing.currentPercent ?? 70);
  const proj = projectedGrade(items, wi, cutoffs);
  const pct = (n: number) => `${num(n, 1)}%`;

  // "What do I need?" line: next better grade than the current one.
  let need: { tone: 'good' | 'info' | 'bad'; text: string } | null = null;
  if (standing.remaining.length === 0) {
    if (standing.currentGrade) need = { tone: 'info', text: `Everything graded. Final grade: ${standing.currentGrade}` };
  } else {
    const target = (standing.currentGrade && standing.currentGrade > 1 ? standing.currentGrade - 1 : 1) as AustrianGrade;
    const r = neededForGrade(items, target, cutoffs);
    if (r.status === 'secured') need = { tone: 'good', text: `A ${target} is secured.` };
    else if (r.status === 'possible') {
      need =
        r.perItem.length === 1
          ? { tone: 'info', text: `To get a ${target} you need ${pct(r.neededPercent)} (${num(r.perItem[0]!.neededPoints)}/${r.perItem[0]!.item.maxScore}) on ${r.perItem[0]!.item.name}` }
          : { tone: 'info', text: `To get a ${target} you need ${pct(r.neededPercent)} on average on the remaining items` };
    } else need = { tone: 'bad', text: `A ${target} is out of reach. Best possible: ${projectedGrade(items, 100, cutoffs).grade}` };
  }
  const needTone = {
    good: 'bg-success-subtle border-success text-success',
    info: 'bg-brand-50 border-brand-100 text-brand-700',
    bad: 'bg-danger-subtle border-danger text-danger',
  };

  const ask = () => setItem(KEYS.focus, { tab: 'chat', chatPrompt: `How am I doing in ${course.fullname}?`, at: Date.now() });

  return (
    <div ref={cardRef} className="border-b border-line last:border-b-0">
      <div className="flex cursor-pointer items-center gap-3 py-3" onClick={onToggle}>
        {standing.currentGrade ? (
          <GradeChip grade={standing.currentGrade} />
        ) : (
          <span className="inline-grid h-9 w-9 shrink-0 place-items-center rounded bg-surface-3 text-lg font-bold text-muted">-</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate leading-snug" onClick={(e) => e.stopPropagation()}>
            <MLink href={course.url}>{course.fullname}</MLink>
          </div>
          <div className="text-[0.8125rem] leading-snug text-muted">
            {standing.currentGrade ? `${GRADE_LABELS[standing.currentGrade].en} · ${pct(standing.currentPercent ?? 0)}` : 'No grade yet'}
          </div>
        </div>
        <button aria-expanded={open} aria-label={open ? 'Collapse course' : 'Expand course'} className="p-1 text-muted hover:text-ink">
          <ChevronDown className={cx('h-5 w-5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="space-y-3 pb-4">
          {graded.length > 0 && (
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left font-bold">
                  <th className="px-2 py-1.5 font-bold">Item</th>
                  <th className="px-2 py-1.5 text-right font-bold">Grade</th>
                  <th className="px-2 py-1.5 text-right font-bold">Percentage</th>
                  <th className="px-2 py-1.5 text-right font-bold">Class average</th>
                </tr>
              </thead>
              <tbody>
                {graded.map((it) => {
                  const p = (it.score! / it.maxScore) * 100;
                  const avg = it.classAverage != null ? (it.classAverage / it.maxScore) * 100 : null;
                  return (
                    <tr
                      key={it.id}
                      id={`grade-${it.id}`}
                      className={cx('border-b border-line align-top transition-colors duration-500', highlightGradeId === it.id && 'bg-brand-50 outline outline-2 -outline-offset-2 outline-brand-500')}
                    >
                      <td className="px-2 py-1.5">{it.url ? <MLink href={it.url}>{it.name}</MLink> : it.name}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{num(it.score!)}/{num(it.maxScore)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{pct(p)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-muted">{avg != null ? pct(avg) : '-'}</td>
                    </tr>
                  );
                })}
                {standing.remaining.map((it) => (
                  <tr key={it.id} className="border-b border-line text-muted">
                    <td className="px-2 py-1.5">{it.name}</td>
                    <td className="px-2 py-1.5 text-right" colSpan={3}>Open &middot; {num(Math.round(it.weight * 100), 0)}% of grade</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {need && <p className={cx('border px-3 py-2 text-[0.875rem] leading-snug', needTone[need.tone])}>{need.text}</p>}

          {standing.remaining.length > 0 && (
            <div className="border border-line bg-surface-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-[0.875rem]">What if</div>
                <div className="flex items-center gap-2 text-[0.8125rem] text-muted">
                  Projected grade
                  <GradeChip grade={proj.grade} className="h-8 w-8 text-base" />
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={wi}
                onChange={(e) => setWhatIf(Number(e.target.value))}
                className="mt-2 w-full"
                style={{ accentColor: '#0084bb' }}
                aria-label="What if: percentage on remaining items"
              />
              <div className="flex justify-between gap-2 text-[0.8125rem] text-muted">
                <span>I score {wi}% on everything left</span>
                <span className="tabular-nums">
                  {GRADE_LABELS[proj.grade].en} &middot; {pct(proj.finalPercent)}
                </span>
              </div>
            </div>
          )}

          {abs && (
            <div>
              <div className="text-[0.875rem]">
                {abs.state === 'over' ? `${abs.absences} absences, only ${abs.allowed} allowed` : `${abs.absences} of ${abs.allowed} allowed absences used`}
              </div>
              <div className="mt-1 h-1.5 bg-surface-3">
                <div className={cx('h-full', ABS_BAR[abs.state])} style={{ width: `${abs.allowed > 0 ? Math.min(100, (abs.absences / abs.allowed) * 100) : 100}%` }} />
              </div>
            </div>
          )}

          <Button variant="secondary" size="sm" onClick={ask}>
            <Sparkles className="h-3.5 w-3.5" />
            Ask Copilot
          </Button>
        </div>
      )}
    </div>
  );
}
