/**
 * TV-RAIL-02/05/07: the rail's geometry. What the viewer sees must not move while the rail opens
 * or closes (no midpoint jump), the surface must follow the panel's visible edge, and the brand's
 * P must be the same pixels in both states.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {dividerTransform, foregroundX, panelX, railBrandGeometry, railGeometry, railRowHeight, screenX, surfaceWidth} from '../src/shell/rail-geometry.ts';
import {brandOutlineBounds, brandViewBox} from '../src/ui/brand-ink.ts';

// The television and iPad frames as Rail.tsx builds them from the theme.
const tv = railGeometry({railWidth: 112, railWidthExpanded: 340, paddingX: 20, border: 1, icon: 30, gap: 20, dividerInset: 8});
const tablet = railGeometry({railWidth: 60, railWidthExpanded: 212, paddingX: 8, border: 1, icon: 22, gap: 12, dividerInset: 4});
const near = (actual: number, expected: number, message?: string, within = 1e-9) => assert.ok(Math.abs(actual - expected) <= within, `${message ?? ''} ${actual} ≠ ${expected}`);
const steps = Array.from({length: 101}, (_, i) => i / 100);

test('television: icon centred in the collapsed surface, text after it, both fixed on screen', () => {
  assert.equal(tv.hiddenWidth, 228);
  assert.equal(tv.collapsedInner, 71);
  assert.equal(tv.expandedInner, 299);
  const at = (p: number) => ({icon: screenX(tv, p, tv.iconX), text: screenX(tv, p, tv.textX), surface: surfaceWidth(tv, p)});
  assert.deepEqual(at(0), {icon: 40.5, text: 90.5, surface: 71});
  assert.deepEqual(at(0.5), {icon: 40.5, text: 90.5, surface: 185});
  assert.deepEqual(at(1), {icon: 40.5, text: 90.5, surface: 299});
  // The icon's centre is the collapsed surface's centre (TV-RAIL-01), at every step.
  for (const p of steps) near(screenX(tv, p, tv.iconX) + 15, 20 + 71 / 2, `p=${p}`);
});

test('no step anywhere moves the foreground or jumps the surface', () => {
  for (const g of [tv, tablet]) {
    for (let i = 1; i < steps.length; i++) {
      const [a, b] = [steps[i - 1]!, steps[i]!];
      near(screenX(g, b, g.iconX), screenX(g, a, g.iconX), `icon ${a}→${b}`);
      near(screenX(g, b, g.textX), screenX(g, a, g.textX), `text ${a}→${b}`);
      // The surface grows smoothly: never more than its share of the slide per step.
      assert.ok(Math.abs(surfaceWidth(g, b) - surfaceWidth(g, a)) <= g.hiddenWidth * (b - a) + 1e-9);
    }
  }
});

test('the surface ends exactly where the panel is visible, inside its padding and border, at every step', () => {
  for (const [g, railWidthExpanded, border] of [[tv, 340, 1], [tablet, 212, 1]] as const) {
    for (const p of steps) {
      const surfaceRight = screenX(g, p, 0) + surfaceWidth(g, p);
      const panelInnerRight = panelX(g, p) + railWidthExpanded - g.paddingX - border;
      near(surfaceRight, panelInnerRight, `p=${p}`);
    }
  }
});

test('focus scale grows the row about its visible surface, not about the mostly hidden host', () => {
  const scale = 1.015;
  for (const p of [0, 0.5, 1]) {
    // Foreground centre C = expandedInner / 2; a point x lands at C + s(x − C) + translateX.
    const land = (x: number) => tv.expandedInner / 2 + scale * (x - tv.expandedInner / 2) + foregroundX(tv, p, scale) - tv.hiddenWidth * (1 - p);
    near(land(surfaceWidth(tv, p) / 2), surfaceWidth(tv, p) / 2, `centre stays, p=${p}`, 1e-9);
    near(land(0), -(scale - 1) * surfaceWidth(tv, p) / 2, `left grows outward evenly, p=${p}`, 1e-9);
  }
  // Collapsed and focused: 0.53 px each side, within the scroller's 4 px clearance.
  near(-(scale - 1) * 71 / 2, -0.5325, 'collapsed growth', 1e-9);
});

test('dividers run the surface less their insets, left end fixed, and match the old expanded rule', () => {
  for (const g of [tv, tablet]) {
    for (const p of steps) {
      const {translateX, scaleX} = dividerTransform(g, p);
      // A point x of the full-width line (centre W/2), relative to the line's own left.
      const land = (x: number) => g.dividerWidth / 2 + scaleX * (x - g.dividerWidth / 2) + translateX - g.hiddenWidth * (1 - p);
      near(land(0), 0, `left fixed, p=${p}`, 1e-9);
      near(land(g.dividerWidth) - land(0), surfaceWidth(g, p) - 2 * g.dividerInset, `width, p=${p}`, 1e-9);
    }
  }
  // Television: x 28…83 closed (centred on the icons at 55.5) and 28…311 open.
  assert.equal(screenX(tv, 0, tv.dividerInset), 28);
  near(28 + surfaceWidth(tv, 0) - 2 * 8, 83);
  near(28 + surfaceWidth(tv, 1) - 2 * 8, 311);
});

test('brand: the symbol P is the wordmark P (height, top, left), centred in the collapsed column', () => {
  for (const [g, brandHeight, slotHeight] of [[tv, 52, 62], [tablet, 36, 44]] as const) {
    const b = railBrandGeometry({brandHeight, slotHeight, collapsedInner: g.collapsedInner});
    // Within 0.05 of a design pixel on every edge (the PNG's own anti-aliasing is finer than that).
    near(b.p.x, b.wordmarkP.x, 'left', 0.05);
    near(b.p.y, b.wordmarkP.y, 'top', 0.05);
    near(b.p.height, b.wordmarkP.height, 'height', 0.05);
    near(b.p.x + b.p.width, b.wordmarkP.x + b.wordmarkP.width, 'right', 0.05);
    // Centred like the row icons; the wordmark is vertically centred in its slot and fits the open rail.
    near(b.p.x + b.p.width / 2, g.collapsedInner / 2, 'centred');
    near(b.y, (slotHeight - brandHeight) / 2, 'slot');
    assert.ok(b.x >= 0 && b.x + b.wordmarkWidth <= g.expandedInner);
  }
  // The P's box in the viewBox is the outline's, not the padded viewBox's.
  assert.equal(brandOutlineBounds.height / brandViewBox.height, 361 / 405);
});

test('the settings row reserves room for its subtitle at both text sizes', () => {
  // Television: rowSpec minHeight.withSubtitle 80, paddingY 12; bodyStrong + caption line heights.
  assert.equal(railRowHeight({single: 64, withSubtitle: 80, titleLine: 33, subtitleLine: 27, paddingY: 12}), 84);
  assert.equal(railRowHeight({single: 64, withSubtitle: 80, titleLine: 40, subtitleLine: 32, paddingY: 12}), 96);
  // iPad: captionStrong + caption; the spec's 56 already holds them.
  assert.equal(railRowHeight({single: 56, withSubtitle: 56, titleLine: 18, subtitleLine: 18, paddingY: 8}), 56);
  // No subtitle: the destination height.
  assert.equal(railRowHeight({single: 64, titleLine: 33, subtitleLine: 27, paddingY: 12}), 64);
});
