import {useEffect} from 'react';
import {BackHandler, Platform} from 'react-native';

export type TVBackAction =
  | 'close-rail'
  | 'close-transient'
  | 'invoke-override'
  | 'navigate-back'
  | 'open-rail'
  | 'system';
export type TVBackEventKind = 'discrete' | 'held' | 'system-reserved';
export type TVRailOpenOrigin = 'back-root' | 'content' | 'none';

class TVBackOverrideRegistry {
  private owner?: symbol;
  private action?: () => void;

  register(action: () => void): () => void {
    const owner = Symbol('tv-back-owner');
    this.owner = owner;
    this.action = action;
    return () => {
      if (this.owner !== owner) return;
      this.owner = undefined;
      this.action = undefined;
    };
  }

  invoke(): boolean {
    if (!this.action) return false;
    this.action();
    return true;
  }

  get active(): boolean {
    return Boolean(this.action);
  }
}

export const tvBackOverrideRegistry = new TVBackOverrideRegistry();

export function tvBackAction({
  atPrimaryRoot = false,
  canGoBack,
  eventKind = 'discrete',
  overrideOpen = false,
  railOpen = false,
  railOrigin = 'none',
  transientOpen,
}: {
  atPrimaryRoot?: boolean;
  canGoBack: boolean;
  eventKind?: TVBackEventKind;
  overrideOpen?: boolean;
  railOpen?: boolean;
  railOrigin?: TVRailOpenOrigin;
  transientOpen: boolean;
}): TVBackAction {
  if (eventKind !== 'discrete') return 'system';
  if (transientOpen) return 'close-transient';
  if (overrideOpen) return 'invoke-override';
  if (railOpen) {
    if (atPrimaryRoot && railOrigin === 'back-root') return 'system';
    return 'close-rail';
  }
  if (canGoBack) return 'navigate-back';
  if (atPrimaryRoot) return 'open-rail';
  return 'system';
}

/**
 * Adds only Portico's priority above React Navigation. On tvOS the Menu key
 * reaches BackHandler through react-native-tvos. If no transient UI is open,
 * the standard navigator pops its stack. At a root tab the first discrete
 * event focuses the rail; a second remains unhandled for system exit.
 */
export function useTVNavigationBack({
  canGoBack,
  closeTransient,
  closeRail,
  goBack,
  isAtPrimaryRoot = () => false,
  railState = () => ({open: false, origin: 'none'}),
  openRail = () => undefined,
  transientOpen,
}: {
  canGoBack(): boolean;
  closeTransient(): void;
  closeRail(): void;
  goBack(): void;
  isAtPrimaryRoot?(): boolean;
  railState?(): {open: boolean; origin: TVRailOpenOrigin};
  openRail?(): void;
  transientOpen: boolean;
}) {
  useEffect(() => {
    if (!Platform.isTV) return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        const atPrimaryRoot = isAtPrimaryRoot();
        const rail = railState();
        const action = tvBackAction({
          atPrimaryRoot,
          canGoBack: canGoBack(),
          overrideOpen: tvBackOverrideRegistry.active,
          railOpen: rail.open,
          railOrigin: rail.origin,
          transientOpen,
        });
        if (action === 'close-transient') {
          closeTransient();
          return true;
        }
        if (action === 'close-rail') {
          closeRail();
          return true;
        }
        if (action === 'navigate-back') {
          goBack();
          return true;
        }
        if (action === 'invoke-override')
          return tvBackOverrideRegistry.invoke();
        if (action === 'open-rail') {
          openRail();
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [
    canGoBack,
    closeRail,
    closeTransient,
    goBack,
    isAtPrimaryRoot,
    openRail,
    railState,
    transientOpen,
  ]);
}
