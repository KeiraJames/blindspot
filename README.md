# PathSense

Indoor navigation for blind and low-vision people, on iPhone and iPad. A helper scans rooms with a LiDAR iPhone, the scans are joined into a map, and anyone can then walk it with spoken turns, distinct vibrations and full-screen gestures.

PathSense is a responsive React web app running inside an iOS-only Capacitor shell. Scanning, AR tracking, haptics and on-device vision are native Swift plugins. Firebase stores and shares maps, and ElevenLabs speaks directions. See [docs/PRD.md](docs/PRD.md) for the product requirements.

> PathSense is a travel aid. It complements a cane or guide dog and does not replace them.

## Quick start (no accounts, no device)

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Without Firebase settings the app runs in **local-only mode**, with a sample home of four places: Kitchen, Bedroom, Bathroom and Closet. The theme is light pink with pixel art. In a browser:

- **Navigate**: pick a start and a destination (for example Kitchen to Closet), press Start, then **Auto-walk** in the walk simulator. You'll hear every prompt (browser speech) and see the route. **Wander off** tests rerouting.
- **Scan a room**: the scanner is simulated in development and produces a plausible room.
- **Map Studio**: place scans by snapping doors, edit places, check for problems, publish versions, and view the building in 3D.

## Run on iPhone

Needs Xcode 16+ and iOS 17+. Scanning needs a LiDAR iPhone or iPad Pro, and AR navigation needs a real device. The iOS Simulator falls back to the walk simulator.

```bash
npm run ios:sync
```

```bash
npm run ios:open
```

In Xcode, choose your team under *Signing & Capabilities* and run on a device. Full setup, including Firebase, ElevenLabs and Sign in with Apple, is in [docs/IOS.md](docs/IOS.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (web UI with plugin fallbacks and simulators) |
| `npm test` | Unit tests: graph, A*, stitching, guidance, tracker, haptics, gestures, controller, functions logic |
| `npm run test:rules` | Firestore security rules tests on the emulator (needs Java 21 and `firebase-tools`) |
| `npm run lint` / `npm run typecheck` | ESLint (with jsx-a11y) and TypeScript |
| `npm run build` | Production web build into `dist/` |
| `npm run ios:sync` | Build the web app and copy it plus plugins into the iOS project |
| `npm run functions:build` | Type-check and bundle Cloud Functions |

## Repository layout

```
src/
  lib/graph/      Navigation graph, A* routing, validation, scan stitching (Umeyama)
  lib/nav/        Turn-by-turn guidance, route tracker, pose adapter, controller, walk simulator
  lib/haptics/    Core Haptics pattern specs (shared with Swift)
  lib/gestures/   Full-screen gesture recognizer
  lib/voice/      ElevenLabs client, clip cache, voice queue, earcons
  plugins/        TypeScript contracts for the native plugins, with web fallbacks
  firebase/       Firebase init, auth, repositories (Firebase and local-only)
  screens/        Home, Navigate, Scan, Map Studio, Share, Settings, Practice, About
  components/PixelArt.tsx   Pixel-art sprites (house, kitchen, bedroom, bathroom, closet)
  data/sampleHome.ts        The four-room sample home
  test/fixtures/  Two-floor dorm used only by engine tests (stairs, elevator, exits)
native/pathsense-native/   Swift plugins (Swift package, auto-registered by `cap sync`)
ios/              Capacitor iOS project (SPM)
functions/        Cloud Functions: invites, version validation, org sync, cleanup, TTS proxy
firestore.rules, storage.rules, tests/rules/   Security rules and their tests
hosting/          Legal pages and apple-app-site-association
docs/             PRD, architecture, iOS setup, VoiceOver checklist
```

## Status

All five PRD milestones are implemented in code. These need real hardware or accounts to verify:

- RoomPlan scanning, ARKit relocalization, LiDAR obstacle detection and Core Haptics only run on a physical LiDAR device. They compile and load in the Simulator but haven't been exercised on a device.
- Firebase, ElevenLabs and Sign in with Apple need your own project and keys (see [docs/IOS.md](docs/IOS.md)).
- Door and stair detection with Core ML uses an optional `PathSenseDetector.mlmodelc` you supply. Without it, PathSense uses RoomPlan's own door and stair detection, LiDAR depth for obstacles, and Vision for people and room numbers.
