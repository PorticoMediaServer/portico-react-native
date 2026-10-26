/**
 * Authored SOURCE for the pure overlay paint freeze. It exercises only the
 * model's own rules with fake elements; it is not a native host, caret or focus
 * proof and it is not run as part of this change. The stronger stale-timer
 * vectors stay with SB8 for the owner's product fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {freezeOverlayPaint} from '../src-next/kit/overlays/overlay-paint-model.ts';

const View = 'View';
const Allowed = (_props: {title?: string}) => null;
const Unknown = () => null;
const Portal = () => null;

const child = (type: unknown, props: Record<string, unknown> = {}) => React.createElement(type as never, props);

test('event callbacks become one harmless no-op while the originals stay untouched', () => {
  const calls: string[] = [];
  const root = child(View, {onPress: () => calls.push('press'), children: child(Allowed, {onSelect: () => calls.push('select')})});
  const frozen = freezeOverlayPaint(root, [View, Allowed]);
  assert.ok(frozen);
  assert.equal(typeof frozen.props.onPress, 'function');
  assert.notEqual(frozen.props.onPress, root.props.onPress);
  const nested = (frozen.props.children as Array<{props: Record<string, unknown>}>)[0]!;
  assert.equal(typeof nested.props.onSelect, 'function');
  (frozen.props.onPress as () => void)();
  (nested.props.onSelect as () => void)();
  assert.deepEqual(calls, [], 'the frozen callbacks never reach the originals');
});

test('refs disappear below the root, while the root anchor and return refs stay', () => {
  const anchorRef = {current: null}, returnFocusRef = {current: null}, descendantRef = {current: null};
  const root = child(View, {anchorRef, returnFocusRef, ref: descendantRef, children: child(Allowed, {ref: descendantRef, initialFocusRef: descendantRef})});
  const frozen = freezeOverlayPaint(root, [View, Allowed]);
  assert.ok(frozen);
  assert.equal(frozen.props.anchorRef, anchorRef);
  assert.equal(frozen.props.returnFocusRef, returnFocusRef);
  assert.equal('ref' in frozen.props, false, 'a root ref still disappears');
  const nested = (frozen.props.children as Array<{props: Record<string, unknown>}>)[0]!;
  assert.equal('ref' in nested.props, false);
  assert.equal('initialFocusRef' in nested.props, false);
});

test('readonly data keeps its identity', () => {
  const style = {color: 'red', paddingTop: 4};
  const value = {nested: {count: 2}};
  const uri = 'https://example.invalid/cover.jpg';
  const root = child(View, {style, value, uri});
  const frozen = freezeOverlayPaint(root, [View]);
  assert.ok(frozen);
  assert.equal(frozen.props.style, style, 'style keeps the same readonly object');
  assert.equal(frozen.props.value, value);
  assert.equal(frozen.props.uri, uri);
});

test('unknown components, function children, functional styles and cycles are rejected', () => {
  assert.equal(freezeOverlayPaint(child(Unknown, {}), [View]), undefined, 'an unlisted component is never mounted');
  assert.equal(freezeOverlayPaint(child(View, {children: () => null}), [View]), undefined, 'a function child would need invented paint');
  assert.equal(freezeOverlayPaint(child(View, {style: {color: () => 'red'}}), [View]), undefined, 'a functional style is rejected');
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(freezeOverlayPaint(child(View, {value: cyclic}), [View]), undefined, 'a cycle is rejected');
});

test('an omitted nested capture is dropped whole and never invoked', () => {
  const calls: string[] = [];
  const root = child(View, {children: [child(Portal, {onPress: () => calls.push('portal')}), child(Allowed, {title: 'kept'})]});
  const frozen = freezeOverlayPaint(root, [View, Allowed], [Portal]);
  assert.ok(frozen);
  const children = frozen.props.children as Array<{type: unknown; props: Record<string, unknown>}>;
  assert.equal(children.length, 1, 'the omitted capture is not part of the painted tree');
  assert.equal(children[0]!.type, Allowed);
  assert.deepEqual(calls, []);
});

test('an unlisted fragment or native host is rejected unless the caller lists it', () => {
  const fragment = React.createElement(React.Fragment, null, child(Allowed, {}));
  assert.equal(freezeOverlayPaint(fragment, [Allowed]), undefined);
  assert.ok(freezeOverlayPaint(fragment, [React.Fragment, Allowed]));
  assert.equal(freezeOverlayPaint(child('Text', {children: 'hi'}), [View]), undefined);
  assert.ok(freezeOverlayPaint(child('Text', {children: 'hi'}), ['Text']));
});
