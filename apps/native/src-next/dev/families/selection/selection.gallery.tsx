import React, {useState} from 'react';
import {View} from 'react-native';
import type {Gallery} from '../../gallery-registry';
import {selectionNativeFixtures as fixture} from '../../../../../../packages/i18n/src/catalog/en-US/next/dev/selection-native-fixtures';
import {formatMessage} from '../../../../../../packages/i18n/src/index';
import type {DeletePreview, DeleteResult} from '../../../../../../packages/client-core/src/administration';
import type {RepairFieldSpec} from '../../../../../../packages/client-core/src/metadata-repair';
import type {BulkReceipt} from '../../../../../../packages/client-core/src/metadata-bulk';
import {CoverMosaic, Artwork, type ArtworkSource} from '../../../kit/artwork/index';
import {PosterCard} from '../../../kit/cards/index';
import {Button} from '../../../kit/controls/Button';
import {OverlaysProvider} from '../../../kit/overlays/index';
import {OwnerTag} from '../../../kit/shell/index';
import {SelectionCircle, SelectionBar, SelectionPhoneActionBar, BulkEditor, PlaylistPicker, CollectionPicker, DeleteMediaDialog, MixedEditExplainer, type BulkChanges, type PickerEntry, type SelectionAction, type SelectionActionOffer, type SelectionOutcome} from '../../../kit/selection/index';
import {SelectionText} from '../../../kit/selection/surface';
import {useTheme} from '../../../kit/theme';

