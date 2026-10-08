# Live TV and Channels — implementation notes

Files: `src/screens/LiveTV.tsx` (`LiveTVScreen` plus shared pieces), `src/screens/Channels.tsx` (`ChannelsScreen`).
Neither file touches navigation, the shell, `src/ui/*`, `session.tsx` or `App.tsx`. The lead needs to swap the
placeholder imports in `Shell.tsx` for these two exports.

## Core service methods bound (`packages/client-core/src/channel-guide.ts`)

| Core API | Where | How |
| --- | --- | --- |
| `new ChannelGuideService(api, serverId)` | `useChannelGuide` | One instance per `api` + `session.viewer.serverId` + viewer scope (`viewerScope` from `app/content.ts`); disposed on unmount / viewer change. |
| `service.subscribe` / `service.getSnapshot` | `useChannelGuide` | Bound with `useSyncExternalStore`. |
| `service.load(route)` | on every route change | `replace` mode; the service retains the previous guide while refetching the same route. |
| `service.load(route, 'refresh' \| 'next')` | Pull to refresh / stale refresh (`useGuidePaging`), scrolling near the end, after a preference save | Always uses the service's current route so a stale closure can never page the wrong viewport. |
| `guideWindow(date?)` | initial route, `shift(±3h)`, `jumpToNow` | Three-hour, hour-aligned server viewport. The client never invents a schedule. |
| `saveChannelPreference(api, serverId, channel, requestId, values)` | `setPreference` | `requestId` comes from `channelOperationId(NativeModules.PorticoRuntime.newRequestId)` (same bridge the Host app uses). The id is cached per `[channelId, preferenceRevision, values]` so a retry re-sends the same id; the guide is refreshed after success rather than toggled optimistically. |
| `unavailableMessage(reason)` | `ProgrammeSheet` | Shown in a warning `Notice` when `tuneAvailable` is false. |
| `GuideRoute.search / favorites / includeHidden / sourceId` | `GuideFilterBar` | Search is debounced 350 ms; favourites and hidden are `undefined` when off so the query string matches the server default. |
| `ChannelGuide.nextCursor` | `useChannelGuide`, `useGuidePaging` | APL-SYS-08: continuous scrolling. Pages scrolled through are kept under their cursors (`useAppendedPages`), so `binding.guide.channels` grows; `GuidePager` is only the loading spinner. |
| `GuideChannel.logoPath` | `ChannelLogo` | Rendered through `useArtwork()` so the bearer token is attached. |

`library-channels.ts` is entirely owner/admin API (`/v1/admin/library-channels/*`) and is not used. Viewers receive
Library Channels through the same `/v1/guide` endpoint with `kind: 'library-channel'`, so `ChannelsScreen` reuses
`useChannelGuide('library-channel')`.

## Guide states → UI (`GuideState`)

| `guide.state` / phase | Treatment |
| --- | --- |
| loading, no guide | `GuideLoading` skeleton rows |
| `phase: 'error'`, no guide | `StateView` "The guide couldn't load" + Try again (`load(route)`) |
| `phase: 'error'`, retained guide | Warning `Notice` above the retained content + Try again (`refresh`) |
| `ready` | Content |
| `guide-stale` | Warning `Notice` + Refresh, content still shown |
| `no-guide-data` with channels | Info `Notice` + "Jump to now", channels shown with "No programme information" |
| `no-guide-data` without channels | `StateView` |
| `no-sources` | `StateView` — copy differs for Live TV vs Library Channels; filter bar hidden |
| `no-channels` | `StateView` + Refresh |
| `filter-empty` | `StateView` + "Clear filters" |
| `continuation-required` | Any channels on this page, then `StateView` + "Load more channels" (`next`) |
| preference save error | Danger `Notice` with Dismiss (also inside the programme sheet) |

## Layout

- **Handheld (< 900 pt wide)**: `ChannelList` — logo with channel-number chip, name, favourite/unavailable glyphs,
  current programme with a 3 pt `ProgressBar` and time range, "Next · 21:30 Title", and a "…" button.
  Tap = tune; long-press or "…" = `ChannelMenu` (Add to/Remove from favourites, Hide/Show channel).
- **Television and wide windows**: `TimelineGuide` — sticky channel column (raised-soft surface), half-hour ruler,
  programme blocks sized by duration inside a horizontal `Animated.ScrollView`, hour gridlines, accent "now" line
  with a dot on the ruler, live block with accent tint and a progress edge, recording dot in `colors.record`.
  Two hours fill the viewport so the three-hour window scrolls; on TV scrolling is driven by focus (`revealTimeline`),
  on iPad by touch. Press a block = `ProgrammeSheet` (details, Watch now, Favourite, Hide); press the channel cell =
  tune; long-press the cell = `ChannelMenu`.
- **Channels screen**: `ChannelCard` landscape tiles in a `Grid` (measured width so the rail is respected) on
  TV/wide, `ChannelList` on phone. No time controls — the screen re-requests the "now" viewport when the current
  window elapses.
- All colours/spacing/type come from `useTheme()`; every interactive element is `Focusable`-based.

## Assumptions

- `NativeModules.PorticoRuntime.newRequestId()` exists in the new app's native runtime (it does in Host and is
  referenced by `src/app/detail.ts`). If it is absent, preference saves surface "Could not create an operation identifier."
- `Intl.DateTimeFormat` with `timeZone` is available (Hermes on iOS/tvOS); falls back to UTC strings if it throws.
- `session.viewer.serverId` is the id `parseChannelGuide` expects; the screens render only once the session is ready.
- `Button` accepts `hasTVPreferredFocus` (it forwards to `Pressable` on react-native-tvos; tsc agrees).
- Source picker: `Segmented` up to 3 sources on phone / 5 on TV, otherwise an outline button opening a `Menu`.
  Hidden when there is one source.

## Unfinished / for the lead

- **Tuning**: `useTune()` in `LiveTV.tsx` is the only stub — marked `// TODO(lead): tune`. Replace its body with
  `player.tune(channel)` once `PlayerActions` exposes it. Channels are never VOD entries, so `play` is not called.
- Recording actions (`recordAvailable`, "Record this programme/series") are intentionally not built; recordings
  are shown as badges only. Add them to `ProgrammeSheet` when the DVR screen lands.
- Guide position memory (remembered scroll/focus across navigation, as Host does with `GuidePosition`) is not
  implemented; the route resets to "now" on each mount.
- `Field` on tvOS opens the system keyboard; if search on TV should instead use the Siri Remote dictation flow,
  wrap it in the shell's search affordance.
- ESLint reports only `react-native/no-inline-styles` warnings, which the design-system rules (no
  `StyleSheet.create`) make unavoidable across the app.
