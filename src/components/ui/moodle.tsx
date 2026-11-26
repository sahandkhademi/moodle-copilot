// Moodle-look building blocks (JKU Moodle / Boost theme). Use these everywhere instead of ad-hoc styles.
// Icons: lucide-react only. No emojis anywhere in the UI.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import {
  CalendarDays,
  ClipboardList,
  FileUp,
  GraduationCap,
  Loader2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { DeadlineType } from '@/lib/types';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** A Moodle "block": white card with a thin border and a plain title (like "Timeline", "Calendar"). */
export function Block({ title, actions, children, className, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('border border-line bg-surface', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          {title && <h2 className="text-[1.15rem] font-normal text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'light' | 'link' | 'danger';
const BUTTON: Record<ButtonVariant, string> = {
  // Moodle primary: solid blue
  primary: 'bg-brand-500 text-white border border-brand-500 hover:bg-brand-600 hover:border-brand-600',
  // Moodle .btn-secondary on JKU: white with blue border + blue text
  secondary: 'bg-white text-brand-500 border border-brand-500 hover:bg-brand-50',
  // Grey outline, like "Add submission" / "Attempt quiz now"
  outline: 'bg-white text-ink border border-[#8f959e] hover:bg-surface-3',
  // Grey fill, like "Show more activities"
  light: 'bg-surface-3 text-ink border border-surface-3 hover:bg-line',
  link: 'bg-transparent text-brand-500 border border-transparent hover:underline px-0',
  danger: 'bg-danger text-white border border-danger hover:brightness-95',
};

export function Button({ variant = 'primary', size = 'md', busy, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-none transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1 text-[0.8125rem]' : 'px-3 py-1.5 text-[0.9375rem]',
        BUTTON[variant],
        className,
      )}
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

type BadgeTone = 'danger' | 'success' | 'warning' | 'info' | 'secondary' | 'primary';
const BADGE: Record<BadgeTone, string> = {
  danger: 'bg-danger text-white',
  success: 'bg-success text-white',
  warning: 'bg-warning text-ink',
  info: 'bg-info text-white',
  secondary: 'bg-surface-3 text-ink',
  primary: 'bg-brand-500 text-white',
};
/** Small rounded pill, like Moodle's red "Overdue" badge. */
export function Badge({ tone = 'secondary', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-block rounded px-1.5 py-0.5 text-[0.75rem] font-bold leading-none', BADGE[tone], className)}>{children}</span>;
}

export const inputClass =
  'w-full rounded-none border border-[#8f959e] bg-white px-3 py-1.5 text-[0.9375rem] text-ink outline-none placeholder:text-muted focus:border-brand-500 focus:shadow-[0_0_0_0.2rem_rgba(0,132,187,0.25)]';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, 'appearance-auto pr-8', props.className)} />;
}

/** Moodle-style link (blue, underline on hover). */
export function MLink({ href, children, className }: { href?: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx('text-brand-500 hover:text-brand-700 hover:underline', className)}>
      {children}
    </a>
  );
}

const ACTIVITY: Record<DeadlineType, { icon: LucideIcon; color: string; label: string }> = {
  assignment: { icon: FileUp, color: 'text-act-assessment', label: 'Assignment' },
  quiz: { icon: ClipboardList, color: 'text-act-assessment', label: 'Quiz' },
  exam: { icon: GraduationCap, color: 'text-act-assessment', label: 'Exam' },
  event: { icon: CalendarDays, color: 'text-act-content', label: 'Event' },
};

/** Activity icon in Moodle's purpose colors (pink for assessments). `meeting` renders the orange Zoom-style disc. */
export function ActivityIcon({ type, meeting, size = 28 }: { type: DeadlineType; meeting?: boolean; size?: number }) {
  if (meeting) {
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-act-communication text-white" style={{ width: size + 8, height: size + 8 }}>
        <Video style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={2.25} />
      </span>
    );
  }
  const a = ACTIVITY[type];
  const Icon = a.icon;
  return <Icon className={cx('shrink-0', a.color)} style={{ width: size, height: size }} strokeWidth={1.5} aria-label={a.label} />;
}
export const activityLabel = (t: DeadlineType) => ACTIVITY[t].label;

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin text-muted', className)} />;
}

/** Austrian grade chip: 1 green … 5 red. */
export function GradeChip({ grade, className }: { grade: 1 | 2 | 3 | 4 | 5; className?: string }) {
  const tone = { 1: 'bg-success text-white', 2: 'bg-[#5a9a3c] text-white', 3: 'bg-warning text-ink', 4: 'bg-[#e07a2e] text-white', 5: 'bg-danger text-white' }[grade];
  return <span className={cx('inline-grid h-9 w-9 shrink-0 place-items-center rounded text-lg font-bold', tone, className)}>{grade}</span>;
}

export { cx };
