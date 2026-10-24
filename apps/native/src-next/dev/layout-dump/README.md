# DEV native measurements

This producer uses the single public server `tools/fidelity/NATIVE-CONTRACT.md`.
The validator, comparator, colour math, calibration and tolerances remain there;
they are not copied into this application. Private references and adapters stay
outside public source and app packages.

The App owner installs **one** `installNativeLayoutDump(options)` in a DEV-only
branch, giving it a live whole-screen host getter, actual logical window width
and height, actual device pixel ratio, platform, and an explicit public semantic
ID → frame-anchor map. The returned owner supplies `capture()` and `dispose()`.
Optional `diagnostics: () => ({fontScale: PixelRatio.getFontScale()})` reads
fresh platform font scaling for each capture. Only a finite positive value is
emitted in top-level `diagnostics.fontScale`; unknown/invalid values are omitted.
It is unscored metadata, never part of viewport or geometry/font arithmetic.
`captureNativeLayoutDump()` calls that owner; the collector itself installs no
global command endpoint or payload logging. Production entry calls are inert.
App/Kit imports must additionally be inside `__DEV__` branches so Metro can strip
the instrumentation from production bundles.

Targeted existing native primitives use `registerNativeHost(host, facts)` from
the same entry. It returns a registration lease, or `undefined` outside DEV.
Do not register null refs: unregister the previous lease when a host changes or
unmounts. Preserve the primitive's existing ref and native callbacks.

The lease provides:

- `update({kind, semanticId?, role?, flattenedStyle?})`: already-flattened,
  curated scalar input style is **diagnostic only**. Asset references, objects,
  URLs, arbitrary props and getters are excluded.
- `recordTextLayout(event.nativeEvent.lines)`: actual native Text line events;
  input registrations reject these without reading them.
- `observeTextRectangles(reader)`: an optional current native window-space run
  observer. It supplies actual native run boxes in the same logical dp/pt units.
  The collector subtracts the measured screen origin; it never infers glyph
  transforms from a Text host box, shell scale or frame geometry. Without this
  observation, `textRects` is explicitly unavailable. Do not implement this
  observer by returning `measureInWindow()` or `getBoundingClientRect()` boxes.
- `recordResolvedStyle(facts)`: **only** actual observed/resolved native font
  and paint facts. Never pass `StyleSheet.flatten(...)` here.
- `recordNativeFocus(boolean)`: call only from the actual native focus/blur
  callback for this live host. Requested/selected focus and registry memory are
  not evidence. A stale lease or blur cannot clear a newer host's focus.
- `recordMaskLength(number)`: only an actually observed rendered mask count;
  never obtain it by reading a password/input value.
- `invalidateTextLayout()`, `invalidateResolvedStyle()`, `unregister()`:
  retire observations when their content/paint or host lifetime changes.

The dump walks the public mounted host tree. Input and image internals are
opaque; raw props, Fiber, auth stores, filenames, image URLs and asset bytes are
never inspected. Unobserved paint prevents text export. Missing focus/opacity
are null with explicit unavailability, never false/one guesses. Native Text
layout supplies text/line facts; a current native window-run observer supplies
run boxes. Missing either fact is unavailable rather than a host-box fallback.
Logical boxes/fonts are not multiplied or divided by device density. An offset
or mismatched whole-screen root fails `fullViewport`; no frame-specific offset,
zoom or display setting repairs it.
RN extent consistency follows the shared `sameLogicalExtent` relation: exact
equality or an exact float32 projection in either direction. Origins remain
exactly zero; recorded host/window numbers are never rounded or replaced.

These APIs alone establish no mounted-screen score. Actual App/Kit hooks,
compatible DEV execution and the shared offline comparator are still required.

`createAndroidNativeTreeObserver()` constructs the optional `observe` install
option only in DEV Android when the checked `PorticoLayoutObservation` module
exists. The existing public App install supplies it; no second root, global,
registry or route is introduced. The collector discovers the public host tree
once, selects exactly one registered `accounts-welcome` or `tv-front-door`
fixture View, and binds native requests to that View and the full-screen root.
Missing/duplicate scope prevents the native call. Retirement aborts publication;
it does not claim to interrupt a native UI turn already queued.

Native replies are validated against captured root/fixture/host tags. Unknown
fields, raw error messages, requested styles, URLs and asset references are not
forwarded. Real false/zero facts remain distinct from unavailable observations.
Native paint does not fall back to diagnostic styles or stale registered paint.
Unassociated family labels remain unavailable; they never become a requested CSS
family chain or an observed typographic identity.
The checked canonical identity field is `style.resolvedFontFamily`, supplied only
from the active shaped resource's verified name16 (otherwise name1). Legacy
observed platform labels belong to unscored `style.platformFontFamily`. Native
system labels and diagnostic/requested family chains never fill the identity.

An optional native window rectangle is coordinate evidence, not a replacement
for a collector box. A failing `fullViewport` reason retains the selected API,
unverified space, raw logical rectangle and same-host native/callback readback.
Native window text runs are withheld unless the selected root API, actual
`measureInWindow` and native window rectangle agree on the same live attachment.
No API is selected because its origin is zero, and no offset is subtracted to
fit an authored frame.
