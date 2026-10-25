import React, {useSyncExternalStore} from 'react';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {CollectionPicker, PlaylistPicker, type PickerEntry, type PickerResult} from '../../kit/selection';
import type {NativeLoadedDestinations} from './loaded-destinations';

/** The drawn playlist/collection picker (select.html frames 20–22), mounted on the
 * bounded destination controller: the same controller, chosen destination and
 * completed prefix stay through a retry, so an uncertain write is never cleared. */
export type NativeDestinationPickerProps = Readonly<{
  controller: NativeLoadedDestinations;
  kind: 'playlist' | 'collection';
  open: boolean;
  selectionLabel: string;
  count: number;
  artwork: (path?: string) => React.ReactNode;
  onOpenChange: (open: boolean) => void;
}>;

export function NativeDestinationPicker({controller, kind, open, selectionLabel, count, artwork, onOpenChange}: NativeDestinationPickerProps) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const snapshot = controller.snapshot();
  const saved = snapshot.playlists, personal = snapshot.collections;
  const selected = snapshot.chosen?.kind === kind ? snapshot.chosen.id : undefined;
  const entries: PickerEntry[] = kind === 'playlist'
    ? (saved.projection?.sections ?? []).flatMap(section => section.entries).flatMap(entry => entry.kind === 'playlist'
      ? [{id: entry.id, title: entry.title, size: entry.count ?? 0, canAdd: true, artwork: artwork(entry.artworkPaths?.[0])}]
      : [])
    : personal.resources.flatMap(resource => resource.kind === 'collection'
      ? [{id: resource.id, title: resource.name, size: resource.entryCount, canAdd: true, artwork: artwork(resource.artworkPaths?.[0])}]
      : []);
  const receipt = kind === 'collection' ? snapshot.collectionReceipts[snapshot.collectionReceipts.length - 1] : undefined;
  const destination = kind === 'playlist'
    ? {id: selected ?? '', title: snapshot.playlist.playlist?.name ?? '', size: snapshot.playlist.playlist?.entryCount}
    : {id: selected ?? '', title: snapshot.collection.resource?.name ?? '', size: snapshot.collection.resource?.entryCount};
  const result: PickerResult | undefined = !selected ? undefined : kind === 'playlist'
    ? {destination, processed: snapshot.completed, inserted: snapshot.completed, total: count, failed: 0, failures: [], complete: snapshot.completed >= count}
    : receipt
      ? {destination, processed: receipt.added.length + receipt.unchanged.length + receipt.failed.length, inserted: receipt.added.length,
          alreadyIn: receipt.unchanged.length, failed: receipt.failed.length, total: count, complete: true,
          failures: receipt.failed.map(failure => ({id: failure.itemId, title: failure.itemId, reason: failure.code}))}
      : {destination, total: count, failures: [], complete: false};
  const loading = kind === 'playlist' ? saved.phase === 'loading' : personal.loading;
  const error = kind === 'playlist'
    ? saved.error ? presentError(saved.error, 'saved', {operation: 'load'}).body : undefined
    : personal.error ? presentError(personal.error, 'saved', {operation: 'load'}).body : undefined;
  const props = {
    open, onOpenChange, count, selectionLabel, entries, query: '', onQueryChange: () => {}, showFind: false,
    creating: false, onCreatingChange: () => {}, name: '', onNameChange: () => {}, onCreateAndAdd: () => {},
    onAdd: (id: string) => {void controller.choose(kind, id).catch(() => {});},
    onRetry: () => {void controller.retry().catch(() => {});},
    hasNext: kind === 'playlist' ? saved.pagination.next.length > 0 : !!personal.nextCursor,
    hasPrevious: kind === 'playlist' ? saved.pagination.canPrevious : personal.history.length > 0,
    onNext: () => {void controller.next(kind).catch(() => {});},
    onPrevious: () => {void controller.previous(kind).catch(() => {});},
    loading, error, pending: snapshot.busy, result, testID: `search-destination-${kind}`,
    onViewDestination: () => onOpenChange(false), onResultDismiss: () => onOpenChange(false),
  };
  return kind === 'playlist' ? <PlaylistPicker {...props}/> : <CollectionPicker {...props}/>;
}
