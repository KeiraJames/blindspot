# Architecture

## Runtime

```
┌───────────────────────── iPhone / iPad (iOS 17+) ─────────────────────────┐
│  WKWebView (React UI, transparent while navigating)                        │
│    NavigationController ─ RouteTracker ─ A* ─ GraphIndex                   │
│    VoiceGuide (ElevenLabs clips + AVSpeech) · earcons · Core Haptics specs │
│  ──────────────── Capacitor bridge ────────────────                        │
│  ARNav (ARKit, behind the web view) → pose events                          │
│  Vision (LiDAR depth, people, OCR, optional Core ML) → hazard/text events  │
│  Scan (RoomPlan capture screen) → room, USDZ, ARWorldMap, mesh files       │
│  Haptics (CHHapticEngine) · Speech (AVSpeech, dictation) · AppleSignIn     │
└──────────────────────────────────────────────────────────────────────────┘
            │ Firestore / Storage / callable functions (CPU only)
            ▼
   maps, versions, drafts, scans, orgs, invites · scan files · tts proxy → ElevenLabs
```

The web UI stays the product surface (PRD). The native plugins live in `native/pathsense-native`, a Swift package. `cap sync` finds the `CAPBridgedPlugin` classes and adds them to `packageClassList`, so the Xcode project needs no hand edits.

## Coordinates

- **Map frame:** meters, with `x` pointing east-ish and `y` north-ish on the floor plan. Bearings are radians counter-clockwise from +x, so a positive turn angle means left.
- **ARKit frame:** `x` right, `y` up, camera looking −z. Plan coordinates are `(x, −z)`. Yaw 0 means facing −z, positive means turned left, and bearing = π/2 + yaw.
- **Scans** live in their own ARKit frame. Each placed scan stores a rigid `Transform2D` (scan → map) and its floor height.

## Map pipeline

1. **Scan:** RoomPlan returns walls, doors, openings and objects (stairs). `ScanExport.simplify` converts them to a `ScanResult` in plan coordinates. The capture also saves the ARWorldMap, a USDZ model, a downsampled OBJ mesh, and room numbers read by OCR.
2. **Place:** `proposeDoorMatches` aligns each unmatched placed door with each opening of the new scan, face to face. It counts other openings that land on existing doors and penalizes footprint overlap. When several doors line up, it refines the alignment with Umeyama least squares. `placeScan` then adds a room node, door nodes and stair landings, and merges the paired doors.
3. **Edit:** Map Studio adds hallway points, POIs, stairs and elevators between floors, with undo/redo. `validateGraph` flags dangling edges, flat edges that cross floors, unmatched doors, disconnected parts and missing exits.
4. **Publish:** versions are immutable. A Cloud Function validates each new version with the same `validateGraph` code, and only valid versions become `latestVersion`.

## Navigation

- **Routing** is A* with a 3D straight-line heuristic. Stairs cost `length × stairFactor + stairPenalty`, elevators `length + elevatorPenalty`, and "avoid stairs" sets the stairs cost to infinity. Every edge costs at least its length, so the heuristic stays admissible. Tests check the result against Dijkstra for every pair of nodes.
- **Guidance:** `buildSteps` creates a maneuver wherever the path bends by 25° or more, wherever the floor changes, and at arrival. Doors become "past" landmarks, or "through" when the doorway joins two rooms.
- **Tracking:** `RouteTracker` projects each pose onto the next few route segments and never moves backwards. It emits approach prompts (8 m), maneuver prompts (2 m), drift corrections (heading error over 40° for 1.5 s, paused near turns), off-route events (over 3 m for 2.5 s, which triggers a reroute), tracking loss and arrival. It skips approach prompts already covered by the previous "then walk N meters".
- **Pose:** `PoseAdapter` maps ARKit poses into the map. With an ARWorldMap it uses the scan's placement transform after relocalization. Without one, it anchors the first pose at the chosen start, facing the first leg. Floors are detected from the change in height, and a two-finger swipe confirms a floor change manually (elevators break height tracking).
- **Feedback:** each cue pairs a Core Haptics pattern with a synthesized earcon and, usually, speech. Speech goes into a priority queue: hazards interrupt, low-priority coaching is dropped when busy. Each prompt is also mirrored to an aria-live region for VoiceOver and braille users.

## Voice

ElevenLabs is called through the `tts` callable function, which holds the API key, allows only the configured voice, and enforces a per-user daily character quota. Clips are cached in IndexedDB by voice and text, and the next two prompts are prefetched. If a clip isn't ready within 0.9 s (0.15 s for hazards), the native `AVSpeechSynthesizer` speaks instead.

## Data model (Firestore)

| Path | Contents |
| --- | --- |
| `maps/{id}` | name, ownerId, orgId, `members{uid: role}`, memberUids, orgMemberUids (server), latestVersion (server), versionCounter |
| `maps/{id}/draft/current` | `graphJson` being edited (editors only) |
| `maps/{id}/versions/{000001}` | immutable `graphJson`, note, status `pending → valid/invalid` (server), issues |
| `maps/{id}/scans/{scanId}` | simplified scan JSON, Storage paths, summary |
| `orgs/{id}` | name, `members{uid: role}`, memberUids |
| `invites/{code}` | server only: target, role, expiry, uses |
| `usage/{uid}` | server only: daily TTS characters |
| `users/{uid}` | displayName |

Storage: `maps/{mapId}/scans/{scanId}/{roomJson|usdz|worldMap|mesh}.*`.

The graph is stored as JSON per version, not as `nodes`/`edges` collections. The graph is the routing source of truth (PRD §9) and is always loaded whole, and a single document gives atomic, immutable versions. A Firestore document is limited to 1 MB, roughly 4,000 nodes, which is plenty for a building. Split a campus into one map per building.

## Decisions that refine the PRD

- **TTS goes through a Cloud Function** instead of calling ElevenLabs straight from the web layer, so the API key never ships in the app. The function only forwards text; no ML runs there.
- **The `Speech` plugin** combines the PRD's SpeechFallbackPlugin (AVSpeech) with on-device dictation, used for voice room naming and destination search.
- **The `AppleSignIn` plugin** exists because Firebase's web popup sign-in doesn't work inside WKWebView.
- **Organization access** is mirrored onto org maps (`orgMemberUids`) by a function, so membership queries and list rules can be proven without per-document lookups.
- **With VoiceOver on**, gestures come from a native direct-interaction view, because VoiceOver intercepts touches in a web view. The web control bar stays reachable underneath it.
