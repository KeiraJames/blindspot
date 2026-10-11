import { useEffect, useRef } from 'react';
import { useSettings } from '../state/settings';
import { unlockAudio } from '../lib/voice/earcons';
import { Speech } from '../plugins/speech';
import { announce, voice } from '../lib/feedback';
import { PixelArt } from './PixelArt';
import { Button } from './ui';

export const SAFETY_TEXT =
  'BlindSpöt is a travel aid. It complements your cane or guide dog and does not replace them. It cannot see every obstacle and never confirms that a path is clear. Stay aware of your surroundings.';

/** Blocking first-run dialog (PRD §3, §10: safety copy). */
export function SafetyNotice() {
  const ack = useSettings((s) => s.safetyAcknowledged);
  const set = useSettings((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ack) return;
    ref.current?.focus();
    // Read it aloud too: the person may not be using VoiceOver.
    void announce(
      `Before you start. ${SAFETY_TEXT} Press the button at the bottom of the screen, I understand, to continue.`,
    );
  }, [ack]);
  if (ack) return null;
  return (
    <div className="fixed inset-0 z-50 bg-bg flex items-center justify-center p-6 safe-top safe-bottom">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="safety-title"
        aria-describedby="safety-body"
        tabIndex={-1}
        className="max-w-md flex flex-col gap-5 outline-none"
      >
        <PixelArt name="heart" size={72} />
        <h1 id="safety-title" className="text-3xl font-bold">
          Before you start
        </h1>
        <p id="safety-body" className="text-lg">
          {SAFETY_TEXT}
        </p>
        <p className="text-muted">Everything you scan stays on this phone.</p>
        <Button
          variant="primary"
          large
          block
          onClick={() => {
            unlockAudio();
            void Speech.configureAudioSession();
            voice.stop();
            set({ safetyAcknowledged: true });
          }}
        >
          I understand
        </Button>
      </div>
    </div>
  );
}
