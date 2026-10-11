import { useEffect, useRef } from 'react';
import { useSettings } from '../state/settings';
import { unlockAudio } from '../lib/voice/earcons';
import { Speech } from '../plugins/speech';
import { Button } from './ui';

export const SAFETY_TEXT =
  'PathSense is a travel aid. It complements your cane or guide dog and does not replace them. It cannot see every obstacle and never confirms that a path is clear. Stay aware of your surroundings.';

/** Blocking first-run dialog (PRD §3, §10: safety copy). */
export function SafetyNotice() {
  const ack = useSettings((s) => s.safetyAcknowledged);
  const set = useSettings((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ack) ref.current?.focus();
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
        <h1 id="safety-title" className="text-3xl font-bold">
          Before you start
        </h1>
        <p id="safety-body" className="text-lg">
          {SAFETY_TEXT}
        </p>
        <ul className="list-disc pl-6 text-muted">
          <li>
            Scanning needs an iPhone or iPad Pro with LiDAR. Any iPhone on iOS 17 can navigate maps that
            others scanned.
          </li>
          <li>Camera and LiDAR data stay on your phone. A scan is uploaded only when you save it.</li>
        </ul>
        <Button
          variant="primary"
          large
          block
          onClick={() => {
            unlockAudio();
            void Speech.configureAudioSession();
            set({ safetyAcknowledged: true });
          }}
        >
          I understand
        </Button>
      </div>
    </div>
  );
}
