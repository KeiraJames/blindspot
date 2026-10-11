import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cx } from './ui';

/**
 * Standard page frame. On every navigation the h1 receives focus so VoiceOver announces
 * the new screen (SPA route changes are otherwise silent).
 */
export function Screen({
  title,
  back,
  actions,
  children,
  className,
  wide,
}: {
  title: string;
  back?: string | true;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    document.title = `${title} · PathSense`;
    h1.current?.focus();
  }, [title]);
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="safe-top sticky top-0 z-10 bg-bg/95 backdrop-blur border-b border-line">
        <div className={cx('mx-auto flex items-center gap-2 px-4 pb-3', wide ? 'max-w-6xl' : 'max-w-2xl')}>
          {back && (
            <button
              type="button"
              onClick={() => (back === true ? navigate(-1) : navigate(back))}
              className="min-h-12 min-w-12 -ml-2 rounded-xl px-2 font-semibold text-accent"
            >
              <span aria-hidden>‹ </span>Back
            </button>
          )}
          <h1 ref={h1} tabIndex={-1} className="text-2xl font-bold flex-1 truncate outline-none">
            {title}
          </h1>
          {actions}
        </div>
      </header>
      <main
        id="main"
        className={cx(
          'mx-auto w-full flex-1 px-4 py-4 safe-bottom flex flex-col gap-4',
          wide ? 'max-w-6xl' : 'max-w-2xl',
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
