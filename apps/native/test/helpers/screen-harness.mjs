import {readFile} from 'node:fs/promises';
import {compileFunction} from 'node:vm';
import {transformSync} from 'rolldown/utils';

// Exercises a screen's exported pure helpers without a renderer or a server,
// mirroring portico-server/web/test/helpers/component-harness.mjs. Only pure
// exports are called; React and native modules are stubbed, never executed.
export async function screenModule(file, modules) {
  const transformed = transformSync(file.pathname, await readFile(file, 'utf8'), {jsx: {runtime: 'classic'}});
  if (transformed.errors.length) throw new Error(JSON.stringify(transformed.errors));
  const exported = [];
  const code = transformed.code.replace(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g, (_, names, source) => {
    let bind = names.trim().replace(/\bas\b/g, ':');
    if (!bind.startsWith('{')) {
      const comma = bind.indexOf(',');
      if (comma < 0) return `const ${bind} = modules[${JSON.stringify(source)}].default;`;
      return `const ${bind.slice(0, comma)} = modules[${JSON.stringify(source)}].default; const ${bind.slice(comma + 1)} = modules[${JSON.stringify(source)}];`;
    }
    return `const ${bind} = modules[${JSON.stringify(source)}];`;
  }).replace(/export (async )?(const|function|class) (\w+)/g, (_, asyncPrefix, kind, name) => { exported.push(name); return `${asyncPrefix ?? ''}${kind} ${name}`; })
    .replace(/export\s*\{([^}]+)\};/g, (_, bindings) => bindings.split(',').map(binding => {
      const [local, alias] = binding.trim().split(/\s+as\s+/); exported.push(alias ?? local);
      return alias ? `const ${alias} = ${local};` : '';
    }).join('\n'))
    .replaceAll('import.meta.env', '({DEV:false})');
  return compileFunction((/const React\s*=/.test(code) ? '' : 'const React = modules.react.default;\n') + code + '\nreturn {' + exported.join(',') + '};', ['modules'], {filename: file.pathname})(modules);
}

export function hooks() {
  const slots = []; let cursor = 0;
  const ref = value => { const n = cursor++; return slots[n] ??= {current: value}; };
  const react = {
    createElement: (type, props, ...children) => ({type, props: {...props, children}}),
    useRef: ref,
    useState: initial => { const n=cursor++; if (!(n in slots)) slots[n]=typeof initial==='function'?initial():initial; return [slots[n], value=>{slots[n]=typeof value==='function'?value(slots[n]):value;}]; },
    useMemo: (fn, deps) => { const slot=ref(undefined); if (!slot.current || deps.some((v,i)=>v!==slot.current.deps[i])) slot.current={deps,value:fn()}; return slot.current.value; },
    useCallback: fn => fn,
    useEffect: () => {},
    useSyncExternalStore: (_, get) => get(),
    useContext: context => context.value,
  };
  return {react: {...react, default: react}, render: fn => {cursor=0;return fn();}};
}

// Explicit LIVE-only seams for existing shallow screen tests. These do not
// exercise retained paint; its reconciler coverage loads the real modules.
export const liveOverlayPaint = {
  useOverlayPaintReturnCurrent: () => undefined,
  useOverlayPaintMode: () => ({visible: true, interactive: true, root: true}),
  OverlayPaintProvider: 'OverlayPaintProvider', OverlayPaintDescendants: 'OverlayPaintDescendants',
};
const paintOpenings = new WeakMap(); let paintOpeningSequence = 0;
export const surfacePaintFixture = {
  overlayPaintKey: opening => {if (!paintOpenings.has(opening)) paintOpenings.set(opening, `paint-${++paintOpeningSequence}`); return paintOpenings.get(opening);},
  SurfacePaintHost: 'SurfacePaintHost', RetainedOverlay: ({children}) => children,
  overlayPaintPermit: current => ({current, subscribe: () => () => {}}),
};

// These shallow input/slot cases inspect the materialised current row; the
// actual handover hooks have separate source vectors and are not run here.
export const dockHandoverFixture = {DockHandover: 'DockHandover', DockPaintRow: 'DockPaintRow'};
// Geometry is outside these shallow command/focus fixtures. The production
// default without a publication is no shared cover and an unchanged local slot.
export const listeningCoverFixture = {
  ListeningCoverProvider: ({children}) => children,
  ListeningCoverLocalPaint: 'ListeningCoverLocalPaint',
  ListeningGroup: ({children}) => children,
  useListeningCoverPublication() {},
  useListeningPageStyle: () => ({}),
  useListeningPaintPermit: () => undefined, useListeningPageOwner() {}, useListeningPageHeight: () => () => {}, useListeningPagePresent: () => false,
  useListeningCoverSlot: () => ({measure() {}, style: {}}),
};
