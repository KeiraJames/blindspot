import { useState } from 'react';
import { ask, say } from '../lib/feedback';
import { PixelArt } from './PixelArt';
import { cx } from './ui';

/**
 * The main way to answer the app: a large button that asks `prompt` out loud, plays a tone,
 * listens, and hands back what was said. Big enough to find without looking.
 */
export function MicButton({
  label,
  prompt,
  contextualStrings,
  onHeard,
  className,
}: {
  label: string;
  prompt: string;
  contextualStrings?: string[];
  onHeard: (text: string) => void;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  return (
    <button
      type="button"
      disabled={listening}
      onClick={async () => {
        setListening(true);
        try {
          onHeard(await ask(prompt, contextualStrings));
        } catch {
          void say('Listening is not available right now. You can type instead.');
        } finally {
          setListening(false);
        }
      }}
      className={cx(
        'pixel-frame pixel-press w-full min-h-32 flex flex-col items-center justify-center gap-2 bg-accent text-accent-fg px-4 py-4',
        listening && 'animate-pulse',
        className,
      )}
    >
      <PixelArt name="mic" size={44} />
      <span className="font-pixel text-2xl">{listening ? 'Listening…' : label}</span>
    </button>
  );
}
