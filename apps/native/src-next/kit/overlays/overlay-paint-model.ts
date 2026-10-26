import React from 'react';

/** A controller-free kit surface, frozen for exit paint. */
export type OverlayPaintNode = React.ReactElement<Record<string, unknown>>;
export type OverlayPaintTypes = readonly unknown[];

const noop = () => {};
const ROOT_REF_KEYS = new Set(['anchorRef', 'returnFocusRef']);
const MAX_VISITS = 4096;
const MAX_DEPTH = 64;
const OMIT = Symbol('overlay-paint-omit');
const REJECT = Symbol('overlay-paint-reject');

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

type Context = {
  allowed: Set<unknown>;
  omitted: Set<unknown>;
  /** One budget for the whole capture, charged per value and per own property. */
  budget: {left: number};
  /** Objects on the current path only, so shared readonly aliases stay legal. */
  path: Set<object>;
  memo: WeakMap<object, unknown>;
};

const spend = (context: Context) => --context.budget.left >= 0;

/** Own descriptor without ever invoking an accessor. */
function ownDescriptor(value: object, key: string): PropertyDescriptor | undefined {
  return Object.getOwnPropertyDescriptor(value, key);
}

function styleIsPaintable(value: unknown, context: Context): boolean {
  if (!spend(context)) return false;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object') return false;
  if (context.path.has(value)) return false;
  context.path.add(value);
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      for (let index = 0; index < length; index++) {
        if (!spend(context)) return false;
        const descriptor = ownDescriptor(value, String(index));
        if (!descriptor) continue;
        if (descriptor.get || descriptor.set) return false;
        if (!styleIsPaintable(descriptor.value, context)) return false;
      }
      return true;
    }
    if (!isPlainObject(value)) return false;
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!spend(context)) return false;
      const descriptor = ownDescriptor(value, key);
      if (!descriptor) return false;
      if (descriptor.get || descriptor.set) return false;
      if (!descriptor.enumerable) continue;
      if (!styleIsPaintable(descriptor.value, context)) return false;
    }
    return true;
  } finally {context.path.delete(value);}
}

export function freezeOverlayPaint(node: OverlayPaintNode, allowedTypes: OverlayPaintTypes, omitTypes: OverlayPaintTypes = []): OverlayPaintNode | undefined {
  const context: Context = {allowed: new Set(allowedTypes), omitted: new Set(omitTypes), budget: {left: MAX_VISITS}, path: new Set<object>(), memo: new WeakMap<object, unknown>()};

  function freezeElement(element: OverlayPaintNode, root: boolean, depth: number): unknown {
    if (!spend(context) || depth > MAX_DEPTH) return REJECT;
    if (context.omitted.has(element.type)) return OMIT;
    if (!context.allowed.has(element.type)) return REJECT;
    if (context.path.has(element as unknown as object)) return REJECT;
    context.path.add(element as unknown as object);
    try {
      const props: Record<string, unknown> = {};
      let children: unknown;
      let hasChildren = false;
      for (const key of Object.getOwnPropertyNames(element.props)) {
        if (!spend(context)) throw REJECT;
        const descriptor = ownDescriptor(element.props, key);
        if (!descriptor) throw REJECT;
        if (descriptor.get || descriptor.set) throw REJECT;
        if (!descriptor.enumerable) continue;
        const prop = descriptor.value;
        if (key === 'children') {children = prop; hasChildren = true; continue;}
        if (key === 'ref' || key === 'initialFocusRef') continue;
        if (ROOT_REF_KEYS.has(key)) {
          if (root) {
            const usable = !!prop && typeof prop === 'object' && 'current' in (prop as object);
            if (usable) props[key] = prop;
          }
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
  }

  function freezeValue(value: unknown, root: boolean, depth: number): unknown {
    if (!spend(context) || depth > MAX_DEPTH) return REJECT;
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'function') return REJECT;
    // React elements are plain objects with a $$typeof symbol: recognise them first.
    if (React.isValidElement(value)) return freezeElement(value as OverlayPaintNode, root, depth + 1);
    if (Array.isArray(value) || isPlainObject(value)) {
      if (context.path.has(value)) return REJECT;
      if (context.memo.has(value)) return context.memo.get(value);
      context.path.add(value);
      try {
        if (Array.isArray(value)) {
          const length = value.length;
          let changed = false;
          const frozen: unknown[] = [];
          for (let index = 0; index < length; index++) {
            if (!spend(context)) throw REJECT;
            const descriptor = ownDescriptor(value, String(index));
            if (!descriptor) {frozen.push(undefined); changed = true; continue;}
            if (descriptor.get || descriptor.set) throw REJECT;
            const entry = descriptor.value;
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
        let changed = false;
        const frozen: Record<string, unknown> = {};
        for (const key of Object.getOwnPropertyNames(value)) {
          if (!spend(context)) throw REJECT;
          const descriptor = ownDescriptor(value, key);
          if (!descriptor) throw REJECT;
          if (descriptor.get || descriptor.set) throw REJECT;
          if (!descriptor.enumerable) continue;
          const entry = descriptor.value;
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
    return REJECT;
  }

  try {
    const frozen = freezeValue(node, true, 0);
    return frozen === OMIT || frozen === REJECT ? undefined : frozen as OverlayPaintNode;
  } catch (error) {
    if (error === REJECT) return undefined;
    throw error;
  }
}
