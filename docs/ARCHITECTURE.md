# Architecture

PathSense is a React app running in a WKWebView inside an iOS-only Capacitor shell. The interface is web; LiDAR scanning, AR tracking, vibration, on-device vision and speech are native Swift plugins (`native/pathsense-native`, a Swift package that `cap sync` registers automatically).

## Scope

The app does three things: add a room (scan it and name it by voice), go somewhere (spoken, vibration-backed guidance), and manage your rooms. Everything stays on the phone.

The original PRD ([PRD.md](PRD.md)) also described a map editor, accounts, sharing through Firebase, organizations and a cloud voice. Those were built and later removed to keep the app simple and voice-first; they remain in git history (up to commit `769f791`).

## Voice

`src/lib/feedback.ts` is the only way the app talks or listens:

- `say(text)` always speaks (navigation prompts, coaching, answers), using the built-in iOS voice (`AVSpeechSynthesizer`) through a priority queue. Hazards interrupt; low-priority hints are skipped when busy.
- `announce(text)` speaks screen guidance, but when VoiceOver is running it only updates the live region, because VoiceOver already reads the screen.
- `ask(prompt)` speaks a question, plays a tone and transcribes the answer on the device (`SFSpeechRecognizer`, on-device when supported).
- `cue(name, text)` plays a Core Haptics pattern and a matching sound, then speaks.

Every spoken line is mirrored to an `aria-live` region for braille displays.

Voice commands during navigation are parsed in `src/lib/voice/commands.ts`. Room names are matched forgivingly (extra words, partial names, and recognition slips such as "closed" for "Closet").

## Rooms and the map

- **Scan:** RoomPlan returns walls, doors, openings and stairs. `ScanExport.simplify` (Swift) turns them into a `ScanResult` in plan coordinates (meters; ARKit `x`, `−z`). The capture also saves an ARWorldMap for relocalization.
- **Add:** `addScannedRoom` (`src/lib/graph/rooms.ts`) anchors the first room. Each later room is snapped onto an unmatched door of an existing room when one fits (similar width, no overlap), using the door-to-door alignment and Umeyama refinement in `stitch.ts`. If nothing fits, the room is kept separate and the user is told to scan the room next to it from the shared doorway.
- **Names:** doors are named after the rooms they join ("the door between Bedroom and Kitchen"), because that's what the guide says when you walk through them.
- **Storage:** one place per device, in IndexedDB (`src/state/place.ts`). Until the first room exists, the navigator uses the sample home.

## Navigation

- **Routing:** A* over the room graph with a straight-line heuristic (tests check it against Dijkstra for every pair of nodes).
- **Guidance:** `buildSteps` creates a maneuver wherever the path bends by 25° or more, and at arrival.
- **Tracking:** `RouteTracker` projects each pose onto the route and never moves backwards. It emits approach prompts (8 m), maneuver prompts (2 m), drift corrections (paused near turns), off-route events (more than 3 m for 2.5 s, which triggers a reroute), tracking loss and arrival.
- **Pose:** `PoseAdapter` maps ARKit poses into the map, using the starting room's ARWorldMap when available. Otherwise it assumes you start in the chosen room, facing the first leg.
- **Hazards:** the Vision plugin warns about close obstacles (LiDAR depth) and people. It never says a path is clear.

## Look around

A map-free mode (`src/screens/LookScreen.tsx`). ARNav runs with `surroundings: true`, which turns on vertical plane detection and reports ARKit-classified planes (door, seat, table, window) within 6 m twice a second, with distance and direction relative to where the phone points. On phones without LiDAR it also raycasts straight ahead against estimated surfaces. On LiDAR phones, the Vision engine reports the nearest surface in the left, middle and right thirds of the view (`clearance`) on every depth frame, and Vision detects people.

`SurroundingsAnnouncer` (`src/lib/surroundings/announcer.ts`) turns that into a few alerts: stop (< 0.8 m ahead, high priority), something ahead (< 1.6 m, repeated only if 0.5 m closer or after 6 s), something close at a side (< 0.6 m), people (< 2.5 m), doors (once when seen within 5 m, once more at 1.3 m), and chairs and tables (once, within 2.5 m). It never says the way is clear. The distance ahead also drives parking-sensor style ticks (150 ms when very close, 1 s at 2.5 m, silent beyond).

## Coordinates

Map frame: meters, `x` east-ish, `y` north-ish; bearings in radians, counter-clockwise from +x (positive turn = left). ARKit: `x` right, `y` up, camera looks −z; plan = `(x, −z)`; bearing = π/2 + yaw.
