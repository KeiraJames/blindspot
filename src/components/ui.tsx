import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const base =
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold min-h-12 px-5 py-3 text-base select-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110',
  secondary: 'bg-surface-2 text-fg border border-line hover:brightness-125',
  danger: 'bg-danger text-black hover:brightness-110',
  ghost: 'text-fg hover:bg-surface-2',
};

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; large?: boolean }>(
  function Button({ variant = 'secondary', block, large, className, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} className={cx(base, variants[variant], block && 'w-full', large && 'min-h-16 text-lg', className)} {...rest} />;
  },
);

export function LinkButton({ variant = 'secondary', block, large, className, ...rest }: LinkProps & { variant?: Variant; block?: boolean; large?: boolean }) {
  return <Link className={cx(base, variants[variant], block && 'w-full', large && 'min-h-16 text-lg', 'no-underline', className)} {...rest} />;
}

export function Card({ children, className, as: As = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'li' | 'article' } & Record<string, unknown>) {
  return (
    <As className={cx('rounded-2xl bg-surface border border-line p-4', className)} {...rest}>
      {children}
    </As>
  );
}

export function Field({ label, hint, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint || error ? `${id}-d` : undefined}
        aria-invalid={error ? true : undefined}
        className="min-h-12 rounded-xl bg-surface-2 border border-line px-3 text-fg text-base"
        {...rest}
      />
      {(hint || error) && (
        <p id={`${id}-d`} className={cx('text-sm', error ? 'text-danger' : 'text-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Select({ label, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <select id={id} className="min-h-12 rounded-xl bg-surface-2 border border-line px-3 text-fg text-base" {...rest}>
        {children}
      </select>
    </div>
  );
}

export function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 min-h-12 py-1">
      <div>
        <span id={`${id}-l`} className="font-semibold block">
          {label}
        </span>
        {description && (
          <span id={`${id}-d`} className="text-sm text-muted block">
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        onClick={() => onChange(!checked)}
        className={cx('relative shrink-0 h-9 w-16 rounded-full border-2 border-line transition-colors', checked ? 'bg-accent' : 'bg-surface-2')}
      >
        <span className={cx('absolute top-0.5 h-7 w-7 rounded-full bg-fg transition-all', checked ? 'left-8 bg-accent-fg' : 'left-0.5')} />
      </button>
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const id = useId();
  const text = format ? format(value) : String(value);
  return (
    <div className="flex flex-col gap-1 py-1">
      <label htmlFor={id} className="font-semibold flex justify-between">
        <span>{label}</span>
        <span className="text-muted" aria-hidden>
          {text}
        </span>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} aria-valuetext={text} onChange={(e) => onChange(Number(e.target.value))} className="w-full h-10 accent-[var(--accent)]" />
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-muted py-4">
      <span aria-hidden className="h-5 w-5 rounded-full border-2 border-muted border-t-transparent animate-spin" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="rounded-xl border border-danger text-danger p-3">
      {msg}
    </p>
  );
}
