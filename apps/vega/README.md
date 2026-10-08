# Portico for Fire TV (Vega OS)

The Portico television app for Amazon's Vega OS, built with the Vega SDK's React Native. The
screens are the Apple app's (`../native/src`), imported in place and never copied; this folder
holds only what Vega needs to run them.

| Path | Role |
| --- | --- |
| `index.js`, `src/Root.tsx` | Entry: the shared `App`, drawn on the television design canvas. |
| `src/shims/react-native.ts` | `react-native` as the app and the shared screens see it: the SDK's React Native, with the few exports whose names or behavior differ from the Apple TV build. |
| `src/shims/canvas.tsx` | The 1920×1080 design canvas (Vega lays a 1080p screen out as 960×540 at a pixel ratio of 2). |
| `src/shims/pressable.tsx` | `hasTVPreferredFocus` as a preference read once, as on Apple TV. |
| `src/shims/focus.tsx` | `TVFocusGuideView` with the Apple TV's meaning of `focusable={false}` and `autoFocus`. |
| `src/shims/snap.tsx` | Rows and pages that follow focus (the tvOS `snapToAlignment="item"` and `scrollSnap…` props). |
| `src/shims/text-input.tsx` | A field's hidden input, mounted only while the system keyboard is up. |
| `src/shims/motion.ts`, `reanimated.tsx` | The Reanimated API the shared screens use, without the library. |
| `src/debug.tsx`, `scripts/debug-sink.mjs` | An on-screen console for development (`portico.debugConsole` in `app.json`), and a listener for its lines. |
| `src/bridge/` | Every `NativeModules.Portico…` module the shared `src/bridge` expects, with the Apple names, methods and events, written over the SDK's APIs. |
| `src/overrides/` | Replacements for shared files that are Apple-specific: `native/<path under ../native/src>` and `packages/<path under ../../packages>`. |
| `metro.config.js` | Resolves `react-native` to the shim, community package names to the SDK's builds, and shared files to their overrides. |
| `scripts/vega.mjs` | Build, install, launch, remote keys, screenshots and logs. |

## Requirements

- Vega SDK 0.24 (`vega` on the PATH), which provides React Native 0.83 for Vega
  (`@amazon-devices/react-native-kepler` 4) and the virtual device (Vega OS 1.2).
- Node 22.

## Running

```bash
npm install --legacy-peer-deps
node scripts/vega.mjs device start     # the SDK's virtual device, headless
node scripts/vega.mjs run --release    # build, install and launch
node scripts/vega.mjs shot shot.png    # a screenshot of the virtual device
node scripts/vega.mjs key right select # remote keys
node scripts/vega.mjs logs             # the app's recent log lines
```

`node scripts/vega.mjs help` lists every command. A Release build embeds the bundle and needs no
Metro; `node scripts/vega.mjs start` runs Metro for a Debug build.

Checks: `npx tsc --noEmit` (this app and the shared sources together) and `npm run lint:strings`.

## Things the SDK's tools need to be told

`scripts/vega.mjs` handles all three; they matter when running the SDK's commands by hand.

- **Spaces in the checkout's path.** The build tools pass paths to a shell unquoted. From a
  checkout whose path contains a space, the script mirrors the app, the shared sources and the
  packages to `~/.cache/portico-vega-stage` (or `PORTICO_VEGA_STAGE`) and builds there.
- **An Intel `bash` first on the PATH** (Apple-silicon Macs with an old Homebrew). The SDK's
  wrappers start with `env bash`, every tool then runs translated, and packaging fails with
  "macOS x86_64 binary not available". The script puts `/bin` first.
- **Android emulators on the same machine.** The virtual device is a fork of the Android emulator
  and `vda` a fork of `adb`, with the same default ports, so each tool sees (and may stop) the
  other's devices. The script starts the virtual device on port 5701 (`PORTICO_VEGA_DEVICE_PORT`)
  and talks to it through its own device-tool server on port 5039 (`PORTICO_VEGA_ADB_PORT`).

