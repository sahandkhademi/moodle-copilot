// Moodle "Timeline" block.
import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import type { Course, Deadline } from '@/lib/types';
import { ActivityIcon, Badge, Block, Button, Input, MLink, Select, cx } from '@/components/ui/moodle';
import { AddToGoogleButton } from '@/components/google/AddToGoogleButton';
import { actionLabel, dateHeading, inRange, isOverdue, RANGE_OPTIONS, subtitle, timeOf, TYPE_LABEL, type RangeFilter } from './util';

interface Props {
  deadlines: Deadline[];
  courses: Course[];
  done: Set<string>;
  onToggleDone(id: string): void;
  now: Date;
}

const STEP = 5;

export default function DeadlineTimeline({ deadlines, courses, done, onToggleDone, now }: Props) {
  const [range, setRange] = useState<RangeFilter>('7d');
  const [sort, setSort] = useState<'dates' | 'courses'>('dates');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(STEP);
  const [showDone, setShowDone] = useState(false);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const isDone = (d: Deadline) => done.has(d.id) || !!d.submitted;

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deadlines
      .filter((d) => inRange(d, range, now))
      .filter((d) => {
        if (!q) return true;
        const label = d.meeting ? 'zoom meeting' : TYPE_LABEL[d.type];
        return `${d.title} ${label} ${courseById.get(d.courseId)?.fullname ?? ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sort === 'courses') {
          const c = (courseById.get(a.courseId)?.fullname ?? '').localeCompare(courseById.get(b.courseId)?.fullname ?? '');
          if (c) return c;
        }
        return a.due.localeCompare(b.due);
      });
  }, [deadlines, range, query, sort, now, courseById]);

  const doneCount = matching.filter(isDone).length;
  const visible = matching.filter((d) => showDone || !isDone(d));
  const page = visible.slice(0, shown);

  const groups: { key: string; heading: string; items: Deadline[] }[] = [];
  for (const d of page) {
    const course = courseById.get(d.courseId);
    const key = sort === 'courses' ? String(d.courseId) : new Date(d.due).toDateString();
    const heading = sort === 'courses' ? (course?.fullname ?? 'Other') : dateHeading(d.due);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(d);
    else groups.push({ key, heading, items: [d] });
  }

  return (
    <Block title="Timeline" id="timeline">
      <div className="grid grid-cols-2 gap-2">
        <Select
          aria-label="Filter timeline by date"
          value={range}
          onChange={(e) => {
            setRange(e.target.value as RangeFilter);
            setShown(STEP);
          }}
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Select
          aria-label="Sort timeline items"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as 'dates' | 'courses');
            setShown(STEP);
          }}
        >
          <option value="dates">Sort by dates</option>
          <option value="courses">Sort by courses</option>
        </Select>
        <div className="relative col-span-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            type="search"
            aria-label="Search by activity type or name"
            placeholder="Search by activity type or name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(STEP);
            }}
            className="pl-8"
          />
        </div>
      </div>

      <hr className="-mx-4 mt-4 border-line" />

      {visible.length === 0 ? (
        <p className="py-6 text-center text-muted">{deadlines.length === 0 ? 'No upcoming activities due.' : 'No activities match your filters.'}</p>
      ) : (
        <div>
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="mb-0 mt-4 text-[0.9375rem] font-bold text-ink">{g.heading}</h3>
              <ul className="mt-1">
                {g.items.map((d) => (
                  <Row key={d.id} d={d} course={courseById.get(d.courseId)} now={now} done={isDone(d)} manual={done.has(d.id)} onToggleDone={() => onToggleDone(d.id)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {visible.length > shown && (
        <div className="mt-4 text-center">
          <Button variant="light" onClick={() => setShown((n) => n + STEP)}>Show more activities</Button>
        </div>
      )}
      {doneCount > 0 && (
        <div className="mt-3 text-center text-[0.8125rem]">
          <button className="text-brand-500 hover:text-brand-700 hover:underline" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Hide done' : `Show done (${doneCount})`}
          </button>
        </div>
      )}
    </Block>
  );
}

function Row({ d, course, now, done, manual, onToggleDone }: { d: Deadline; course?: Course; now: Date; done: boolean; manual: boolean; onToggleDone(): void }) {
  const overdue = isOverdue(d, now) && !done;
  return (
    <li className={cx('flex gap-3 border-b border-line py-3 last:border-b-0', done && 'opacity-60')}>
      <div className="w-11 shrink-0 pt-0.5 text-muted tabular-nums">{timeOf(d.due)}</div>
      <div className="pt-0.5">
        <ActivityIcon type={d.type} meeting={d.meeting} size={26} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="leading-snug">
          <MLink href={d.url}>{d.title}</MLink>
          {overdue && <Badge tone="danger" className="ml-2 align-middle">Overdue</Badge>}
        </div>
        <div className="text-[0.8125rem] leading-snug text-muted">{subtitle(d, course?.fullname)}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => d.url && window.open(d.url, '_blank', 'noopener')}>
            {actionLabel(d)}
          </Button>
          {!done && course && <AddToGoogleButton item={{ deadline: d, course }} compact />}
          {(!done || manual) && (
            <button onClick={onToggleDone} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
              <Check className="h-3.5 w-3.5" />
              {done ? 'Mark as not done' : 'Mark as done'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
