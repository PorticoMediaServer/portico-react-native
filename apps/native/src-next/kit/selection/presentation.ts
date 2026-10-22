import type {DeletePreview} from '../../../../../packages/client-core/src/administration';
import type {BulkChanges, BulkFieldChange, SelectionOutcome} from './types';

export function failedSelectionIds(outcomes: readonly Pick<SelectionOutcome, 'id' | 'ok'>[]): readonly string[] {
  return [...new Set(outcomes.filter(row => !row.ok).map(row => row.id))];
}

export function changeScalar(changes: BulkChanges, field: string, value: string): BulkChanges {
  return {...changes, [field]: {value}};
}
export function removeFieldChange(changes: BulkChanges, field: string): BulkChanges {
  return Object.fromEntries(Object.entries(changes).filter(([key]) => key !== field));
}
export function setListChange(changes: BulkChanges, field: string, add: readonly string[], remove: readonly string[]): BulkChanges {
  return add.length || remove.length ? {...changes, [field]: {add, remove}} : removeFieldChange(changes, field);
}

export function changeList(changes: BulkChanges, field: string, value: string, operation: 'add' | 'remove'): BulkChanges {
  const prior: BulkFieldChange | undefined = changes[field];
  const list = prior && 'add' in prior ? prior : {add: [], remove: []};
  const opposite = operation === 'add' ? 'remove' : 'add';
  const next = {...list, [operation]: [...new Set([...list[operation], value])], [opposite]: list[opposite].filter(item => item !== value)};
  return setListChange(changes, field, next.add, next.remove);
}

/** Uses the exact current preview; no title/count substitution, chunking or permissive fallback. */
export function deleteSelectionGate(input: {owner: boolean; selectionCount: number; preview: DeletePreview | null; confirmation: string; pending?: boolean; loading?: boolean}) {
  const {preview} = input;
  if (!input.owner) return 'owner' as const;
  if (input.selectionCount > 200) return 'limit' as const;
  if (input.loading || !preview) return 'preview' as const;
  if (preview.targets.length !== input.selectionCount || !preview.targets.length) return 'preview' as const;
  if (new Set(preview.targets.map(target => target.libraryId)).size !== 1) return 'libraries' as const;
  if (preview.blocked.length || preview.targets.some(target => !target.allowMediaDeletion)) return 'blocked' as const;
  if (input.pending) return 'pending' as const;
  if (input.confirmation !== preview.confirmation) return 'confirmation' as const;
  return null;
}
