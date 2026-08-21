export type TVRailFocusTerminal = 'completed' | 'interrupted' | 'cancelled';

export interface ScopedTVFocusDestination<T> {
  scope: string;
  target: T;
}

export function tvRailHandoffCanComplete({
  collapseFocusEpoch,
  currentFocusEpoch,
  currentToken,
  expanded,
  token,
}: {
  collapseFocusEpoch: number;
  currentFocusEpoch: number;
  currentToken?: number;
  expanded: boolean;
  token: number;
}): boolean {
  return !expanded
    && currentToken === token
    && collapseFocusEpoch === currentFocusEpoch;
}

export function tvFocusTargetForScope<T>(
  scope: string,
  destination: ScopedTVFocusDestination<T> | undefined,
): T | undefined {
  return destination?.scope === scope ? destination.target : undefined;
}

export class TVRailFocusHandoff<T> {
  private nextToken = 0;
  private pending?: {target?: T; terminal?: TVRailFocusTerminal; token: number};

  begin(target: T | undefined): number {
    const token = ++this.nextToken;
    this.pending = {target, token};
    return token;
  }

  terminalize(token: number, terminal: TVRailFocusTerminal): T | undefined {
    if (this.pending?.token !== token) return undefined;
    this.pending.terminal = terminal;
    return this.pending.target;
  }

  supplyTarget(target: T): T | undefined {
    if (!this.pending || this.pending.target) return undefined;
    this.pending.target = target;
    return this.pending.terminal ? target : undefined;
  }

  replaceTarget(previous: T, replacement?: T): T | undefined {
    if (this.pending?.target !== previous) return undefined;
    this.pending.target = replacement;
    return replacement && this.pending.terminal ? replacement : undefined;
  }

  abandon(token?: number): boolean {
    if (token !== undefined && this.pending?.token !== token) return false;
    const abandoned = Boolean(this.pending);
    this.pending = undefined;
    return abandoned;
  }

  isCurrent(token: number): boolean { return this.pending?.token === token; }

  complete(target: T): boolean {
    if (this.pending?.target !== target || !this.pending.terminal) return false;
    this.pending = undefined;
    return true;
  }

  get active(): boolean { return Boolean(this.pending); }
}
