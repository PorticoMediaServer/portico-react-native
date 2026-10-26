import React from 'react';

/** A controller-free kit surface, frozen for exit paint. */
export type OverlayPaintNode = React.ReactElement<Record<string, unknown>>;
export type OverlayPaintTypes = readonly unknown[];

const noop = () => {};
const ROOT_REF_KEYS = new Set(['anchorRef', 'returnFocusRef']);
const MAX_DEPTH = 64;
const MAX_VISITS = 4096;
const OMIT = Symbol('overlay-paint-omit');
const REJECT = Symbol('overlay-paint-reject');

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Own properties read without ever invoking an accessor. */
function readOwnProperties(value: object): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (descriptor.get || descriptor.set) return undefined;
    out[key] = descriptor.value;
  }
  return out;
}

type Context = {
  allowed: Set<unknown>;
  omitted: Set<unknown>;
  /** One budget for the whole traversal: every value and every own property costs one. */
  budget: {left: number};
  /** Only objects on the current path, so shared readonly aliases stay legal. */
  path: Set<object>;
  memo: WeakMap<object, unknown>;
};

const spend = (context: Context) => --context.budget.left >= 0;

function styleIsPaintable(value: unknown, context: Context): boolean {
  if (!spend(context)) return false;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object') return false;
  if (context.path.has(value)) return false;
  if (--context.budget.left < 0) return false;
  context.path.add(value);
  try {
    if (Array.isArray(value)) return value.every(entry => styleIsPaintable(entry, context));
    if (!isPlainObject(value)) return false;
    const properties = readOwnProperties(value);
    if (!properties) return false;
    return Object.values(properties).every(entry => styleIsPaintable(entry, context));
  } finally {context.path.delete(value);}
}

export function freezeOverlayPaint(node: OverlayPaintNode, allowedTypes: OverlayPaintTypes, omitTypes: OverlayPaintTypes = []): OverlayPaintNode | undefined {
  const context: Context = {allowed: new Set(allowedTypes), omitted: new Set(omitTypes), budget: {left: MAX_VISITS}, path: new Set<object>(), memo: new WeakMap<object, unknown>()};

  const freezeValue = (value: unknown, root: boolean, depth: number): unknown => {
    if (!spend(context) || depth > MAX_DEPTH) return REJECT;
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'function') return REJECT;
    if (Array.isArray(value) || isPlainObject(value)) {
      if (context.path.has(value)) return REJECT;
      if (context.memo.has(value)) return context.memo.get(value);
      context.path.add(value);
      try {
        if (Array.isArray(value)) {
          let changed = false;
          const frozen: unknown[] = [];
          for (const entry of value) {
            const next = freezeValue(entry, false, depth + 1);
            if (next === REJECT) throw REJECT;
            if (next === OMIT) {changed = true; continue;}
            if (next !== entry) changed = true;
            frozen.push(next);
          }
          const result = changed ? frozen : value;
          context.memo.set(value, result);
          return result;
        }
        const properties = readOwnProperties(value);
        if (!properties) throw REJECT;
        let changed = false;
        const frozen: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(properties)) {
          if (!spend(context)) throw REJECT;
          if (typeof entry === 'function') {
            if (key.startsWith('on')) {frozen[key] = noop; changed = true;}
            else changed = true;
            continue;
          }
          const next = freezeValue(entry, false, depth + 1);
          if (next === REJECT) throw REJECT;
          if (next === OMIT) {changed = true; continue;}
          frozen[key] = next;
          if (next !== entry) changed = true;
        }
        const result = changed ? frozen : value;
        context.memo.set(value, result);
        return result;
      } finally {context.path.delete(value);}
    }
    if (!React.isValidElement(value)) return REJECT;
    return freezeElement(value as OverlayPaintNode, root, depth + 1);
  };

  const freezeElement = (element: OverlayPaintNode, root: boolean, depth: number): unknown => {
    if (!spend(context) || depth > MAX_DEPTH) return REJECT;
    if (context.omitted.has(element.type)) return OMIT;
    if (!context.allowed.has(element.type)) return REJECT;
    if (context.path.has(element as unknown as object)) return REJECT;
    const properties = readOwnProperties(element.props);
    if (!properties) return REJECT;
    context.path.add(element as unknown as object);
    try {
      const props: Record<string, unknown> = {};
      let children: unknown;
      let hasChildren = false;
      for (const [key, prop] of Object.entries(properties)) {
        if (!spend(context)) throw REJECT;
        if (key === 'children') {children = prop; hasChildren = true; continue;}
        if (key === 'ref' || key === 'initialFocusRef') continue;
        if (root && ROOT_REF_KEYS.has(key)) {
          const usable = !!prop && typeof prop === 'object' && 'current' in (prop as object);
          if (usable) props[key] = prop;
          continue;
        }
        if (typeof prop === 'function') {
          if (key.startsWith('on')) props[key] = noop;
          continue;
        }
        if (key === 'style') {
          if (!styleIsPaintable(prop, context)) throw REJECT;
          props[key] = prop;
          continue;
        }
        const next = freezeValue(prop, false, depth + 1);
        if (next === REJECT) throw REJECT;
        if (next === OMIT) continue;
        props[key] = next;
      }
      if (hasChildren) {
        const next = freezeValue(children, false, depth + 1);
        if (next === REJECT) throw REJECT;
        if (next !== OMIT) props.children = next;
      }
      return React.createElement(element.type as never, element.key === null || element.key === undefined ? props : {...props, key: element.key});
    } finally {context.path.delete(element as unknown as object);}
  };

  try {
    const frozen = freezeValue(node, true, 0);
    return frozen === OMIT || frozen === REJECT ? undefined : frozen as OverlayPaintNode;
  } catch (error) {
    if (error === REJECT) return undefined;
    throw error;
  }
}
