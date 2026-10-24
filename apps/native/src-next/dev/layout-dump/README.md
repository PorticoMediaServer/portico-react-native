# DEV native measurements

This producer uses the single public server `tools/fidelity/NATIVE-CONTRACT.md`.
The validator, comparator, colour math, calibration and tolerances remain there;
they are not copied into this application. Private references and adapters stay
outside public source and app packages.

The App owner installs **one** `installNativeLayoutDump(options)` in a DEV-only
branch, giving it a live whole-screen host getter, actual logical window width
and height, actual device pixel ratio, platform, and an explicit public semantic
ID → frame-anchor map. The returned owner supplies `capture()` and `dispose()`.
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

These APIs alone establish no mounted-screen score. Actual App/Kit hooks,
compatible DEV execution and the shared offline comparator are still required.
