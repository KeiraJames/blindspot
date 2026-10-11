import { useState } from 'react';
import { ask, say } from '../lib/feedback';
import { talk, useAssistant } from '../lib/voice/assistant';
import { PixelArt } from './PixelArt';
import { cx } from './ui';

/** How many times to ask again, without a press, when the answer didn't work out. */
const FOLLOW_UPS = 2;

/**
 * The main way to answer the app: a large button that asks `prompt` out loud, plays a tone,
 * listens, and hands back what was said. Big enough to find without looking.
 *
 * Without `onHeard`, the answer goes to the voice companion (the screen's own handler first).
 *
 * Like a conversation, `onHeard` can return a follow-up question ("Sorry, I didn't catch that.
 * Where do you want to go?"); the app then asks it and listens again straight away.
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
  onHeard?: (text: string) => string | void;
  className?: string;
}) {
  const [asking, setListening] = useState(false);
  const companion = useAssistant((a) => a.listening);
  const listening = asking || (!onHeard && companion);
  return (
    <button
      type="button"
      disabled={listening}
      onClick={async () => {
        if (!onHeard) return void talk(prompt);
        setListening(true);
        try {
          let question = prompt;
          for (let round = 0; round <= FOLLOW_UPS; round++) {
            const next = onHeard(await ask(question, contextualStrings));
            if (!next) break;
            if (round === FOLLOW_UPS) {
              void say("Let's try again later. Press the big button when you're ready.");
              break;
            }
            question = next;
          }
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
