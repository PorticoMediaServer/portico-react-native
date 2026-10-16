# bridge/

Local adaptation: `setup-codes.ts` lowercases native request identifiers (NSUUID emits uppercase; the core validates lowercase UUIDv4).

JS bindings for the shared native modules in `../../Native` and the headless
core in `packages/client-core`. These files were carried over unchanged (apart
from import paths) from the original host; they contain no UI. Everything
outside this folder is new.

## Platforms

This folder (with `src/ui/theme.ts` and `src/app/i18n.ts`) is the only place that may ask which
operating system it is on. Screens know `isTV` and nothing else.

- `device-platform.ts`: the platform name sent to the server (`ios`, `tvos`, `android`,
  `androidtv`, `firetv`; the Vega app's own copy says `vega`), the device noun, and what the
  platform has (`hasAirPlay`, `playOnPlatform`).
- `event-stream.ts`: the account's `/v1/events` feed, read as a stream by the native reader on the
  same verified connection as the API. The shared hub falls back to the bounded long poll only
  when the stream cannot be opened.
- `capability-document.ts`, `mpv-profile.ts` and `audio-decode.ts`: the one capability document the
  server plans from (a profile for the platform's player and one for mpv, the screen, the audio
  output, the viewer's Player setting and playback fixes), from the shared table for the platform
  and what the device reports (`MediaCodecList`, the display, the audio output).
  `capability-publisher.ts` sends it when it changes.
- `NativePlaybackCoordinator.ts` and `player-engines.ts`: the lease, commands and facts of the
  player engine in use (`../../Native/ENGINE-CONTRACT.md`). The server's side of a session (its
  timeline, re-plans and end) is `../player/native-playback.ts`.
- `random-id.ts`: installs `crypto.randomUUID` from the native UUID source (Hermes has no Web
  Crypto, and shared services make request ids with it).

The native modules have the same names, methods and events on Apple (`../../Native`) and Android
(`../../android/app/src/main/java/tv/getportico/portico/native`). A module that is absent on a
platform (`PorticoDownloads` on a television, `PorticoCast` on Fire TV) is `undefined` here, and
each binding treats that as "this device does not have the feature".
