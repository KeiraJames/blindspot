import { useEffect } from 'react';
import { PixelArt } from '../components/PixelArt';
import { Screen } from '../components/Screen';
import { LinkButton } from '../components/ui';
import { canAutoListen } from '../components/TalkButton';
import { announce } from '../lib/feedback';
import { startConversation } from '../lib/voice/assistant';
import { useSettings } from '../state/settings';
import { useActiveMap } from '../state/place';

let introduced = false;

export function HomeScreen() {
  const { graph, isSample, sampleName } = useActiveMap();
  const status = isSample
    ? `You have no rooms yet, so the ${sampleName} practice map is loaded. Add a room to make your own.`
    : `Your home has ${graph.rooms.length} ${graph.rooms.length === 1 ? 'room' : 'rooms'}.`;

  const ready = useSettings((s) => s.safetyAcknowledged);

  useEffect(() => {
    // Greet once per launch (after the safety notice), not every time you come back.
    if (introduced || !ready) return;
    introduced = true;
    if (canAutoListen())
      startConversation(
        `Hi, it's BlindSpöt. ${status} What would you like to do? You can say go somewhere, look around, or add a room.`,
      );
    else
      void announce(
        `BlindSpöt. ${status} Choose Go somewhere, Look around, Add a room, My rooms, Settings, or How to use.${useSettings.getState().voiceCompanion ? ' Or press the mic and say what you want.' : ''}`,
      );
  }, [status, ready]);

  return (
    <Screen title="BlindSpöt" logo>
      <div className="pixel-frame bg-surface-2 p-4 flex items-center gap-4">
        <PixelArt name="house" size={56} />
        <p className="text-lg">{status}</p>
      </div>

      <nav aria-label="Main menu" className="flex flex-col gap-4">
        <LinkButton to="/go" variant="primary" block className="min-h-28 text-2xl gap-4">
          <PixelArt name="arrow" size={40} />
          Go somewhere
        </LinkButton>
        <LinkButton to="/look" block className="min-h-24 text-2xl gap-4">
          <PixelArt name="eye" size={40} />
          Look around
        </LinkButton>
        <LinkButton to="/scan" block className="min-h-24 text-2xl gap-4">
          <PixelArt name="sparkle" size={36} />
          Add a room
        </LinkButton>
        <LinkButton to="/rooms" block className="min-h-20 text-xl gap-4">
          <PixelArt name="house" size={32} />
          My rooms
        </LinkButton>
        <div className="grid grid-cols-2 gap-4">
          <LinkButton to="/settings" block className="min-h-16">
            Settings
          </LinkButton>
          <LinkButton to="/help" block className="min-h-16">
            How to use
          </LinkButton>
        </div>
      </nav>
    </Screen>
  );
}
