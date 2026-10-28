# A1 native composition — exact held-hook plan

New implementation files are in this checkout; no existing hook is edited. Compose against fresh main, preserving native `552cb541db1ceb9199bde483822e8de42f7e40d6` availability changes and A2's metadata work. Canonical source is P2-59-server; use the official mirror, never these notes to manufacture package files. Server 47b `e90b3d58...` is not a native commit.

## New production seams

- `screens/library/selection-actions.ts`: `nativeSelectionActionInput(target, action, context)` is the synchronous offer/dispatch guard. `createNativeLibrarySelectionAction(context, source, activation, model, signal?, downloads?)` and `createNativeHomeSelectionAction(context, homeController, signal?, downloads?)` capture the actual model operation and use ONE canonical `SelectionActionController`. `openDelete(deleteFiles)` and `openDownload(quality)` open fresh exact preparations. The returned object provides `subscribe/getSnapshot/current/dispose` and the controller's confirmation/retry/cancel methods. No row enumeration.
- `screens/library/SelectionActionSurface.tsx`: `NativeQueryDeleteMediaDialog` and `NativeQueryDownloadSheet` are the real aggregate presentation branches. They share kit `SelectionSurface`, theme, controls, keyboard text field and cancel/retry actions; no legacy `DeletePreview` or invented targets. Their prop is `{action, onClose, ownerHeader?}`. Download quality choices come from real `DownloadsService.qualities()`. Choosing quality only prepares; Download explicitly confirms the resulting exact descriptor. Download complete means server admission, not ready artifacts or transferred files.
- `screens/library/selection-action-downloads.ts`: `stepNativeSelectionActionDownloads` performs at most one status + one exact inventory page, max20 items and bounded by actual free queue slots. Waits terminal admission, then pages a fixed inventory. `admit` MUST persist exact native wants and cursor atomically. `NativeSelectionActionDownloadQueue.follow(operationId, deviceId)` MUST durably register one actual explicitly confirmed command before the first confirmation transport. Core replay never allocates a new ID.

## 1. Actual DeleteMediaDialog branch — no kit/types conflict

In `kit/selection/DeleteMediaDialog.tsx`, import the new branch and `NativeQueryActionSurfaceProps`. Change only the component signature and insert this branch after the existing unconditional `useTheme` and `useRef` calls, before accessing legacy props:

```tsx
type QueryProps = {queryAction: NativeQueryActionSurfaceProps['action']; ownerHeader?: React.ReactNode; onClose: () => void};
export function DeleteMediaDialog(props: DeleteMediaDialogProps | QueryProps) {
  const theme = useTheme();
  const {isTV, colors} = theme;
  const phone = theme.platform === 'phone';
  const footerButton = selectionFooterProps(theme);
  const cancelRef = useRef<View>(null);
  if ('queryAction' in props) return <NativeQueryDeleteMediaDialog action={props.queryAction} onClose={props.onClose} ownerHeader={props.ownerHeader}/>;
  // Existing explicit body unchanged, including deleteSelectionGate and <=200.
```

Relative import from kit/selection: `../../screens/library/SelectionActionSurface`. This deliberately needs NO `types.ts` or `presentation.ts` edit; A2 owns those. All existing explicit props and gate remain intact. The aggregate branch never receives a manufactured explicit preview or no-op legacy callbacks.

## 2. Actual DownloadSheet request/disposal

In `screens/downloads/request.ts`, add `queryAction?: NativeSelectionActionPresentation` (type import from `../library/selection-actions`) to `NativeDownloadRequest`. The existing `askNativeDownload` admission becomes:

```ts
if (!request.title || !(request.itemId || request.container?.id || request.queryAction)) return;
const previous = current;
// Existing immutable request construction and opening key registration.
if (previous?.queryAction && previous.queryAction !== current.queryAction) previous.queryAction.dispose();
publish();
```

In `closeNativeDownload`, after the expected-request identity check, capture `const closing = current`, clear `current`, then `closing.queryAction?.dispose()` and publish. A newer request can never be dismissed by the old callback. A repeated request of the same action does not dispose its own action.