// Only this __DEV__ module composes reference data and in-memory operation outcomes.
const reference = 'http://100.120.50.24:8787/assets/pool/movies/';
const art = (index: number): ArtworkSource => ({uri: `${reference}${['toy-story.jpg', 'toy-story-2.jpg', 'toy-story-3.jpg', 'toy-story-5.jpg'][index]}`, cacheKey: `selection-reference-${index}`});
const schemas: readonly RepairFieldSpec[] = [
  {field: 'contentRating', label: fixture.fields.contentRating, group: 'general', type: 'text', bulk: true},
  {field: 'studio', label: fixture.fields.studio, group: 'general', type: 'text', bulk: true},
  {field: 'country', label: fixture.fields.country, group: 'general', type: 'text', bulk: true},
  {field: 'year', label: fixture.fields.year, group: 'numbers', type: 'integer', min: 0, max: 9999, bulk: true},
  {field: 'edition', label: fixture.fields.edition, group: 'general', type: 'text', bulk: true},
  {field: 'metadataLanguage', label: fixture.fields.metadataLanguage, group: 'general', type: 'text', bulk: true},
  {field: 'genres', label: fixture.fields.genres, group: 'general', type: 'list', bulk: true},
  {field: 'tags', label: fixture.fields.tags, group: 'general', type: 'list', bulk: true},
  {field: 'labels', label: fixture.fields.labels, group: 'general', type: 'list', bulk: true},
];
const actionIds: readonly SelectionAction[] = ['play', 'queue', 'playlist', 'myList', 'more', 'playNext', 'playLater', 'watched', 'unwatched', 'collection', 'favorite', 'download', 'edit', 'refresh', 'delete'];
const actions: readonly SelectionActionOffer[] = actionIds.map(id => ({id}));
type Scenario = keyof typeof fixture.scenarios;
function SelectionExample({scenario}: {scenario: Scenario}) {
  const theme = useTheme();
  const [selected, setSelected] = useState<readonly string[]>(scenario === 'circles' ? [] : theme.isTV ? ['0', '1', '2'] : ['0', '1', '2', '3']);
  const [menu, setMenu] = useState<'queue' | 'watched' | 'more' | null>(scenario === 'queue' ? 'queue' : scenario === 'more' ? 'more' : null);
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(scenario === 'newPlaylist');
  const [name, setName] = useState(scenario === 'newPlaylist' ? fixture.newName : '');
  const [query, setQuery] = useState('');
  const [lastAction, setLastAction] = useState<SelectionAction | 'navigate'>();
  const [changes, setChanges] = useState<BulkChanges>({contentRating: {value: fixture.values.rating}, tags: {add: [fixture.tags[1]], remove: []}});
  const [lockEdited, setLockEdited] = useState(true);
  const [bulkResult, setBulkResult] = useState<BulkReceipt | undefined>(scenario === 'editResult' ? receipt() : undefined);
  const [removeFiles, setRemoveFiles] = useState(scenario !== 'deleteOff');
  const [confirmation, setConfirmation] = useState(scenario === 'deleteSeveral' || scenario === 'deleteOff' ? '4' : '');
  const [deleteResult, setDeleteResult] = useState<DeleteResult | undefined>(scenario === 'deleteResult' ? deletionResult() : undefined);
  const [pickerResult, setPickerResult] = useState<{destination: PickerEntry; outcomes: readonly SelectionOutcome[]} | undefined>();
  const size = theme.isTV ? 76 : 48;
  const collection = scenario === 'collection';
  const entries: PickerEntry[] = (collection ? fixture.collections : fixture.playlists).map((title, index) => ({id: String(index), title, size: [12, 6, 9][index], alreadyIn: index === 0 ? 2 : 0,
    artwork: <CoverMosaic covers={[art(index), art((index + 1) % 4), art((index + 2) % 4), art((index + 3) % 4)]} shape="square" width={size} height={size} />}));
  const destination = entries[0];
  const pickerCount = theme.isTV ? 3 : 4;
  const outcomes = fixture.movieTitles.slice(0, pickerCount).map((title, index) => ({id: String(index), title, ok: index !== pickerCount - 1, reason: index === pickerCount - 1 ? fixture.failedAdd : undefined}));
  const suppliedResult = pickerResult ?? (scenario === 'partialPlaylist' ? {destination, outcomes} : undefined);
  const close = (next: boolean) => setOpen(next);
  const onAction = (action: SelectionAction) => {setLastAction(action); if (action === 'myList' || action === 'play') setSelected([]);};
  const barProps = {count: selected.length, subtitle: fixture.films, selectAllLabel: fixture.selectAll, onSelectAll: () => setSelected(['0', '1', '2', '3']), onCancel: () => setSelected([]), actions, onAction, menu, onMenuChange: setMenu, ownerTag: <OwnerTag compact variant="badge" />};
  const base = {open, onOpenChange: close, ownerHeader: <View style={{paddingHorizontal: 20, paddingTop: 8}}><OwnerTag compact /></View>};
  const isPicker = ['playlist', 'newPlaylist', 'partialPlaylist', 'collection'].includes(scenario);
  const isEditor = ['editor', 'episodes', 'tracks', 'editResult'].includes(scenario);
  return <View style={{backgroundColor: theme.colors.ink, width: theme.isTV ? 1724 : 390, minHeight: theme.isTV ? 700 : 844, gap: 20}}>
    <SelectionText weight={700}>{fixture.scenarios[scenario]}</SelectionText>
    {['bar', 'queue', 'more', 'circles'].includes(scenario) ? <>
      <SelectionBar {...barProps} />
      <View style={{flexDirection: 'row', gap: 18, padding: 20, flexWrap: 'wrap'}}>{fixture.movieTitles.map((title, index) => <PosterCard key={title} title={title} width={theme.isTV ? 200 : 108} artwork={art(index)} density="grid"
        onNavigate={() => setLastAction('navigate')} onMore={() => setMenu('more')}
        selection={{active: selected.length > 0, selected: selected.includes(String(index)), onEnter: () => setSelected([String(index)]), onToggle: () => setSelected(current => current.includes(String(index)) ? current.filter(id => id !== String(index)) : [...current, String(index)])}} />)}</View>
      {scenario === 'circles' ? <View style={{flexDirection: 'row', gap: 24, padding: 20}}>{[false, true].map(value => <SelectionCircle key={String(value)} selecting selected={value} accessibilityLabel={fixture.movieTitles[value ? 1 : 0]} onSelectedChange={next => setSelected(next ? ['0'] : [])} />)}</View> : null}
      <SelectionPhoneActionBar {...barProps} />
    </> : null}
    {!open && !pickerResult ? <Button size="compact" onPress={() => setOpen(true)}>{fixture.scenarios[scenario]}</Button> : null}
    {lastAction ? <SelectionText>{formatMessage(fixture.lastAction, {action: lastAction}, {locale: 'en-US'})}</SelectionText> : null}
    {isPicker ? React.createElement(collection ? CollectionPicker : PlaylistPicker, {
      ...base, count: pickerCount, selectionLabel: theme.isTV ? fixture.tvSelectionLabel : fixture.selectionLabel, entries: entries.filter(entry => entry.title.toLowerCase().includes(query.toLowerCase())), query, onQueryChange: setQuery, showFind: true,
      creating, onCreatingChange: setCreating, name, onNameChange: setName, onLoadMore: () => setQuery(''),
      onCreateAndAdd: title => {setPickerResult({destination: {...destination, title}, outcomes: outcomes.map(row => ({...row, ok: true}))});setOpen(false);setSelected([]);},
      onAdd: id => {setPickerResult({destination: entries.find(entry => entry.id === id)!, outcomes: outcomes.map(row => ({...row, ok: true}))});setOpen(false);setSelected([]);},
      result: suppliedResult, onRetry: ids => {setPickerResult({destination: suppliedResult!.destination, outcomes: suppliedResult!.outcomes.map(row => ids.includes(row.id) ? {...row, ok: true} : row)});setOpen(false);setSelected([]);},
      onViewDestination: () => {setPickerResult(undefined);setOpen(true);}, onResultDismiss: () => setPickerResult(undefined),
    }) : null}
    {isEditor ? <BulkEditor {...base} title={scenario === 'episodes' ? fixture.episodeTitle : scenario === 'tracks' ? fixture.trackTitle : fixture.editTitle} count={4} saveLabel={fixture.saveTitle}
      schema={schemas.filter(field => scenario === 'episodes' ? ['contentRating', 'year', 'metadataLanguage', 'tags', 'labels'].includes(field.field) : scenario === 'tracks' ? ['year', 'metadataLanguage', 'genres', 'tags', 'labels'].includes(field.field) : true)}
      fieldLabel={field => field.label} values={{contentRating: {shared: {kind: 'mixed', distinct: 2}}, studio: {shared: {kind: 'shared', value: fixture.values.studio}}, country: {shared: {kind: 'shared', value: fixture.values.country}}, year: {shared: {kind: 'mixed', distinct: 4}}, edition: {shared: {kind: 'shared', value: ''}}, metadataLanguage: {shared: {kind: 'shared', value: fixture.values.language}}, genres: {entries: fixture.genres.map((value, index) => ({value, count: index < 2 ? 4 : 3}))}, tags: {entries: [{value: fixture.tags[0], count: 3}]}, labels: {entries: []}}}
      changes={changes} onChangesChange={setChanges} lockEdited={lockEdited} onLockEditedChange={setLockEdited} onSave={() => setBulkResult(receipt())} result={bulkResult}
      resultEntries={fixture.movieTitles.map((title, index) => ({id: String(index), title, artwork: <Artwork source={art(index)} width={30} height={45} />}))}
      onRetry={ids => setBulkResult(current => current ? {...current, updated: 4, failed: 0, results: current.results.map(row => ids.includes(row.id) ? {...row, ok: true} : row)} : current)}
      singleItemFields={fixture.oneAtTime} summary={Object.keys(changes).map(id => ({id, text: id === 'contentRating' ? fixture.summaryRating : fixture.summaryTag}))} /> : null}
    {scenario === 'mixed' ? <MixedEditExplainer open={open} onOpenChange={close} total={4} description={fixture.mixedDescription} groups={fixture.groups.map((label, index) => ({kind: ['movie', 'episode', 'album', 'song'][index], label, count: 1, icon: (['i-film', 'i-tv', 'i-disk', 'i-music'] as const)[index]}))} onKeepOnly={kind => {setSelected([kind]);}} /> : null}
    {scenario.startsWith('delete') ? <DeleteMediaDialog {...base} owner selectionCount={scenario === 'deleteLimit' ? 240 : scenario === 'deleteOne' || scenario === 'deleteShow' || scenario === 'deleteBlocked' ? 1 : 4}
      preview={deletionPreview(scenario)} removeFiles={removeFiles} onRemoveFilesChange={setRemoveFiles} confirmation={confirmation} onConfirmationChange={setConfirmation}
      onDelete={() => setDeleteResult(deletionResult())} result={deleteResult} renderArtwork={id => <Artwork source={art(Number(id))} width={24} height={36} />} /> : null}
  </View>;
}
function receipt(): BulkReceipt {return {operationId: 'selection-gallery-edit', updated: 3, failed: 1, results: fixture.movieTitles.map((_title, index) => ({id: String(index), kind: 'item', ok: index !== 3, code: index === 3 ? 'metadata_conflict' : undefined}))};}
function deletionPreview(scenario: Scenario): DeletePreview {
  const single = scenario === 'deleteOne' || scenario === 'deleteBlocked' || scenario === 'deleteShow';
  return {revision: 1, confirmation: single ? scenario === 'deleteShow' ? fixture.showTitle : fixture.movieTitles[3] : '4', confirmationKind: single ? 'title' : 'count', totalFiles: scenario === 'deleteShow' ? 9 : single ? 1 : 4,
    totalBytes: 16800000000, totalBytesText: single ? '4.1 GB' : '16.8 GB', blocked: scenario === 'deleteBlocked' ? [fixture.films] : [],
    targets: (single ? [fixture.movieTitles[3]] : fixture.movieTitles).map((title, index) => ({itemId: String(index), title: scenario === 'deleteShow' ? fixture.showTitle : title, kind: scenario === 'deleteShow' ? 'show' : 'movie', libraryId: 'movies', libraryName: fixture.films, allowMediaDeletion: scenario !== 'deleteBlocked', titles: scenario === 'deleteShow' ? 9 : 1, bytes: 4100000000, files: [{assetId: String(index), path: '', bytes: 4100000000, present: true, shared: false}], dependents: [{kind: 'playlist', count: 2, description: ''}, {kind: 'collection', count: 1, description: ''}, {kind: 'progress', count: 3, description: ''}]}))};
}
function deletionResult(): DeleteResult {return {revision: 2, removed: 3, failed: 1, bytesDeleted: 12700000000, filesRetained: false, receipts: fixture.movieTitles.map((title, index) => ({itemId: String(index), title, removed: index !== 3, filesDeleted: index === 3 ? 0 : 1, filesKept: index === 3 ? 1 : 0, bytes: 4100000000, code: index === 3 ? 'file_not_removed' : ''}))};}
const galleries: readonly Gallery[] = (Object.keys(fixture.scenarios) as Scenario[]).map(scenario => ({id: `selection-${scenario}`, title: 'next.selection.native.gallery', platforms: ['circles', 'bar', 'queue', 'more', 'playlist', 'newPlaylist', 'partialPlaylist', 'collection'].includes(scenario) ? ['phone', 'tablet', 'tv'] : ['phone', 'tablet'], render: function GalleryExample() {return <OverlaysProvider><SelectionExample scenario={scenario} /></OverlaysProvider>;}}));
export default galleries;
