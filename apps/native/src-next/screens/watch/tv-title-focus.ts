import type {FocusRegionConfig} from '../../kit/focus/registry';

/** One declarative section chain for every television title page. */
export function tvTitleRegionMap(scope: string, rail: string | undefined, show: boolean, related: readonly string[], collection: boolean, people: boolean) {
  const prefix = `title.${scope}`, actions = `${prefix}.actions`, episodes = `${prefix}.episodes`, cast = `${prefix}.people`, collectionId = `${prefix}.collection`;
  const rows = related.map(id => `${prefix}.related.${JSON.stringify(id)}`);
  const chain = [actions, ...(show ? [episodes] : []), ...rows, ...(people ? [cast] : [])];
  const start = {regionId: actions, childId: 'watch-title-play'};
  const sections = new Map<string, FocusRegionConfig>(chain.map((id, index) => [id, {
    id, orientation: 'horizontal', neighbors: {previous: chain[index - 1], next: chain[index + 1]}, screenStart: start,
    edges: {left: rail, up: chain[index - 1], down: chain[index + 1]}, stops: {up: index === 0 && !collection, down: index === chain.length - 1},
  }]));
  const actionRegion = {...sections.get(actions)!, entry: start.childId, edges: {...sections.get(actions)!.edges, up: collection ? collectionId : undefined}};
  return {prefix, actions: actionRegion, episodes: sections.get(episodes),
    related: new Map(related.map((id, index) => [id, sections.get(rows[index]!)!])),
    people: sections.get(cast), collection: {id: collectionId, entry: 'watch-title-collection', orientation: 'horizontal' as const,
      stops: {up: true}, edges: {left: rail, down: actions}, screenStart: start}, start};
}
