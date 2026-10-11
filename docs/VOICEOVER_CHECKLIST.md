# VoiceOver walkthrough checklist

Run this on a device with VoiceOver on (Settings → Accessibility → VoiceOver) before each TestFlight build. Test at the default text size and at the largest Dynamic Type size.

## First launch
- [ ] The safety notice is announced as an alert dialog, and focus starts on it.
- [ ] "I understand" is reachable and dismisses the notice.
- [ ] On the sign-in screen, each option is a button with a clear name.

## Home and map screens
- [ ] Each screen change announces the new heading (h1 receives focus).
- [ ] Map cards read the name, role and version. The Navigate and Open buttons name the map.
- [ ] The "Back" button is first in the swipe order on every inner screen.

## Navigate (choose)
- [ ] "Where are you?" and "Where to?" lists read the full place name, including the floor.
- [ ] The search field has a label. "Speak" starts dictation and the result is announced.
- [ ] "Nearest exit", "Bathroom" and "Elevator" plan a route and speak a summary.
- [ ] The route preview reads as a numbered list. The "Avoid stairs" switch reports on/off.

## Navigate (guiding)
- [ ] With VoiceOver on, swipes and taps in the top area work directly, without double-tap and hold (native direct-interaction overlay).
- [ ] Swipe up repeats; swipe down asks for confirmation; double-tap confirms ending.
- [ ] Touch and hold pauses and resumes.
- [ ] Two-finger swipe up or down at stairs or an elevator confirms the floor.
- [ ] Every spoken prompt also appears in the live region (braille display shows it).
- [ ] The control bar (Repeat, Where am I, Pause, Nearest exit, End) is reachable by swiping.
- [ ] A hazard interrupts speech and plays the sharp triple vibration.
- [ ] Arrival plays two long pulses and is announced once.
- [ ] Turn off the network mid-route: prompts continue with the built-in voice.

## Scan
- [ ] On a non-LiDAR device, the message explains scanning is unavailable and navigation still works.
- [ ] The capture screen's Finish and Cancel buttons are the only focusable elements and have hints.
- [ ] Coaching ("Move closer to the wall", "Door found") is spoken without overlapping.
- [ ] The review screen reads detected doors and stairs. "Speak" fills in the room name.

## Map Studio (WCAG 2.2 AA)
- [ ] Floor tabs and panel tabs announce "tab, selected, n of m".
- [ ] Every canvas action is possible from the Places panel: add, rename, change type, move with arrow buttons, connect, remove a connection, delete.
- [ ] Checks list each issue with a "Show" button that selects the place.
- [ ] Publish is disabled with an explanation while there are errors.
- [ ] The 3D view has a text summary.
- [ ] Contrast: check "Maximum contrast" mode and both system appearances.
- [ ] Focus outlines are visible with a keyboard (iPad with keyboard).

## Settings
- [ ] Every toggle is a switch with a name and on/off state; sliders announce their value text.
- [ ] "Test voice" and the Practice screen play each cue with its description.
