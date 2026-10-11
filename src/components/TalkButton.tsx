import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isVoiceOverRunning } from '../lib/feedback';
import {
  registerScreenVoice,
  setNavigator,
  stopTalking,
  talk,
  useAssistant,
  type ScreenVoice,
} from '../lib/voice/assistant';
import { useSettings } from '../state/settings';
import { PixelArt } from './PixelArt';
import { cx } from './ui';

/**
 * Shows when the app is listening, without covering anything: the screen's edges glow and
 * blur (every button underneath still works). A soft buzz marks the start and the end; see
 * `ask` in feedback.ts. Also connects the voice companion to the router.
 */
export function ListeningEdge() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const listening = useAssistant((a) => a.listening);
  useEffect(
    () => setNavigator((to) => (to === -1 ? navigate(-1) : navigate(to)), pathname),
    [navigate, pathname],
  );
  return (
    <>
      <div aria-hidden className={cx('listening-edge', listening && 'is-on')} />
      <p role="status" className="sr-only">
        {listening ? 'Listening' : ''}
      </p>
    </>
  );
}

/** Small mic button for headers: press it and say what you want to do. */
export function TalkButton({ className }: { className?: string }) {
  const { listening, hideButton } = useAssistant();
  const enabled = useSettings((s) => s.voiceCompanion);
  if (hideButton || !enabled) return null;
  return (
    <button
      type="button"
      onClick={() => (listening ? stopTalking() : void talk(''))}
      aria-label={listening ? 'Stop listening' : 'Talk. Say what you want to do.'}
      aria-pressed={listening}
      className={cx(
        'pixel-frame pixel-press shrink-0 min-h-12 min-w-12 flex items-center justify-center bg-accent text-accent-fg',
        className,
      )}
    >
      <PixelArt name="mic" size={28} />
    </button>
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

/**
 * Listen without a press only when talking is on and VoiceOver isn't reading the screen (its
 * speech would be picked up). Otherwise the app just speaks, like a screen reader app.
 */
export const canAutoListen = () => useSettings.getState().voiceCompanion && !isVoiceOverRunning();
