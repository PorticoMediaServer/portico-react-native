import type {BrowseCapabilities, BrowseNode, BrowseSortSelection} from '../../../../packages/client-core/src/browse';

/** Local adapter: the shared toolbar currently consumes the library-wide vocabulary. */
export function scopeBrowseCapabilities(capabilities: BrowseCapabilities, pivotId: string, surfaceId = 'library'): BrowseCapabilities {
  const pivot = capabilities.pivots.find(p => p.id === pivotId) ?? (capabilities.resolvedPivot?.id === pivotId ? capabilities.resolvedPivot : undefined);
  const surface = capabilities.surfaces?.find(s => s.id === surfaceId);
  const surfaceSorts = capabilities.surfaces ? surface?.sorts ?? [] : undefined;
  const surfaceFilters = capabilities.surfaces ? surface?.filters ?? [] : undefined;
  const allowed = (id: string, pivotIds: readonly string[] | undefined, surfaceIds: readonly string[] | undefined) => !!pivotIds?.includes(id) && (surfaceIds === undefined || surfaceIds.includes(id));
  const sorts = capabilities.sorts.filter(s => allowed(s.id, pivot?.sorts, surfaceSorts));
  const fields = capabilities.fields.filter(f => allowed(f.id, pivot?.filters, surfaceFilters));
  const supports = (node: BrowseNode): boolean => {
    if ('field' in node) return fields.some(f => f.id === node.field && f.operators.includes(node.operator));
    if ('not' in node) return supports(node.not);
    return ('all' in node ? node.all : node.any).every(supports);
  };
  const defaults = pivot?.defaultSort.filter(s => sorts.some(c => c.id === s.field && c.directions.includes(s.direction))) ?? [];
  const defaultSort = defaults.length ? defaults : sorts.length ? [{field: sorts[0]!.id, direction: sorts[0]!.defaultDirection}] : [];
  return {...capabilities, sorts, fields, quickFilters: capabilities.quickFilters.filter(q => supports(q.query)), resolvedPivot: pivot ? {...pivot, defaultSort} : null};
}

/** A remembered sort must still be advertised for this surface, including its direction. */
export function offeredBrowseSort(capabilities: BrowseCapabilities | undefined, selected?: BrowseSortSelection): BrowseSortSelection {
  const cap = selected && capabilities?.sorts.find(s => s.id === selected.field);
  if (selected && cap) return {...selected, direction: cap.directions.includes(selected.direction) ? selected.direction : cap.defaultDirection};
  return capabilities?.resolvedPivot?.defaultSort[0] ?? {field: 'title', direction: 'asc'};
}
