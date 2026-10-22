import test from 'node:test';
import assert from 'node:assert/strict';
import {createTheme, fontFamilies, nativeType} from '../src-next/kit/theme.ts';
import {motionPolicy} from '../src-next/platform/motion-policy.ts';
import {collectGalleries, kitSelectionFromURL, type Gallery, type GalleryContext} from '../src-next/dev/gallery-registry.ts';
import {colors, platformRadii, typeScale, springs} from '@portico/design';

test('theme maps every accepted role, normal metrics and exact family registration', () => {
  assert.equal(fontFamilies[800], 'Manrope-ExtraBold');
  assert.equal(fontFamilies[400], 'Manrope-Regular');
  assert.equal(fontFamilies[500], 'Manrope-Medium');
  assert.equal(fontFamilies[600], 'Manrope-SemiBold');
  assert.equal(fontFamilies[700], 'Manrope-Bold');
  const phone = createTheme({isTV: false, width: 390}); const tv = createTheme({isTV: true, width: 1920});
  assert.equal(phone.colors, colors); assert.equal(phone.radii, platformRadii.phone); assert.equal(tv.radii, platformRadii.tv);
  assert.equal(createTheme({isTV: false, width: 768}).platform, 'tablet');
  assert.equal(phone.type.lockup.fontSize, 46); assert.equal(tv.type.lockup.fontSize, 120);
  assert.equal(phone.type.lockup.letterSpacing, -2.07); assert.equal(tv.type.lockup.letterSpacing, -.045 * 120);
  assert.equal('lineHeight' in phone.type.nav, false);
  for (const [name, style] of Object.entries(typeScale.handheld)) assert.deepEqual(phone.type[name as keyof typeof phone.type], nativeType(style));
});
test('motion uses the physical token springs and 160ms transform-free reduced states', () => {
  const normal = motionPolicy(false), reduced = motionPolicy(true);
  assert.deepEqual(normal.spring('settle', 650), {...springs.settle, velocity: 650});
  assert.equal(normal.duration('quick'), 120); assert.equal(normal.duration('slow'), 320);
  for (const duration of ['quick', 'standard', 'hover', 'slow', 'morph', 'hero'] as const) assert.equal(reduced.duration(duration), 160);
  assert.equal(reduced.spring('player', 600), undefined); assert.equal(reduced.transforms, false); assert.equal(reduced.fingerTracking, true);
  assert.deepEqual(reduced.rules.animatedProperties, ['transform', 'opacity']);
});
test('family modules register independently with deterministic order and duplicate rejection', () => {
  const render = () => null;
  const modules: Record<string, {default: Gallery | Gallery[]}> = {'./b.gallery.tsx': {default: {id: 'cards', title: 'next.platform.kitTitle', render}}, './a.gallery.tsx': {default: [{id: 'controls', title: 'next.platform.kitTitle', render}, {id: 'artwork', title: 'next.platform.kitTitle', render}]}};
  const context: GalleryContext = Object.assign((key: string) => modules[key]!, {keys: () => Object.keys(modules)});
  assert.deepEqual(collectGalleries(context).map(g => g.id), ['artwork', 'cards', 'controls']);
  modules['./b.gallery.tsx'] = {default: {id: 'artwork', title: 'next.platform.kitTitle', render}};
  assert.throws(() => collectGalleries(context), /Duplicate native gallery/);
});

test('the development gallery URL selects one family without intercepting product links', () => {
  assert.deepEqual(kitSelectionFromURL('portico://kit?gallery=controls'), {gallery: 'controls'});
  assert.deepEqual(kitSelectionFromURL('portico://kit/'), {});
  assert.equal(kitSelectionFromURL('portico://library?id=kit'), undefined);
  assert.equal(kitSelectionFromURL('https://kit?gallery=controls'), undefined);
  assert.equal(kitSelectionFromURL('portico://kit/product'), undefined);
  assert.equal(kitSelectionFromURL('invalid'), undefined);
  assert.equal(kitSelectionFromURL(null), undefined);
});
