import { useEffect, useState } from 'react';
import { PixelArt, spriteFor } from '../components/PixelArt';
import { Screen } from '../components/Screen';
import { Button, Card, Field, LinkButton } from '../components/ui';
import { announce, ask, cue, say } from '../lib/feedback';
import { neighbours } from '../lib/graph/rooms';
import { usePlace } from '../state/place';

function connections(names: string[]): string {
  return names.length > 0 ? `Connected to ${names.join(' and ')}.` : 'Not connected to other rooms yet.';
}

export default function RoomsScreen() {
  const graph = usePlace((s) => s.place.graph);
  const renameRoom = usePlace((s) => s.renameRoom);
  const deleteRoom = usePlace((s) => s.deleteRoom);
  const deleteAll = usePlace((s) => s.deleteAll);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const summary =
    graph.rooms.length === 0
      ? 'You have no rooms yet. Until you add one, Go somewhere uses a practice map. Only rooms you scanned can be renamed or deleted.'
      : `You have ${graph.rooms.length} ${graph.rooms.length === 1 ? 'room' : 'rooms'}: ${graph.rooms.map((r) => r.name).join(', ')}.`;

  useEffect(() => {
    void announce(`My rooms. ${summary}`);
    // Announce once on open, not on every edit.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const renameByVoice = async (roomId: string, oldName: string) => {
    try {
      const heard = await ask(`What should ${oldName} be called? Say the new name after the tone.`);
      if (!heard) return void say("I didn't hear a name. Nothing changed.");
      await renameRoom(roomId, heard);
      void cue('confirm', `Renamed ${oldName} to ${heard}.`);
    } catch {
      setEditing(roomId);
      setDraft(oldName);
      void say('Listening is not available. Type the new name.');
    }
  };

  return (
    <Screen title="My rooms" back="/">
      <Card>
        <p className="text-lg">{summary}</p>
      </Card>
      {graph.rooms.length > 0 && (
        <Button block onClick={() => void say(summary)}>
          Read my rooms aloud
        </Button>
      )}

      <ul className="flex flex-col gap-3" aria-label="Rooms">
        {graph.rooms.map((room) => {
          const node = graph.nodes.find((n) => n.kind === 'room' && n.roomIds?.includes(room.id));
          const sprite = node ? spriteFor(node) : 'house';
          const near = neighbours(graph, room.id);
          return (
            <Card as="li" key={room.id} className="flex flex-col gap-3">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                {sprite && <PixelArt name={sprite} size={40} />}
                {room.name}
              </h2>
              <p className={near.length ? 'text-muted' : 'text-warn'}>{connections(near)}</p>

              {editing === room.id ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!draft.trim()) return;
                    await renameRoom(room.id, draft.trim());
                    void cue('confirm', `Renamed to ${draft.trim()}.`);
                    setEditing(null);
                  }}
                >
                  <Field
                    label={`New name for ${room.name}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="submit" variant="primary">
                      Save
                    </Button>
                    <Button onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant="primary"
                    onClick={() => void renameByVoice(room.id, room.name)}
                    aria-label={`Rename ${room.name} by voice`}
                  >
                    Rename
                  </Button>
                  <Button
                    onClick={() => {
                      setEditing(room.id);
                      setDraft(room.name);
                    }}
                    aria-label={`Type a new name for ${room.name}`}
                  >
                    Type
                  </Button>
                  {confirmDelete === room.id ? (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        await deleteRoom(room.id);
                        setConfirmDelete(null);
                        void cue('cancel', `${room.name} deleted.`);
                      }}
                    >
                      Yes, delete
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setConfirmDelete(room.id);
                        void say(`Delete ${room.name}? Press Yes, delete to remove it.`);
                      }}
                      aria-label={`Delete ${room.name}`}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </ul>

      <LinkButton to="/scan" variant={graph.rooms.length ? 'secondary' : 'primary'} large block>
        Add a room
      </LinkButton>

      {graph.rooms.length > 0 &&
        (confirmDelete === 'all' ? (
          <Card className="flex flex-col gap-2">
            <p className="text-lg font-semibold">
              Delete all {graph.rooms.length} rooms? This can't be undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="danger"
                onClick={async () => {
                  await deleteAll();
                  setConfirmDelete(null);
                  void cue('cancel', 'All your rooms are deleted. The practice map is back.');
                }}
              >
                Yes, delete all
              </Button>
              <Button onClick={() => (setConfirmDelete(null), void say('Nothing was deleted.'))}>
                Keep them
              </Button>
            </div>
          </Card>
        ) : (
          <Button
            variant="danger"
            block
            onClick={() => {
              setConfirmDelete('all');
              void say(`Delete all ${graph.rooms.length} rooms? Press Yes, delete all. Or press Keep them.`);
            }}
          >
            Delete all my rooms
          </Button>
        ))}
    </Screen>
  );
}