In `DownloadSheet.tsx`, keep the unconditional request-store hook, then branch BEFORE the reading/item/container branches:

```tsx
return request?.queryAction
  ? <NativeQueryDownloadSheet key={nativeDownloadRequestKey(request)} action={request.queryAction}
      onClose={() => {closeNativeDownload(request);}}/>
  : request?.reading ? /* existing reading branch */ : /* existing body */;
```

The query action itself owns captured principal/route/source, its idle quality menu gets retirement notifications, and disposal never DELETEs accepted work. Do not route a query into `service.request`, `requestContainer` or `containerOptions`.

## 3. Native library toolbar and producer

In `screens/library/selection.tsx`, import the new producer/guard/type, existing `askNativeDownload/closeNativeDownload`, and real `offlineDownloads` for the queue port below. Keep the explicit `openAdmin` implementation. Add these per-store fields beside bulk state:

```ts
let queryAction: NativeLibrarySelectionAction | undefined;
let stopQueryAction: (() => void) | undefined;
const closeQueryAction = (expected?: NativeLibrarySelectionAction) => {
  if (expected && queryAction !== expected) return;
  const closing = queryAction;
  queryAction = undefined;
  stopQueryAction?.(); stopQueryAction = undefined;
  if (closing) {
    const request = getNativeDownloadSnapshot();
    if (request?.queryAction === closing) closeNativeDownload(request);
    closing.dispose();
  }
  emit();
};
const openQueryAction = (kind: 'delete' | 'download', view: SelectionSnapshot<BrowseSelectionContext>) => {
  if (view !== snapshot() || !view.active || view.target?.mode !== 'query' || !producer || !visible()
    || queryAction || bulk || destinations || pending || personalController
    || personal?.service.getSnapshot().busy || personal?.service.getSnapshot().results.length) return;
  try {
    nativeSelectionActionInput(view.target, kind, context);
    const action = createNativeLibrarySelectionAction(context, source, activation, producer.model, undefined, {
      follow: (operationId, deviceId) => offlineDownloads.followSelectionAction(operationId, deviceId),
    });
    if (snapshot() !== view || action.target !== view.target) {action.dispose(); return;}
    queryAction = action;
    stopQueryAction = action.subscribe(() => {
      if (!action.current()) closeQueryAction(action); else emit();
    });
    if (kind === 'delete') void action.openDelete().catch(error => {
      if (queryAction === action && action.current()) services.reportError(error, 'detail');
    });
    else askNativeDownload({title: selectedItemsLabel(view.summary), queryAction: action,
      lifetime: {signal: action.source.signal!, isCurrent: action.current}});
    emit();
  } catch (error) {services.reportError(error, 'detail');}
};
```

Add store `queryAction`, `openQueryAction`, `closeQueryAction`, and `queryOffer(kind, view)`; the latter calls the same `nativeSelectionActionInput` under try/catch and returns false on refusal. `Store` gets matching signatures. `busy()` includes `!!queryAction`, and `active()` includes it so an accepted job remains visible if its own deletion refreshes the grid. `cancel/clear/reset/dispose` explicitly close the current presentation; accepted work and the durable native follow remain alive.

In `LibrarySelectionBars`, offer query Delete/Download only when `queryOffer` succeeds. Remove ONLY the corresponding disabled unavailable entry; retain unrelated unavailable actions and the native47b `nativeSelectionActionUnavailable` guards. Do not apply the explicit delete-limit rule to an exact A1 query offer. Explicit selections continue through `openAdmin`. Query `onAction` dispatches `openQueryAction` before explicit admin routing. Query paths never check `selectedKeys.length` or call `entriesFor`.

Render `<DeleteMediaDialog queryAction={store.queryAction()!} ownerHeader={...} onClose={() => store.closeQueryAction(theExactAction)}/>` only for `action.controller.getSnapshot().input?.action === 'delete'`; Download is presented through the existing shell DownloadSheet. Use captured action target summary when the selection model has retired; do not rebuild the operation from the latest page.

