/**
 * Android TV and Fire TV: the remote's Menu key opens the focused control's own menu and never
 * presses the control. It used to be sent as a held Select, which pressed every control that had
 * no long-press action (Sign out, Delete, Play) when the hold was released.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the activity never turns Menu into Select', () => {
  const activity = source('android/app/src/main/java/tv/getportico/portico/MainActivity.kt');
  assert.doesNotMatch(activity, /KEYCODE_DPAD_CENTER/);
  assert.doesNotMatch(activity, /postDelayed/);
  // The views still see the key, so JavaScript hears the remote's `menu` event.
  assert.match(activity, /window\.superDispatchKeyEvent\(event\)/);
});

test('Menu runs the focused control\'s long-press action, and only that', () => {
  const focusable = source('src/ui/Focusable.tsx');
  assert.match(focusable, /event\?\.eventType === 'menu' && event\.eventKeyAction === 1\) focusedMenu\?\.run\(\)/);
  assert.match(focusable, /if \(Platform\.OS !== 'android' \|\| !Platform\.isTV\) return;/);
  // A busy or disabled control, or one with no long-press action, has nothing for Menu to run.
  assert.match(focusable, /heldNow\.current = onLongPress && !busy && !disabled \? onLongPress : undefined;/);
  assert.match(source('App.tsx'), /useMenuKey\(\);/);
});
