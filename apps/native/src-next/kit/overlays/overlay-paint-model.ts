import React from 'react';

/** A controller-free kit surface, frozen for exit paint. */
export type OverlayPaintNode = React.ReactElement<Record<string, unknown>>;
export type OverlayPaintTypes = readonly unknown[];

const noop = () => {};
const ROOT_REF_KEYS = new Set(['anchorRef', 'returnFocusRef']);
const MAX_DEPTH = 64;
const MAX_NODES = 4096;
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
  budget: {left: number};
  /** Objects on the current traversal path only, so shared aliases are not cycles. */
  path: Set<object>;
  /** Completed readonly data, so an alias keeps one identical frozen result. */
  memo: WeakMap<object, unknown>;
};

function styleIsPaintable(value: unknown, path: Set<object>, budget: {left: number}): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object') return false;
  if (path.has(value)) return false;
  if (--budget.left < 0) return false;
  if (Array.isArray(value)) {
    path.add(value);
    const ok = value.every(entry => styleIsPaintable(entry, path, budget));
    path.delete(value);
    return ok;
  }
  if (!isPlainObject(value)) return false;
  path.add(value);
  const ok = Object.values(value).every(entry => styleIsPaintable(entry, path, budget));
  path.delete(value);
  return ok;
}

export function freezeOverlayPaint(node: OverlayPaintNode, allowedTypes: OverlayPaintTypes, omitTypes: OverlayPaintTypes = []): OverlayPaintNode | undefined {
  const context: Context = {allowed: new Set(allowedTypes), omitted: new Set(omitTypes), budget: {left: MAX_NODES}, path: new Set<object>(), memo: new WeakMap<object, unknown>()};

  const freezeValue = (value: unknown, root: boolean): unknown => {
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'function') return REJECT;
    if (Array.isArray(value) || isPlainObject(value)) {
      if (context.path.has(value)) return REJECT;
      if (context.memo.has(value)) return context.memo.get(value);
      if (--context.budget.left < 0) return REJECT;
      context.path.add(value);
      try {
        if (Array.isArray(value)) {
          let changed = false;
          const frozen: unknown[] = [];
          for (const entry of value) {
            const next = freezeValue(entry, false);
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
        for (const [key, entry] of Object.entries(value)) {
          if (typeof entry === 'function') {
            frozen[key] = key.startsWith('on') ? noop : undefined;
            changed = true;
            continue;
          }
          const next = freezeValue(entry, false);
          if (next === REJECT) throw REJECT;
          frozen[key] = next === OMIT ? undefined : next;
          if (frozen[key] !== entry) changed = true;
        }
        const result = changed ? frozen : value;
        context.memo.set(value, result);
        return result;
      } finally {context.path.delete(value);}
    }
    if (!React.isValidElement(value)) return REJECT;
    return freezeElement(value as OverlayPaintNode, root);
  };

  const freezeElement = (element: OverlayPaintNode, root: boolean): unknown => {
    if (context.omitted.has(element.type)) return OMIT;
    if (!context.allowed.has(element.type)) return REJECT;
    if (context.path.has(element as unknown as object)) return REJECT;
    if (--context.budget.left < 0) return REJECT;
    context.path.add(element as unknown as object);
    try {
      const props: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(element.props)) {
        if (key === 'children') continue;
        if (key === 'ref') {props.ref = null; continue;}
        if (key === 'initialFocusRef') {props[key] = undefined; continue;}
        if (root && ROOT_REF_KEYS.has(key)) {
          const usable = prop && typeof prop === 'object' && 'current' in (prop as object);
          props[key] = usable ? prop : undefined;
          continue;
        }
        if (typeof prop === 'function') {props[key] = key.startsWith('on') ? noop : undefined; continue;}
        if (key === 'style') {
          if (!styleIsPaintable(prop, new Set<object>(), {left: MAX_NODES})) throw REJECT;
          props[key] = prop;
          continue;
        }
        const next = freezeValue(prop, false);
        if (next === REJECT) throw REJECT;
        props[key] = next === OMIT ? undefined : next;
      }
      const children = (element.props as {children?: unknown}).children;
      if (children !== undefined) {
        const next = freezeValue(children, false);
        if (next === REJECT) throw REJECT;
        props.children = next === OMIT ? undefined : next;
      }
      return React.cloneElement(element, props);
    } finally {context.path.delete(element as unknown as object);}
  };

  try {
    const frozen = freezeValue(node, true);
    return frozen === OMIT || frozen === REJECT ? undefined : frozen as OverlayPaintNode;
  } catch (error) {
    if (error === REJECT) return undefined;
    throw error;
  }
}
