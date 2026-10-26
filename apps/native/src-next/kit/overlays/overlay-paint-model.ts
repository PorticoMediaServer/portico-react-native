import React from 'react';

/** A controller-free kit surface, frozen for exit paint. */
export type OverlayPaintNode = React.ReactElement<Record<string, unknown>>;
export type OverlayPaintTypes = readonly unknown[];

const noop = () => {};
const ROOT_REF_KEYS = new Set(['anchorRef', 'returnFocusRef']);
const OMITTED = Symbol('overlay-paint-omitted');
const MAX_DEPTH = 64;
const MAX_NODES = 2048;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Bounded inspection of plain data, preserving the original reference: no
 * functions, no class instances, no cycles. */
function dataIsPaintable(value: unknown, seen: WeakSet<object>, budget: {left: number}): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  if (--budget.left < 0) return false;
  if (Array.isArray(value)) {
    seen.add(value);
    return value.every(entry => dataIsPaintable(entry, seen, budget));
  }
  if (!isPlainObject(value)) return false;
  seen.add(value);
  return Object.values(value).every(entry => dataIsPaintable(entry, seen, budget));
}

/** Freeze a caller-audited overlay element for exit paint.
 *
 * Keeps element types, keys and static values, preserves the identity of
 * unchanged readonly data, replaces event callbacks with one harmless no-op and
 * drops every other function prop, child or style. Root-only anchor and return
 * refs stay as the original view refs; descendant refs disappear. Unknown
 * component types, fragments and native hosts are rejected unless the caller
 * lists them, omitted capture types are dropped whole, and any unsupported
 * capture returns undefined so the caller can skip the exit safely. Nothing here
 * creates, mounts, calls or clones a component, controller or native instance. */
export function freezeOverlayPaint(node: OverlayPaintNode, allowedTypes: OverlayPaintTypes, omitTypes: OverlayPaintTypes = []): OverlayPaintNode | undefined {
  const allowed = new Set<unknown>(allowedTypes), omitted = new Set<unknown>(omitTypes);
  const seen = new WeakSet<object>();
  const budget = {left: MAX_NODES};
  const data = (value: unknown) => dataIsPaintable(value, new WeakSet<object>(), {left: MAX_NODES});

  const freezeNode = (value: unknown, depth: number, root: boolean): unknown | typeof OMITTED => {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      if (depth > MAX_DEPTH || --budget.left < 0) return undefined;
      const frozen: unknown[] = [];
      for (const entry of value) {
        const next = freezeNode(entry, depth + 1, false);
        if (next === OMITTED) continue;
        if (next === undefined && entry !== undefined && entry !== null && entry !== false && entry !== true) return undefined;
        frozen.push(next);
      }
      return frozen;
    }
    if (!React.isValidElement(value)) return undefined;
    const element = value as OverlayPaintNode;
    if (omitted.has(element.type)) return OMITTED;
    if (!allowed.has(element.type)) return undefined;
    if (seen.has(element as unknown as object)) return undefined;
    if (depth > MAX_DEPTH || --budget.left < 0) return undefined;
    seen.add(element as unknown as object);
    const props: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(element.props)) {
      if (key === 'children') continue;
      if (typeof prop === 'function') {
        if (key.startsWith('on')) {props[key] = noop; continue;}
        if (root && ROOT_REF_KEYS.has(key)) {props[key] = prop; continue;}
        continue;
      }
      if ((key === 'ref' || key === 'initialFocusRef') && !(root && ROOT_REF_KEYS.has(key))) continue;
      if (!data(prop)) return undefined;
      props[key] = prop;
    }
    const children = (element.props as {children?: unknown}).children;
    if (children !== undefined) {
      if (typeof children === 'function') return undefined;
      const frozen = freezeNode(children, depth + 1, false);
      if (frozen === undefined && children !== undefined) return undefined;
      props.children = frozen;
    }
    return React.cloneElement(element, props);
  };

  const frozen = freezeNode(node, 0, true);
  return frozen === OMITTED ? undefined : frozen as OverlayPaintNode | undefined;
}
