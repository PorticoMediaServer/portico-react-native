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

test('dropped props are assigned undefined and ref is null, so cloneElement cannot keep the originals', () => {
  const calls: string[] = [];
  const rewrite = () => calls.push('rewrite');
  const root = child(View, {onPress: () => calls.push('press'), renderItem: rewrite, ref: {current: null}, initialFocusRef: {current: null}});
  const frozen = freezeOverlayPaint(root, [View]);
  assert.ok(frozen);
  assert.equal(typeof frozen.props.onPress, 'function');
  assert.notEqual(frozen.props.onPress, root.props.onPress);
  assert.ok('renderItem' in frozen.props, 'the dropped key is present');
  assert.equal(frozen.props.renderItem, undefined, 'a dropped function prop is explicitly undefined');
  assert.ok('initialFocusRef' in frozen.props);
  assert.equal(frozen.props.initialFocusRef, undefined);
  assert.ok('ref' in frozen.props);
  assert.equal(frozen.props.ref, null, 'ref must be null, never omitted');
  (frozen.props.onPress as () => void)();
  assert.deepEqual(calls, [], 'the frozen callback never reaches the original');
});

test('root object refs bypass the plain-data rules while function refs are never preserved', () => {
  const anchorRef = {current: null}, returnFocusRef = {current: null};
  const functionRef = () => {};
  const root = child(View, {anchorRef, returnFocusRef});
  const frozen = freezeOverlayPaint(root, [View]);
  assert.ok(frozen);
  assert.equal(frozen.props.anchorRef, anchorRef);
  assert.equal(frozen.props.returnFocusRef, returnFocusRef);
  const withFunctionRef = freezeOverlayPaint(child(View, {anchorRef: functionRef, returnFocusRef: functionRef}), [View]);
  assert.ok(withFunctionRef);
  assert.equal(withFunctionRef.props.anchorRef, undefined);
  assert.equal(withFunctionRef.props.returnFocusRef, undefined);
});

test('nested elements and event callbacks inside prop data are frozen by the same traversal', () => {
  const calls: string[] = [];
  const nested = child(Allowed, {onPress: () => calls.push('nested')});
  const context = {item: {onSelect: () => calls.push('select'), label: 'Album'}, touchHeader: nested, count: 2};
  const root = child(View, {value: context});
  const frozen = freezeOverlayPaint(root, [View, Allowed]);
  assert.ok(frozen);
  const value = frozen.props.value as {item: {onSelect: unknown; label: string}; touchHeader: {type: unknown; props: Record<string, unknown>}; count: number};
  assert.equal(typeof value.item.onSelect, 'function');
  (value.item.onSelect as () => void)();
  assert.equal(value.item.label, 'Album', 'ordinary data survives the traversal');
  assert.equal(value.count, 2);
  assert.equal(value.touchHeader.type, Allowed, 'a nested element is frozen, not dropped');
  (value.touchHeader.props.onPress as () => void)();
  assert.deepEqual(calls, []);
  assert.notEqual(frozen.props.value, context, 'changed nested data is a new readonly object');
});

test('unchanged readonly data keeps its identity, including shared aliases', () => {
  const style = {color: 'red'};
  const shared = {nested: {count: 2}};
  const uri = 'https://example.invalid/cover.jpg';
  const root = child(View, {style, value: shared, other: shared, uri, explicit: undefined});
  const frozen = freezeOverlayPaint(root, [View]);
  assert.ok(frozen);
  assert.equal(frozen.props.style, style);
  assert.equal(frozen.props.value, shared, 'an alias is not taken for a cycle');
  assert.equal(frozen.props.other, shared);
  assert.equal(frozen.props.uri, uri);
  assert.ok('explicit' in frozen.props);
  assert.equal(frozen.props.explicit, undefined, 'an undefined optional prop is a valid capture');
});

test('unknown components, function children, functional styles and cycles are rejected', () => {
  assert.equal(freezeOverlayPaint(child(Unknown, {}), [View]), undefined, 'an unlisted component is never mounted');
  assert.equal(freezeOverlayPaint(child(View, {children: () => null}), [View]), undefined, 'a function child would need invented paint');
  assert.equal(freezeOverlayPaint(child(View, {style: {color: () => 'red'}}), [View]), undefined, 'a functional style rejects the capture');
  assert.equal(freezeOverlayPaint(child(View, {style: [{color: 'red'}, {padding: () => 1}]}), [View]), undefined);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(freezeOverlayPaint(child(View, {value: cyclic}), [View]), undefined, 'a path cycle is rejected');
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
