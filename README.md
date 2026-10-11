# PathSense

Indoor navigation for blind and low-vision people, on iPhone. Scan a room with the phone, say what the room is, and later ask the phone to take you there. It guides you with speech, vibrations and short sounds, and you answer it by voice.

> PathSense is a travel aid. It complements a cane or guide dog and does not replace them.

## What it does

1. **Add a room.** Stand in the doorway and press Start scanning. Walk slowly along the walls (the phone coaches you out loud). When the scan finishes, the phone asks "What is this room called?". Say the name after the tone, hear it read back, and press Save. Rooms scanned one after another through a shared doorway connect automatically.
2. **Go somewhere.** Press the big button and say where you are, then say where you want to go. The route is read out. Press Start and walk; each turn is announced before you reach it.
3. **While walking,** press Speak and say *where am I*, *repeat*, *pause*, *resume*, *stop*, or another room's name to go there instead. You can also tap the screen to hear where you are, swipe up to repeat, and touch and hold to pause.
4. **My rooms.** Hear your rooms, rename one by voice, delete one, or delete them all (each asks you to confirm).

Everything is spoken, so the app works without looking at it. With VoiceOver on, the app lets VoiceOver read the screens and only speaks navigation prompts and answers itself. All data stays on the phone.

Until you scan your first room, a practice map is loaded so you can try navigation:

- **Open hall** (default): Entrance, Welcome desk, Coffee table, Seating area and Stage, spread over about 13 × 14 m. It's built for demos in a large open space, where there are no walls to follow with a cane. Stand at the entrance facing into the hall, say "Entrance", then for example "Coffee table", press Start and walk.
- **Home:** Kitchen, Bedroom, Bathroom and Closet.

**Practice scan:** on the Add a room screen, *Practice first* runs a pretend scan with spoken coaching, then asks for the room's name, so you can learn the steps on any phone (or the Simulator). Nothing is saved.

**Natural voice (optional):** with an ElevenLabs key, directions are spoken by an ElevenLabs voice (cached on the phone, so repeats are instant and free). Put the key in `.env.local` (git-ignored; see `.env.example`), then run `npm run ios:sync`. The key is built into that app copy, so keep such builds on your own devices. Voice Library voices need a paid ElevenLabs plan; on a free plan the app uses the built-in voice "Sarah" instead. Offline or on any error, the iPhone voice speaks, so no direction is ever dropped. When the natural voice is on, direction text is sent to ElevenLabs.

The voice speaks slower than the iOS default, with a short pause between sentences; *Settings → Speaking speed* plays a sample as you change it. *How to use* explains everything in short, simple sentences, each with a Listen button.

## Run it

Needs Node 22+ and Xcode 16+. Scanning needs an iPhone 12 Pro or later Pro model (LiDAR); navigation works on any iPhone with iOS 17.

```bash
npm install
```

```bash
npm run ios:sync && npm run ios:open
```

In Xcode, pick a simulator or your iPhone and press ▶ Run. For a real iPhone, choose your team under *Signing & Capabilities* (a free Apple ID works). In the Simulator, the scanner says LiDAR is needed and navigation uses a walk simulator.

To work on the interface in a browser (with a simulated scanner and walker):

```bash
npm run dev
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Web dev server with simulated scanner and walker |
| `npm test` | Unit tests (routing, room joining, guidance, voice commands, haptics, gestures) |
| `npm run lint` / `npm run typecheck` | ESLint (with jsx-a11y) and TypeScript |
| `npm run ios:sync` | Build the web app and copy it into the iOS project |

## Layout

```
src/
  screens/        Home, Go somewhere, Add a room, My rooms, Settings, Help
  lib/graph/      Room graph, A* routing, joining scans at shared doors
  lib/nav/        Turn-by-turn guidance, route tracker, AR pose adapter, walk simulator
  lib/voice/      Speech queue, voice commands, sounds
  lib/feedback.ts say / announce / ask (speak, then listen) and vibration cues
  state/          Settings and your rooms (stored on the device)
  plugins/        TypeScript side of the native plugins, with browser fallbacks
native/pathsense-native/   Swift: RoomPlan scanning, ARKit, Core Haptics, Vision, speech
ios/              Xcode project (Capacitor)
docs/             PRD, architecture notes, VoiceOver checklist
```
