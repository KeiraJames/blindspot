import { useEffect } from 'react';
import { PixelArt } from '../components/PixelArt';
import { Screen } from '../components/Screen';
import { LinkButton } from '../components/ui';
import { announce } from '../lib/feedback';
import { useActiveMap } from '../state/place';

let introduced = false;

export function HomeScreen() {
  const { graph, isSample, sampleName } = useActiveMap();
  const status = isSample
    ? `You have no rooms yet, so the ${sampleName} practice map is loaded. Add a room to make your own.`
    : `Your home has ${graph.rooms.length} ${graph.rooms.length === 1 ? 'room' : 'rooms'}.`;

  useEffect(() => {
    // Speak the menu once per launch, not every time you come back.
    if (introduced) return;
    introduced = true;
    void announce(
      `PathSense. ${status} Choose Go somewhere, Look around, Add a room, My rooms, Settings, or How to use.`,
    );
  }, [status]);

  return (
    <Screen title="PathSense">
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
