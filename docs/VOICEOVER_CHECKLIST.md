# Accessibility checklist

Run this on an iPhone before each test build, twice: once **with VoiceOver on** (Settings → Accessibility → VoiceOver) and once **with it off**, eyes closed. Also test at the largest Dynamic Type size; headings use a pixel font, so check they stay readable.

## Without VoiceOver (the app speaks for itself)
- [ ] First launch reads the safety notice aloud and says which button to press.
- [ ] Home speaks its menu once per launch.
- [ ] Every screen tells you what to do when it opens.
- [ ] Long screens scroll; nothing is cut off at the bottom.

## With VoiceOver
- [ ] The app does not talk over VoiceOver when a screen opens (only navigation prompts and answers are spoken).
- [ ] Each screen change announces the new heading.
- [ ] "Back" is first in the swipe order on every inner screen.
- [ ] Every spoken prompt also appears in the live region (braille display shows it).

## Add a room
- [ ] On a phone without LiDAR, the app says scanning isn't available and that navigation still works.
- [ ] Coaching ("Move closer to the wall", "Door found") is spoken without overlapping.
- [ ] After the scan, the phone asks for the room's name, plays a tone and listens.
- [ ] It reads back what it heard; "Say it again" re-asks; typing works as a fallback.
- [ ] Saving says whether the room connected to another room, and what to do if it didn't.

## Go somewhere
- [ ] "Say where you are" and "Say where to go" understand room names, including small slips ("closed" → Closet).
- [ ] An unknown name is answered with the list of rooms.
- [ ] The route is read aloud; Start is the first button.
- [ ] While walking: Speak understands where am I, repeat, pause, resume, stop, and a room name (reroutes).
- [ ] Tap = where am I, swipe up = repeat, touch and hold = pause. With VoiceOver on these work directly in the map area.
- [ ] A hazard interrupts speech and plays the sharp triple vibration. Arrival plays two long pulses, once.
- [ ] Airplane mode: everything still works (speech and recognition are on the device).

## My rooms
- [ ] "Read my rooms aloud" lists them.
- [ ] Rename asks for the new name by voice; Type is the fallback.
- [ ] Delete asks for confirmation out loud.

## Settings
- [ ] Every toggle is a switch with a name and on/off state; the speed slider announces its value.
- [ ] Contrast: check the pink theme and Maximum contrast mode.
