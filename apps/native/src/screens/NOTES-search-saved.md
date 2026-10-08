# Search and Saved screens — binding notes

## Files
- `src/screens/Search.tsx` — exports `SearchScreen` (no props).
- `src/screens/Saved.tsx` — exports `SavedScreen({route})` and `PlaylistScreen({route})`.

Both are unwired: `Shell.tsx` still points `Search`/`Saved` at `Placeholders.tsx`, and the `Playlist` route has no `Stack.Screen` yet. `SavedScreen` navigates with `navigation.push('Playlist', {playlistId, title})`.

## Service methods bound

### `SearchService` (`packages/client-core/src/search.ts`)
- `new SearchService({api, scope})` — scope from `viewerScope(session, api)` in `src/app/content.ts`; one instance per mounted screen, `dispose()` on unmount/scope change.
- `subscribe` / `getSnapshot` — bound with `useState` + `subscribe` (same pattern as `useContent`).
- `select(q, group?)` — called after a 300 ms debounce on typing, immediately on group-chip change and on keyboard Search. An empty query calls `select('')`, which the service turns into `cancel()` (idle state).
- `next(group)` — "Next" in the single-group grid (server paging replaces the page; it is not append).
- `previous()` — "Previous" in the single-group grid, enabled from `snapshot.pagination.canPrevious`.
- `retry()` — Retry action on the error Notice.
- `refresh()` — Refresh action when `phase === 'refresh-required'`.
- Read from the snapshot: `phase`, `query`, `sections` (heading, entries, totalCount, nextCursor), `pagination.canPrevious`, `error`, and `data.filters[group].options` for per-chip counts.

### `SavedService` (`packages/client-core/src/saved.ts`)
- `new SavedService({api, scope, requestId})` — `requestId` is `NativeModules.PorticoRuntime.newRequestId()` lower-cased; one instance per mounted screen.
- `select(route)` — `{view: 'watchlist' | 'favorites' | 'playlists', sort?, direction?}` from the Saved tabs; `{view: 'playlist', playlistId}` from `PlaylistScreen`.
- `next(sectionId)` / `previous()` — pager under the grid/list; `sectionId` is the first section carrying a `nextCursor`.
- `retry()`, `refresh()` — error and refresh-required notices, plus the header refresh button.
- Read: `projection.sections` (entries are the `SavedEntry` union — `ContentEntry`, `PlaylistCard`, `PlaylistOccurrence`), `projection.sorts` / `projection.query` for the sort chips, `projection.empty`, `playlist` (name, summary, entryCount), `pagination.canPrevious/history`, `error`.
- Not bound: `mutate` (create/rename/add/remove/reorder/share), `loadCandidates`, `loadOrder`, `externalPosition`, `setScope`.

### `PersonalSavedService` (`packages/client-core/src/personal-saved.ts`)
- Used only for the History tab, because `SavedService.read()` is a no-op for `history` (and collections/views/resource).
- `new PersonalSavedService(api, scope, requestId)`; `select({view: 'history'})` the first time the tab is opened; `refresh()`, `next()`, `previous()`.
- Read: `entries` (`media`, `positionSeconds`, `completed`, `updatedAt`), `loading`, `error`, `history`, `nextCursor`.
- Not bound: `mutate` (`clear-history`, `reset-viewing-activity`), `loadLibraries`, `loadCandidates`.

## Assumptions
- Screen width: the rail sits beside the stack, so `Grid`'s default (`window.width − gutters`) is too wide. Both screens measure themselves with `onLayout` and pass `width` to `Grid`; before the first layout they fall back to `window.width − metrics.railWidth`.
- Grid card width uses the shape shared by all entries on the page; mixed-kind pages (e.g. a watchlist with movies and albums) fall back to poster width, with each card still drawn in its own shape.
- Sort chips appear only when the projection offers `sorts` (Watchlist / Favourites); the chosen sort is kept per tab in screen state and sent as `sort`/`direction` on the `SavedRoute`.
- History progress uses `positionSeconds / media.duration` unless `completed`, in which case the card shows a "Watched" badge and no progress line.
- Playlist ordinals continue across server pages (`history.length × 40`, the service's fixed page size).
- Playlist "Play" starts the first visible entry with `playback` via `usePlayerActions().play`; queueing the rest of the playlist is left to the player once it exists.
- Hidden playlist occurrences render as a disabled "Unavailable item" row that keeps its ordinal.
- Search state persists while the screen stays mounted (pushing Detail keeps it). Rail re-selection resets the stack, which remounts and clears it.
- On tvOS the search `Field` is a native `TextInput` (system keyboard); `autoFocus` is handheld-only.

## Unfinished / follow-ups
- Playlist mutations (create, rename, reorder, add/remove, share) and history clearing are not exposed; the services support them.
- Search result groups for people are reported unavailable by the server (`capabilities`) and are not surfaced.
- No pull-to-refresh; refresh is the header button and the notices.