Own-action catalogue publication: split `reset(preserveQueryAction = false)`, closing query presentation only when false. In the source subscription, retain it only if `queryAction.current()` and its snapshot is possibly submitted (`job`, `submitting` or `uncertain`). Then `reset(true)` may dispose the old producer; the action's captured source still checks original library/tab/queryRevision/route/principal, while ignoring page revision AFTER submission. While the retained query action owns the UI, `ensure()` must not call ordinary reset/recreate behind it. A user query/tab/route/viewer change still closes it immediately. No automatic cancel of accepted commands.

## 4. Home interception and overlay

Native composition's selection `execute`/`onAction` MUST intercept only query `delete` and `download` BEFORE calling the existing HomeSelectionController (its explicit identity conversion rejects query mode). Capture `homeController.selection.getSnapshot()` by identity, call the same guard, then `createNativeHomeSelectionAction(context, homeController, originalRouteSignal, queuePort)`; present Delete through the actual query branch and Download through `askNativeDownload`. Retained callback checks both original Home snapshot and action identity.

Keep one query-action holder/subscription owned by native composition, beside Home's existing explicit controller. Pass this optional holder to `HomeSelectionBars` and `HomeSelectionOverlays`. Bars replace ONLY exact query Delete/Download offers with the canonical synchronous guard's result; retain explicit rules. Overlays render `<DeleteMediaDialog queryAction={queryAction} .../>` ahead of the existing explicit `state.deletion` branch, which stays unchanged. No second core state machine or request parser is added to HomeSelectionController. Source captures `context.home.getSnapshot().document` by identity plus exact viewerFence; subscribes Home, selection, authority and navigation. New producer already implements these guards.

## 5. Durable real native transfer queue

These are held existing hooks, NOT permission to create another native downloader/state owner. In `apps/native/platform/offline-downloads.ts`:

1. Add `selectionActions: Owned<NativeSelectionActionDownloadIntent>` to `Stored`; initialize `{}` in `emptyStored`, and strictly parse the optional map in `readStored` (key equals URL-safe operationId, deviceId URL-safe, cursor string<=512; <=16 active per owner). Old documents retain their other fields. These are explicitly confirmed command intents, never query selectors, query counts, title ID lists or result caches.
2. Add `followSelectionAction(operationId, deviceId)`: require supported native sink, adopted owner and connected matching service; validate IDs; on existing marker require same device and preserve cursor; enforce16 cap BEFORE accepting a new command; add `{operationId,deviceId,cursor:''}` and persist through the EXISTING state writer. Failed persistence must reject so canonical controller does not send confirmation. Roll back only this exact newly inserted marker on failed write; never overwrite concurrent newer state. Same original ID replay is idempotent. Do not call a second NativeModules readState/writeState owner.
3. Add one bounded `enrollSelectionActions(owner, service, generation)` quantum to `collectWanted` before ordinary wants processing. Select one pending marker fairly; call new `stepNativeSelectionActionDownloads` with actual authenticated API, generation/viewer current guard, and `room = max(0, min(20, ENROLL_BACKLOG - Object.keys(wanted[owner]).length))`. `admit` rechecks owner/generation, remaining queue capacity and original marker object identity (hold original marker in the caller closure; helper snapshots its values); add exact page preparation IDs to existing wanted/enrolledPreparations with `display(preparation)` only if not already local/wanted. If capacity changed during the read, leave cursor/wants unchanged and retry a smaller page. Advance that marker's cursor, or remove that marker at EOF, and persist wants+cursor in the SAME existing state write. Snapshot old touched entries/marker and restore them by identity on failure; reject and do not transfer until durable write succeeds. No unbounded member set, no profile-wide discovery, no `service.refresh()` used to discover A1 inventory.
4. Reuse native tending/collect scheduling. A blocked queue waits for native capacity; a nonterminal server operation waits for next ordinary pass. A successful page schedules another bounded pass only while room remains. Fairly rotate markers so one large command cannot monopolize. On transient status/inventory failure keep marker and publish a typed pending error; no zero-success interpretation.404 after an ambiguous submission remains unresolved; preserve the command marker and let original confirmation replay resolve it.403/expired commands likewise retain a visible failed intent until explicit user removal, never enroll another operation/profile instead. Local cancel/removal of a pending follow does not cancel or undo server effects.
5. Ensure a failed A1 enrollment read does NOT return early and starve existing wanted transfers. Actual native grant, integrity verification, native transfer inventory and publication flow stay unchanged. Cancellation/partial terminal A1 commands may still have exact admitted preparations; enroll only the filtered inventory. No Vega/TV sink.

