# iOS, Firebase and voice setup

## 1. Build and run

1. Install Xcode 16 or later. If `xcodebuild` says the developer directory is the Command Line Tools, either run `sudo xcode-select -s /Applications/Xcode.app` or prefix commands with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
2. Run `npm install`, then `npm run ios:sync`, then `npm run ios:open`.
3. In Xcode, select the **App** target, then *Signing & Capabilities*, and choose your team. Change the bundle ID (`app.pathsense.ios`) if it's taken.
4. Run on a device. In the Simulator, ARKit and RoomPlan are unavailable, so the app uses the walk simulator and says that scanning needs LiDAR.

After changing web code, run `npm run ios:sync` again. Native plugin code lives in `native/pathsense-native/ios/Sources/PathSenseNative/`. Xcode compiles it as a local Swift package; after adding or renaming a plugin class, run `npx cap sync ios` so it's registered.

### Capabilities

`App/App.entitlements` contains:

- **Sign in with Apple:** works with automatic signing.
- **Associated Domains** `applinks:pathsense.example.com`: replace this with your Firebase Hosting domain (for example `applinks:your-project.web.app`). Also replace `TEAMID` in `hosting/.well-known/apple-app-site-association` and deploy hosting. Email-link sign-in and invite links need both.

Privacy strings (camera, motion, microphone, speech recognition) are in `Info.plist`. `UIRequiredDeviceCapabilities` includes `arkit`. On iPhone the app is portrait only, because heading and vision math assume portrait.

## 2. Firebase

1. Create a Firebase project and enable **Authentication** (Apple and Email link providers), **Firestore**, **Storage** and **Functions** (Blaze plan, needed for secrets and outbound calls).
2. Add a **Web app** and copy its config into `.env` (see `.env.example`):

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

3. Set the project in `.firebaserc`, then deploy:

   ```bash
   npm install -g firebase-tools
   ```

   ```bash
   firebase deploy --only firestore,storage,functions,hosting
   ```

4. Apple provider: in the Firebase console, add your Services ID, Team ID and key. For native sign-in, the bundle ID must be listed under the Apple provider.
5. Email link: add your Hosting domain to *Authorized domains*, and set `VITE_EMAIL_LINK_URL` (for example `https://your-project.web.app/signin`).

### Local emulators

These need Java 21 or later.

```bash
firebase emulators:start
```

Set `VITE_FIREBASE_EMULATORS=true` in `.env`. To run the security rules tests:

```bash
npm run test:rules
```

## 3. ElevenLabs voice

```bash
firebase functions:secrets:set ELEVENLABS_API_KEY
```

Optional parameters, prompted on deploy or set in `functions/.env`:

- `ELEVENLABS_VOICE_IDS`: comma-separated allowlist. The first voice is the default, and the app's `VITE_ELEVENLABS_VOICE_ID` should be one of them.
- `ELEVENLABS_MODEL`: defaults to `eleven_flash_v2_5` (low latency).
- `TTS_DAILY_CHAR_LIMIT`: per user, defaults to 20000.

Without a key, or when offline, the app uses the built-in iOS voice. Users can also switch the natural voice off in Settings.

## 4. Optional Core ML detector

To add door, stair and obstacle detection from a model, compile an object-detection model whose labels include `door`, `stairs`, `obstacle` or `person` to `PathSenseDetector.mlmodelc`, and add it to the App target's resources. `VisionEngine` loads it on the Neural Engine (`computeUnits = .all`) and reports `customModelLoaded: true` from `Vision.configure`. Detection slows down automatically when the device gets hot.

## 5. TestFlight

1. Set the version and build in Xcode, then *Product → Archive*.
2. Upload through the Organizer and add testers in App Store Connect.
3. Before external testing, review the drafts in `hosting/privacy.html` and `hosting/terms.html` and publish them. Complete the App Privacy questionnaire: camera data isn't collected, and scan uploads are user-initiated.
