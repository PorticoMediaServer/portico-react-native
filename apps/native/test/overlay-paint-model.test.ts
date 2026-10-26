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
/** A frozen children prop may be one element, an array, or absent. */
const kids = (node: unknown): Array<{type: unknown; props: Record<string, unknown>}> => {
  if (node === undefined || node === null || node === false) return [];
  return (Array.isArray(node) ? node : [node]).filter(Boolean) as Array<{type: unknown; props: Record<string, unknown>}>;
};

test('dropped function, ref and initialFocusRef keys are absent from the rebuilt element', () => {
  const calls: string[] = [];
  const rewrite = () => calls.push('rewrite');
  const root = child(View, {onPress: () => calls.push('press'), renderItem: rewrite, initialFocusRef: {current: null}, ref: {current: null}});
  const frozen = freezeOverlayPaint(root, [View]);
  assert.ok(frozen);
  assert.equal(frozen.type, View, 'the exact type is preserved');
  assert.equal(typeof frozen.props.onPress, 'function');
  assert.notEqual(frozen.props.onPress, root.props.onPress);
  assert.equal('renderItem' in frozen.props, false, 'a dropped function prop is absent, not undefined');
  assert.equal('initialFocusRef' in frozen.props, false);
  assert.equal('ref' in frozen.props, false, 'the rebuilt element carries no ref');
  (frozen.props.onPress as () => void)();
  assert.deepEqual(calls, []);
});

test('a root anchor or return object ref is retained, a function ref never is', () => {
  const nativeCurrent = {focus() {}};
  const anchorRef = {current: nativeCurrent}, returnFocusRef = {current: nativeCurrent};
  const frozen = freezeOverlayPaint(child(View, {anchorRef, returnFocusRef}), [View]);
  assert.ok(frozen);
  assert.equal(frozen.props.anchorRef, anchorRef, 'the real object ref keeps its permission');
  assert.equal(frozen.props.returnFocusRef, returnFocusRef);
  const functionRef = () => {};
  const withFunctionRef = freezeOverlayPaint(child(View, {anchorRef: functionRef, returnFocusRef: functionRef}), [View]);
  assert.ok(withFunctionRef);
  assert.equal('anchorRef' in withFunctionRef.props, false);
  assert.equal('returnFocusRef' in withFunctionRef.props, false);
});

test('nested elements and events inside prop data are frozen by the same traversal', () => {
  const calls: string[] = [];
  const nested = child(Allowed, {onPress: () => calls.push('nested')});
  const context = {item: {onSelect: () => calls.push('select'), label: 'Album'}, touchHeader: nested, count: 2};
  const frozen = freezeOverlayPaint(child(View, {value: context}), [View, Allowed]);
  assert.ok(frozen);
  const value = frozen.props.value as {item: {onSelect: unknown; label: string}; touchHeader: {type: unknown; props: Record<string, unknown>}; count: number};
  assert.equal(typeof value.item.onSelect, 'function', 'a nested event is stripped to a no-op, never rejected');
  (value.item.onSelect as () => void)();
  assert.equal(value.item.label, 'Album');
  assert.equal(value.count, 2);
  assert.equal(value.touchHeader.type, Allowed, 'a nested element is frozen in place');
  (value.touchHeader.props.onPress as () => void)();
  assert.deepEqual(calls, []);
  assert.notEqual(frozen.props.value, context, 'changed nested data is a new readonly object');
});

test('unchanged readonly data and shared aliases keep their identity, and undefined props are valid', () => {
  const style = {color: 'red'};
  const shared = {nested: {count: 2}};
  const uri = 'https://example.invalid/cover.jpg';
  const frozen = freezeOverlayPaint(child(View, {style, value: shared, other: shared, uri, explicit: undefined}), [View]);
  assert.ok(frozen);
  assert.equal(frozen.props.style, style);
  assert.equal(frozen.props.value, shared, 'an alias is not taken for a cycle');
  assert.equal(frozen.props.other, shared);
  assert.equal(frozen.props.uri, uri);
  assert.ok('explicit' in frozen.props);
  assert.equal(frozen.props.explicit, undefined, 'an undefined optional prop is a valid capture');
});

test('a direct omitted child leaves no child, while sibling children survive', () => {
  const direct = freezeOverlayPaint(child(View, {children: child(Portal, {})}), [View], [Portal]);
  assert.ok(direct);
  assert.equal(direct.props.children, undefined, 'the omitted child is absent, not a symbol');
  const siblings = freezeOverlayPaint(child(View, {children: [child(Portal, {}), child(Allowed, {})]}), [View, Allowed], [Portal]);
  assert.ok(siblings);
  assert.equal(kids(siblings.props.children).length, 1);
  assert.equal(kids(siblings.props.children)[0]!.type, Allowed);
});

test('accessors are rejected without being invoked', () => {
  let reads = 0;
  const value = {};
  Object.defineProperty(value, 'danger', {enumerable: true, get() {reads++; return 1;}});
  assert.equal(freezeOverlayPaint(child(View, {value}), [View]), undefined);
  assert.equal(reads, 0, 'no getter ran during the audit');
});

test('the shared visit budget refuses an exhausted capture', () => {
  const wide = Array.from({length: 5000}, (_, index) => ({index}));
  assert.equal(freezeOverlayPaint(child(View, {value: wide}), [View]), undefined);
});

test('unknown components, function children, functional styles and cycles are rejected', () => {
  assert.equal(freezeOverlayPaint(child(Unknown, {}), [View]), undefined);
  assert.equal(freezeOverlayPaint(child(View, {children: () => null}), [View]), undefined);
  assert.equal(freezeOverlayPaint(child(View, {style: {color: () => 'red'}}), [View]), undefined);
  assert.equal(freezeOverlayPaint(child(View, {style: [{color: 'red'}, {padding: () => 1}]}), [View]), undefined);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(freezeOverlayPaint(child(View, {value: cyclic}), [View]), undefined);
});

test('an unlisted fragment or native host is rejected unless the caller lists it', () => {
  const fragment = React.createElement(React.Fragment, null, child(Allowed, {}));
  assert.equal(freezeOverlayPaint(fragment, [Allowed]), undefined);
  assert.ok(freezeOverlayPaint(fragment, [React.Fragment, Allowed]));
  assert.equal(freezeOverlayPaint(child('Text', {children: 'hi'}), [View]), undefined);
  assert.ok(freezeOverlayPaint(child('Text', {children: 'hi'}), ['Text']));
});
