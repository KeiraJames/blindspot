import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isVoiceOverRunning } from '../lib/feedback';
import {
  registerScreenVoice,
  setNavigator,
  talk,
  useAssistant,
  type ScreenVoice,
} from '../lib/voice/assistant';
import { PixelArt } from './PixelArt';
import { cx } from './ui';

/**
 * The same big Talk button at the bottom of every screen: press it and speak to do anything in
 * the app. A rising tone and a soft buzz mean it's listening; a falling tone means it heard you.
 */
export function TalkButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { listening, hideButton } = useAssistant();
  useEffect(
    () => setNavigator((to) => (to === -1 ? navigate(-1) : navigate(to)), pathname),
    [navigate, pathname],
  );
  if (hideButton) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 px-4 pb-3 safe-bottom pointer-events-none">
      <button
        type="button"
        onClick={() => void talk('')}
        disabled={listening}
        aria-label={listening ? 'Listening' : 'Talk. Say what you want to do.'}
        className={cx(
          'pointer-events-auto pixel-frame pixel-press mx-auto w-full max-w-2xl min-h-20 flex items-center justify-center gap-3 bg-accent text-accent-fg',
        )}
      >
        <PixelArt name="mic" size={36} className={listening ? 'animate-pulse' : undefined} />
        <span className={cx('font-pixel text-2xl', listening && 'animate-pulse')}>
          {listening ? 'Listening…' : 'Talk'}
        </span>
      </button>
    </div>
  );
}

/**
 * Give this screen first say over what's heard. `hideButton` hides the floating Talk button
 * (for screens with their own, like guidance).
 */
export function useScreenVoice(v: ScreenVoice, hideButton = false) {
  const ref = useRef(v);
  useEffect(() => {
    ref.current = v;
  });
  useEffect(
    () =>
      registerScreenVoice({
        handle: (h) => ref.current.handle(h),
        get hints() {
          return ref.current.hints;
        },
      }),
    [],
  );
  useEffect(() => {
    useAssistant.setState({ hideButton });
    return () => useAssistant.setState({ hideButton: false });
  }, [hideButton]);
}

/** Voice-first unless VoiceOver is reading the screen (its speech would be picked up). */
export const canAutoListen = () => !isVoiceOverRunning();
