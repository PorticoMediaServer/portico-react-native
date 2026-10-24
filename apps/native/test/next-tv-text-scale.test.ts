import test from 'node:test';
import assert from 'node:assert/strict';
import {activeTextScale, createTheme, nativeType, textScaleFor, tvTextScale} from '../src-next/kit/theme.ts';
import {shellType} from '../src-next/kit/shell/visual.ts';
import {typeScale} from '@portico/design';

// Ruling R46-TV-TEXT-SIZE: appearance.textSize Standard is 1.0 and Large is
// 1.2 on Android TV and tvOS; the OS accessibility scale stays independent.

test('the confirmed TV text size maps to one published scale', () => {
  assert.deepEqual(tvTextScale, {standard: 1, large: 1.2});
  assert.equal(textScaleFor('standard', true), 1);
  assert.equal(textScaleFor('large', true), 1.2);
  assert.equal(textScaleFor(undefined, true), 1);
  assert.equal(textScaleFor('large', false), 1, 'handhelds keep the OS scale, not the TV preference');
  assert.equal(activeTextScale(), 1, 'no provider has published a preference');
});

test('Large scales every semantic ten-foot role once, font size and line height together', () => {
  const standard = createTheme({isTV: true, width: 1920});
  const large = createTheme({isTV: true, width: 1920, textScale: textScaleFor('large', true)});
  for (const [role, base] of Object.entries(typeScale.tenFoot)) {
    const scaled = large.type[role as keyof typeof large.type];
    assert.equal(scaled.fontSize, base.size * 1.2, `${role} size`);
    assert.equal(scaled.letterSpacing, base.tracking * base.size * 1.2, `${role} tracking`);
    if (base.lineHeight !== 'normal') assert.equal(scaled.lineHeight, base.lineHeight * 1.2, `${role} line height`);
    else assert.equal('lineHeight' in scaled, false, `${role} keeps normal metrics`);
    assert.deepEqual(scaled, nativeType(base, 1.2), `${role} is scaled exactly once`);
    assert.deepEqual(standard.type[role as keyof typeof standard.type], nativeType(base), `${role} standard geometry`);
  }
});

test('the preference never scales focus, spacing, card or window geometry', () => {
  const standard = createTheme({isTV: true, width: 1920});
  const large = createTheme({isTV: true, width: 1920, textScale: 1.2});
  assert.deepEqual(large.spec, standard.spec);
  assert.deepEqual(large.layout, standard.layout);
  assert.deepEqual(large.radii, standard.radii);
  assert.deepEqual(large.space, standard.space);
  assert.equal(large.gutter, standard.gutter);
  assert.equal(large.width, standard.width);
  assert.equal(large.platform, 'tv');
});

test('omitted shellType callers read the one published scale while explicit values win', () => {
  assert.equal(shellType(22, 700).fontSize, 22);
  assert.equal(shellType(22, 700, 'normal', 0, 1.2).fontSize, 26.4);
  assert.equal(shellType(22, 700, 'normal', 0, 1).fontSize, 22);
});