Import helper/type from `../src-next/screens/library/selection-action-downloads` (framework-free; depends only on canonical core). Export `followSelectionAction` through the existing next offline facade if its type facade needs it; do not replace actual offline singleton. Only native library/Home producer queue ports call it after typed/explicit confirmation. The helper's tests inject the native atomic-admit boundary; composed native queue tests must prove restart, persistence failure and capacity behavior against the genuine Stored/wanted writer.

## Focused composition checks still required

- Official schema/apigen+Cast and native mirror by lead; then run the ENTIRE named `next-library-selection-actions.test.ts` (real controller transport cases need the registered A1 routes).
- Native actual library bar -> Delete dialog -> 257 preview -> typed keyboard confirmation -> stable ambiguous replay/cancel; Download bar -> real sheet qualities -> exact device/quality preview -> explicit confirm -> persisted operation marker -> filtered native want/grant.
- Native actual Home bar interception and overlays, source document replacement, query exclusions/refinement refusal, no Detail/Browse enumeration.
- Native queue restart between want admission and cursor write (one atomic write), failed native write before POST, terminal partial inventory, backlog fairness, route closure after POST while background queue continues.
- Vega Metro shares native library/Home/kit paths without overrides; actual `offlineDownloads.supported` is `!!native && !Platform.isTV`, Vega bridge start/writeExtra reject unavailable. Verify no request/sink attempted with that false capability. No device/build acceptance claimed by these unit tests.

Pure tests already cover exact selector257, owner/refinement/Vega refusal, all source retirements, real server quality menu, Home document capture, aggregate Delete keyboard props/stale callbacks, terminal inventory paging/backpressure/failed-admit and partial cancellation. New-route-dependent controller tests are written, pending official route generation.

## Executed validation receipt / throttle boundary

- Mini1 before throttle: selected7 native tests passed (`--test-name-pattern='exact offers|source retires|download reads|aggregate Delete|exact inventory|Home interception'`, named new test file, existing native register + disposable loader redirecting ONLY new canonical modules to P2-59-server; no mirrored files written). Inventory unit harness stubs the not-yet-generated A1 status transport, while exercising the actual existing inventory route/strict parser. The four real-controller new-route cases are written but unrun pending official generation.
- Touched-file React hooks ESLint completed exit0. Canonical `countLiterals` returned count0/hits[] for all3 new production files. An earlier CLI invocation used the wrong scanner arguments and returned usage; the subsequent direct scanner result is the actual copy check.
- Typecheck is NOT green: a first focused semantic pass reported the Home import shadowed by `home-selection.ts`; changed the import to `home-selection/index`. Recheck was interrupted by lead throttle (exit143), neither a pass nor a source failure. The earlier broad transitive semantic attempt was stopped locally for excessive scope. No duplicate check was started after throttle.
- Last source-only refinements (after the7 passing tests): explicit count keyboard, processed/admitted wording instead of claiming download artifacts ready, Promise rejection/quality-menu retry behavior, immutable inventory intent/API/room capture. These require the final named test rerun; no post-throttle test was run.
- No Go/build/device/browser work. No Git staging/commits/base moves or native mirrors. Existing shared hooks remain untouched by this helper. Own scratch/processes are cleaned at handback; lead performs permitted final route/combined native checks after official composition.
- Cleanup measured: own scratch3299 bytes removed, directory absent, no owned test/typecheck process remains. Filesystem start585GiB used/323GiB free65%; handback596GiB used/312GiB free66% (shared-host activity); available RAM at handback23GiB. No shared cache/source/history cleanup.