## How the shared screens run unchanged

- `react-native` resolves to `src/shims/react-native.ts` for the app, the shared sources and the
  shared packages. Libraries in `node_modules` keep the SDK's package.
- `NativeModules` there serves the modules in `src/bridge`; `NativeEventEmitter` listens to their
  events; `requireNativeComponent` returns their views.
- `useTVEventHandler` reports the remote's keys in the Apple TV's vocabulary (`playPause`,
  `menu` for Back, `long…` for a held key).
- Focus, scrolling and text entry follow the Apple TV's rules where the SDK's differ: see the
  comments at the top of `focus.tsx`, `snap.tsx`, `pressable.tsx` and `text-input.tsx`.
- `react-native-reanimated` resolves to `src/shims/reanimated.tsx`. Amazon's build of the library
  is not installed (styles it drove were applied late or to the wrong control); the shared code's
  use of it is served by a small engine in `motion.ts`. React Native's own `Animated` is the SDK's.
- A shared file that cannot be right on Vega has a replacement under `src/overrides` at the same
  relative path (a replacement may import the file it replaces, to wrap it). Each one corresponds to a change the shared file should take; see the port log.

## Settings in `app.json`

Under `portico`:

- `hostedUrl`: the Portico Account origin; empty for the shared default.
- `animations`: `false` makes every transition arrive at once (for hardware that cannot keep up).
- `debugConsole`: `false` for anything that ships. `true` draws the app's console output and every
  call into the Portico modules over the screen; `"errors"` draws only what went wrong. (An app's
  own console output does not reach the device log in a Release build.) Values that could be
  credentials are shown by their length only.
- `debugSink`: with the console on, an address the same lines are also posted to, for example
  `http://10.0.2.2:5799` with `node scripts/debug-sink.mjs` running on this machine. The player
  is the reason: once video is drawn, the virtual device's screenshots stop updating until the app
  is restarted, so the player is checked by its trace.

## Playback

`src/bridge/playback.ts` is `PorticoPlaybackModule` and the `PorticoPlayer` view: the Apple
controller's contract (a lease, full-state commands, sequenced facts) over the SDK's W3C media
element. Three things about that element shape the rest:

- It opens an address itself only over HTTPS, and has no HLS client. The server's HLS is played by
  `src/bridge/hls.ts` through media source extensions (the app fetches the segments), which is
  also the only way to play from a server on plain HTTP. `capability-profile.ts` asks an HTTP
  server for `hls_fmp4` only.
- It cannot change speed. `supportedRates` is `[1]`.
- The system acts on it directly for the remote's transport keys unless the app declares the
  media category in `manifest.toml` and supplies a handler: `src/bridge/system-media.ts` turns
  those requests into `PorticoSystemMediaCommand` events for the shared player.

Subtitles are the server's cue document, drawn by `PorticoPlayer` (`src/bridge/subtitles.ts`).

Music and audiobooks use the same player. On Apple a native owner takes them over so that they
continue while JavaScript sleeps; here the shared queue player keeps them
(`src/overrides/native/bridge/native-listening-kinds.ts`), so there are no gapless or crossfade
edges: the next track starts when its stream opens.

## Not provided

- **Rows on the Fire TV home screen.** The SDK's route is content personalization
  (`@amazon-devices/kepler-content-personalization`), which reports what a customer watches to
  Amazon by catalog identifier. A personal library has no such identifiers, and Portico does not
  send viewing activity to third parties. `PorticoTopShelf` keeps the shared code's record and
  draws nothing.
- **Nearby discovery** (no mDNS API), **AirPlay, picture in picture, downloads, casting**: the
  modules exist with the Apple names and answer "nothing" or "not available".

## Storage

Vega has no keychain. Records (credentials, the TV sign-in key, journals, the profile trust
vault) are files in the app's private `/data` directory, which no other app can read and which is
removed with the app. Writes are crash-safe (two slots per record, verified by reading back).
