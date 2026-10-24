/** Produces the public fidelity contract; validation/comparison stay in server tools/fidelity. */
import {measureNativeHost, relativeToRoot, type HostRect} from './native-host.ts';
import type {NativeMeasurementRegistry} from './registry.ts';

export type NativeViewport = Readonly<{width: number; height: number; deviceScaleFactor: number}>;
export type NativeCaptureOptions = Readonly<{
  root: object;
  viewport: NativeViewport;
  platform: 'android' | 'ios' | 'tvos';
  registry: NativeMeasurementRegistry;
  /** Explicit public semantic ID to frame anchor; unlisted IDs are not serialized. */
  anchors?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}>;
type Node = object & {
  nodeType?: unknown; nodeName?: unknown; childNodes?: unknown; isConnected?: unknown;
  offsetWidth?: unknown; offsetHeight?: unknown;
};
type Element = Record<string, unknown> & {id: string; parent: string | null; box?: HostRect};
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export async function collectNativeScreen(options: NativeCaptureOptions) {
  const {registry, root, viewport, signal} = options;
  const elements: Element[] = [], strings: Record<string, unknown>[] = [];
  const unavailable: {element: string; property: string; reason: string}[] = [];
  const anchorIssues: {kind: string; frame: string; elements: string[]}[] = [];
  const missing = (element: string, property: string, reason: string) => unavailable.push({element, property, reason});
  const revision = registry.revision();
  const measuredRoot = await measureNativeHost(root, {signal});
  const rootBox = 'rect' in measuredRoot ? measuredRoot.rect : undefined;
  if ((root as Node).isConnected === false) missing('root', 'isConnected', 'native root is no longer mounted');
  if (!rootBox) missing('root', 'box', 'native whole-screen root measurement unavailable');
  const knownViewport = finite(viewport.width) && viewport.width > 0 && finite(viewport.height) && viewport.height > 0
    && finite(viewport.deviceScaleFactor) && viewport.deviceScaleFactor > 0;
  const fullViewport = !!rootBox && knownViewport && rootBox.x === 0 && rootBox.y === 0
    && rootBox.width === viewport.width && rootBox.height === viewport.height;
  if (!fullViewport) missing('root', 'fullViewport', 'measured screen root does not equal the actual logical window');
  const mounted = new Set<object>();
  const nodes = new Map<string, Node>();
  const childRecords = new Map<string, Element[]>();
  const anchors = new Map<string, string[]>();
  const walk = async (node: Node, parent: string | null, id: string): Promise<void> => {
    if (signal?.aborted) {missing('root', 'captureState', 'capture cancelled'); return;}
    if (elements.length >= 2000) {missing('root', 'elements', 'native tree exceeds capture bound'); return;}
    if (node.isConnected === false || node.nodeType === 3) return;
    mounted.add(node);
    nodes.set(id, node);
    const observed = registry.read(node);
    const tag = typeof node.nodeName === 'string' && /^[A-Za-z][A-Za-z0-9:_-]{0,100}$/.test(node.nodeName) ? node.nodeName : 'unknown';
    if (tag === 'unknown') missing(id, 'tag', 'public native node name is unavailable');
    const input = /TextInput|EditText|UITextField|SecureText/i.test(tag) || observed?.kind === 'input';
    const image = !input && (/Image|SVG/i.test(tag) || observed?.kind === 'image');
    const text = !input && (observed?.kind === 'text' || /Text|Paragraph/i.test(tag));
    const measured = node === root ? measuredRoot : await measureNativeHost(node, {signal});
    const box = rootBox && 'rect' in measured ? relativeToRoot(measured.rect, rootBox) : undefined;
    if (!box) missing(id, 'box', 'native host bounds unavailable');
    let children: object[] = [];
    // Inputs and image slots are opaque. Never visit input internals or image source/asset props.
    if (!input && !image) {
      try {
        const childrenValue = node.childNodes;
        if (childrenValue && typeof childrenValue === 'object' && Symbol.iterator in childrenValue) {
          for (const child of childrenValue as Iterable<unknown>) {
            if (children.length >= 2000) {missing(id, 'children', 'native child list exceeds capture bound'); break;}
            if (typeof child === 'object' && child !== null) children.push(child);
          }
        } else missing(id, 'children', 'public native childNodes traversal is unavailable');
      } catch {missing(id, 'children', 'public native childNodes traversal failed');}
    }
    const elementChildren = children.filter(child => (child as Node).nodeType !== 3);
    const mapped = observed?.semanticId && options.anchors ? Object.getOwnPropertyDescriptor(options.anchors, observed.semanticId)?.value : undefined;
    const frame = typeof mapped === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(mapped) ? mapped : undefined;
    if (frame) anchors.set(frame, [...(anchors.get(frame) ?? []), id]);
    const record: Element = {id, parent, frame: frame ?? null, tag, role: observed?.role ?? null,
      leaf: elementChildren.length === 0, box, style: observed?.measuredStyle ?? {}, focused: null,
      effectiveOpacity: observed?.effectiveOpacity ?? null,
      effectiveBackgroundColor: observed?.effectiveBackgroundColor,
      diagnostics: {flattenedStyle: observed?.flattenedStyle ?? {}}};
    if (record.effectiveOpacity === null) missing(id, 'effectiveOpacity', 'current native paint opacity has not been observed');
    if (!record.effectiveBackgroundColor) missing(id, 'effectiveBackgroundColor', 'ancestor-composited native background has not been observed');
    const visiblePaint = box && rootBox && box.width > 0 && box.height > 0 && box.x < rootBox.width && box.y < rootBox.height
      && box.x + box.width > 0 && box.y + box.height > 0 && observed?.effectiveOpacity !== undefined && observed.effectiveOpacity > 0;
    if (!input && text) {
      if (!visiblePaint) {
        missing(id, 'ownText', 'visible native paint has not been observed; hidden/unverified text is not exported');
        missing(id, 'textRects', 'visible native Text paint has not been observed');
      } else if (!observed?.lines || elementChildren.length) {
        missing(id, 'ownText', 'native Text layout/leaf ownership is not available');
        missing(id, 'textRects', 'actual native Text line geometry is not available');
      } else {
        record.ownText = observed.lines.map(line => line.text).join('');
        // Native line coordinates are local. Do not infer an animated transform from shell scale.
        const nativeLocalSizeKnown = box && finite(node.offsetWidth) && finite(node.offsetHeight)
          && node.offsetWidth === box.width && node.offsetHeight === box.height;
        if (nativeLocalSizeKnown) {
          const rects = observed.lines.map(line => ({x: box.x + line.x, y: box.y + line.y, width: line.width, height: line.height}));
          record.textRects = rects;
        } else missing(id, 'textRects', 'native run-to-window transform is not observed; host boxes are not text runs');
        if (record.ownText) strings.push({id: `${id}:text:0`, owner: id, frame: frame ?? null, kind: 'text', text: record.ownText, rects: record.textRects, style: record.style});
      }
      for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'color']) {
        if (typeof (record.style as Record<string, unknown>)[property] !== 'string') missing(id, property, 'resolved native font/paint fact is not available');
      }
    } else record.ownText = '';
    if (input) {
      record.input = {value: null, redacted: true, maskedLength: observed?.maskedLength};
      if (observed?.maskedLength === undefined) missing(id, 'maskedLength', 'rendered mask length is not observed');
    }
    if (image) {
      record.image = {kind: /SVG/i.test(tag) ? 'icon' : 'image'};
      missing(id, 'image.fit', 'native image fit/load facts have not been observed');
    }
    elements.push(record);
    if (parent !== null) childRecords.set(parent, [...(childRecords.get(parent) ?? []), record]);
    for (let index = 0; index < elementChildren.length; index++) await walk(elementChildren[index], id, `${id}.${index}`);
  };
  if (rootBox) await walk(root, null, 'root');
  for (const element of elements) {
    const node = nodes.get(element.id)!;
    const focused = registry.actualFocus(node, mounted);
    element.focused = focused ?? null;
    if (focused === undefined) missing(element.id, 'focused', 'no native focus event for this mounted capture epoch');
  }
  for (const element of [...elements].reverse()) {
    const children = childRecords.get(element.id) ?? [];
    if (typeof element.ownText === 'string' && children.every(child => typeof child.normalizedText === 'string')) {
      element.normalizedText = normalize([element.ownText, ...children.map(child => child.normalizedText)].join(' '));
    } else missing(element.id, 'normalizedText', 'visible descendant native Text is unavailable');
    const knownOwnRects = element.ownText === '' || typeof element.ownText === 'string' && Array.isArray(element.textRects);
    if (knownOwnRects && children.every(child => Array.isArray(child.descendantTextRects))) {
      element.descendantTextRects = [
        ...(Array.isArray(element.textRects) ? element.textRects : []),
        ...children.flatMap(child => child.descendantTextRects as unknown[]),
      ];
    } else missing(element.id, 'descendantTextRects', 'some native descendant text geometry is unavailable');
  }
  for (const [frame, ids] of anchors) if (ids.length > 1) anchorIssues.push({kind: 'duplicate', frame, elements: ids});
  if (registry.revision() !== revision) missing('root', 'captureState', 'native observations changed while the tree was measured');
  return {version: 1, scope: 'screen', measurement: {renderer: 'react-native', platform: options.platform, coordinateUnit: options.platform === 'android' ? 'dp' : 'pt'},
    root: rootBox ? {x: 0, y: 0, width: rootBox.width, height: rootBox.height} : undefined,
    viewport: {...viewport}, fullViewport, elements, strings, anchorIssues, repeatedLists: [], unavailable};
}
