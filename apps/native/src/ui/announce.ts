import {AccessibilityInfo} from 'react-native';

/**
 * What a screen reader is told about changes it cannot see.
 *
 * A destination is announced once when it becomes the current screen: its name, as soon as that
 * is known. A background refresh, a change of focus within the screen, or the same screen with
 * the same name again says nothing. Coming back to a screen is arriving at it, so it is named
 * again. Nothing is announced for a screen that is not the current one, which is also what keeps
 * one profile's titles from being spoken after another profile has been chosen.
 */
export class DestinationAnnouncer {
  private current: string | undefined;
  private said: string | undefined;

  /**
   * The state of one screen: whether it is the current one, and its name if known. Returns the
   * name to speak now, or null.
   */
  next(routeKey: string, title: string | undefined, focused: boolean): string | null {
    const name = title?.trim();
    if (!focused) {
      // Left: the next arrival is announced, even under the same name.
      if (this.current === routeKey) { this.current = undefined; this.said = undefined; }
      return null;
    }
    if (this.current !== routeKey) { this.current = routeKey; this.said = undefined; }
    if (!name || name === this.said) return null;
    this.said = name;
    return name;
  }
}

/** Speaks `text` through the system's screen reader. Does nothing when none is running. */
export function announce(text: string | undefined | null): void {
  const words = text?.trim();
  if (!words) return;
  try {
    // Queued behind what is already being read, where the system can do that (Apple).
    if (typeof AccessibilityInfo.announceForAccessibilityWithOptions === 'function') AccessibilityInfo.announceForAccessibilityWithOptions(words, {queue: true});
    else AccessibilityInfo.announceForAccessibility(words);
  } catch {
    // A runtime without the call: nothing to say it with.
  }
}
