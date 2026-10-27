import type {HomeDocument} from '../../../../../packages/client-core/src/home';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {homeEntryCapabilities} from '../../../../../packages/client-core/src/home-selection';
import {homeSpotlightModels} from '../../../../../packages/client-core/src/presentation/home-spotlight';
import type {FocusAddress, FocusRegistry} from '../../kit/focus/registry';
import type {ShellAuthority} from '../../shell/model';
import {tvFocusIds} from '../../shell/tv-focus';
import {authorizedHome, homeRowHasContent, platformRows} from './model';

export const homeMixesFocusRow = 'portico.profile.music-mixes';
type SpotlightAction = 'play' | 'my-list' | 'details';
/** The same existing server offers drive both the rendered buttons and start proof. */
export function homeSpotlightFocusActions(entry: Parameters<typeof homeEntryCapabilities>[0], target: ContentEntry | undefined, context: Parameters<typeof homeEntryCapabilities>[1]) {
  const offers = homeEntryCapabilities(entry, context);
  const order: SpotlightAction[] = [];
  if (offers.playable && target?.playback) order.push('play');
  if (offers.watchlisted !== undefined) order.push('my-list');
  if (offers.details) order.push('details');
  return {offers, order};
}
export type HomeStartModel = Readonly<{
  ids: ReturnType<typeof tvFocusIds>; resolved: boolean; spotlightActions: boolean; fallbacks: readonly string[];
}>;
/** Only a document admitted to this immutable authority proves permanent absence. */
export function homeStartModel(document: HomeDocument | undefined, authority: ShellAuthority, options: Readonly<{
  rows?: readonly string[]; readLibraryIds?: ReadonlySet<string>; mixesReady?: boolean; playbackAvailable?: boolean;
}> = {}): HomeStartModel {
  const ids = tvFocusIds(authority), admitted = authorizedHome(document, authority);
  if (!admitted) return {ids, resolved: false, spotlightActions: false, fallbacks: []};
  const rows = options.rows ?? platformRows(admitted, 'tv', options.readLibraryIds ?? new Set()).filter(homeRowHasContent).map(row => row.id);
  return {ids, resolved: true,
    spotlightActions: homeSpotlightModels(admitted).some(model => homeSpotlightFocusActions(model.entry, model.primary?.entry, {platform: 'tv', playbackAvailable: options.playbackAvailable === true}).order.length > 0),
    fallbacks: [...rows.map(ids.row), ...(options.mixesReady ? [ids.row(homeMixesFocusRow)] : []), ids.customize]};
}
export type HomeStartResolution = Readonly<{kind: 'waiting'; address?: undefined}> | Readonly<{kind: 'ready'; address: FocusAddress}>;
type StartRegistry = Pick<FocusRegistry, 'entryAddress' | 'config' | 'host'>;
const waiting: HomeStartResolution = {kind: 'waiting'};

/** The committed neighbor chain preserves rendered row order while Home retains
 * a focused row. It cannot borrow a latest-data ordering from another presenter. */
function renderedFallbacks(registry: StartRegistry, model: HomeStartModel): readonly string[] | undefined {
  const {ids} = model, root = registry.config(ids.customize);
  let id = root?.neighbors?.previous ?? root?.edges?.up;
  if (!id) return model.fallbacks; // No committed chain yet: retain the actual declared candidates.
  const rowPrefix = ids.row('').slice(0, -JSON.stringify('').length), seen = new Set<string>(), reversed: string[] = [];
  while (id !== ids.spotlight) {
    if (seen.has(id) || !id.startsWith(rowPrefix)) return;
    seen.add(id); reversed.push(id);
    const config = registry.config(id);
    id = config?.neighbors?.previous ?? config?.edges?.up;
    // Missing region metadata is genuinely deferred, not proof the start vanished.
    if (!id) return;
  }
  return [...reversed.reverse(), ids.customize];
}
/** No host is invented. Waiting is distinct from a permanently absent Play action. */
export function resolveTVHomeStart(registry: StartRegistry, model: HomeStartModel): HomeStartResolution {
  if (!model.resolved) return waiting;
  const primary = registry.entryAddress(model.ids.spotlight);
  if (primary) return {kind: 'ready', address: primary};
  const declared = registry.config(model.ids.spotlight);
  const emptyLiveSpotlight = !!registry.host(model.ids.spotlight) && declared?.enabled !== false && declared?.order?.length === 0;
  if (model.spotlightActions && !emptyLiveSpotlight) return waiting;
  const fallbacks = renderedFallbacks(registry, model);
  if (!fallbacks) return waiting;
  for (const regionId of fallbacks) {
    if (registry.config(regionId)?.enabled === false) continue;
    const address = registry.entryAddress(regionId);
    // Do not skip a real virtualized first region to a later mounted control.
    return address ? {kind: 'ready', address} : waiting;
  }
  return waiting;
}
export type HomeMenuState = Readonly<{
  home: boolean; visible: boolean; obscured: boolean; expanded: boolean; listening: boolean;
  scrolled: boolean; account: boolean; rail: boolean; chromeHidden: boolean; contentVisible: boolean; overlay: boolean;
}>;
export function canYieldTVHomeMenu(start: HomeStartResolution, focused: FocusAddress | undefined, state: HomeMenuState): boolean {
  return start.kind === 'ready' && state.home && state.visible && !state.obscured && !state.expanded && !state.listening
    && !state.scrolled && !state.account && !state.rail && !state.chromeHidden && state.contentVisible && !state.overlay
    && focused?.regionId === start.address.regionId && focused.childId === start.address.childId;
}
