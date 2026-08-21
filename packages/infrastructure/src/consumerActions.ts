export type ClientPlatform = 'ios' | 'tvos' | 'android' | 'android-tv' | 'fire-tv' | 'vega-os' | 'unknown';

const ADMIN_ACTIONS = new Set([
  'metadata.edit',
  'metadata.refresh',
  'media.analyze',
  'media.optimize',
  'media.delete',
  'library.create',
  'library.edit',
  'library.scan',
  'library.delete',
  'server.settings',
  'server.diagnostics',
]);

const IOS_ONLY_ACTIONS = new Set(['download']);

/**
 * Enforces the product boundary that consumer apps never expose server
 * administration, even if an owner account receives those capabilities from
 * the server. Unknown actions fail closed until deliberately classified.
 */
export function consumerMediaActions(actions: readonly string[] | undefined, platform: ClientPlatform): string[] {
  if (!actions) return [];
  return actions.filter(action => {
    if (ADMIN_ACTIONS.has(action) || isAdministrativeFamily(action)) return false;
    if (IOS_ONLY_ACTIONS.has(action)) return platform === 'ios';
    return isKnownConsumerAction(action);
  });
}

export function isConsumerMediaAction(action: string, platform: ClientPlatform): boolean {
  return consumerMediaActions([action], platform).length === 1;
}

function isAdministrativeFamily(action: string): boolean {
  return /^(metadata|library|server|admin)\./.test(action);
}

function isKnownConsumerAction(action: string): boolean {
  return action === 'play' ||
    action === 'play.from-beginning' ||
    action === 'live.play' ||
    action === 'dvr.play' ||
    action === 'download' ||
    action === 'queue.add' ||
    action === 'watchlist.add' ||
    action === 'watchlist.remove' ||
    action === 'favorite.add' ||
    action === 'favorite.remove' ||
    action === 'watched.set' ||
    action === 'reaction.set' ||
    action === 'rating.set' ||
    action === 'collection.add' ||
    action === 'playlist.add' ||
    action === 'feedback.report-problem' ||
    action === 'feedback.request-higher-quality' ||
    action === 'watch-with-friends.start';
}
