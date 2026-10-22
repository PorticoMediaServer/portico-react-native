import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import type {Gallery} from '../../gallery-registry';
import {selectionNativeFixtures as fixture} from '../../../../../../packages/i18n/src/catalog/en-US/next/dev/selection-native-fixtures';
import {defaultI18n, formatMessage} from '../../../../../../packages/i18n/src/index';
import type {DeletePreview, DeleteResult} from '../../../../../../packages/client-core/src/administration';
import type {RepairFieldSpec} from '../../../../../../packages/client-core/src/metadata-repair';
import type {BulkReceipt} from '../../../../../../packages/client-core/src/metadata-bulk';
import {CoverMosaic, Artwork, type ArtworkSource} from '../../../kit/artwork/index';
import {PosterCard} from '../../../kit/cards/index';
import {Button} from '../../../kit/controls/Button';
import {OverlaysProvider} from '../../../kit/overlays/index';
import {OwnerTag} from '../../../kit/shell/index';
import {SelectionCircle, SelectionBar, SelectionPhoneActionBar, BulkEditor, PlaylistPicker, CollectionPicker, DeleteMediaDialog, MixedEditExplainer, bulkReceiptView, type BulkChanges, type BulkEditorProps, type DeleteMediaDialogProps, type DestinationPickerProps, type PickerEntry, type PickerResult, type SelectionAction, type SelectionActionOffer} from '../../../kit/selection/index';
import {SelectionText} from '../../../kit/selection/surface';
import {useTheme} from '../../../kit/theme';
import {referenceFields, referenceSingleItemFields} from './reference-fields';

// Static reference observations are DEV-only. Mutations require genuine supplied evidence.
type SelectionGallerySnapshot = Readonly<{picker?: DestinationPickerProps; editor?: BulkEditorProps; deletion?: DeleteMediaDialogProps}>;
type SelectionGalleryEvidence = {getSnapshot: () => SelectionGallerySnapshot; subscribe: (changed: () => void) => () => void};
declare global {var __porticoNativeSelectionEvidence: SelectionGalleryEvidence | undefined;}
function requireSelectionEvidence(): never {
  throw new Error('Selection gallery mutations require complete props from the actual fenced controller evidence adapter.');
}
const reference = 'http://100.120.50.24:8787/assets/pool/movies/';
const art = (index: number): ArtworkSource => ({uri: `${reference}${['toy-story.jpg', 'toy-story-2.jpg', 'toy-story-3.jpg', 'toy-story-5.jpg'][index]}`, cacheKey: `selection-reference-${index}`});
const schemas: readonly RepairFieldSpec[] = [
  {field: 'contentRating', label: fixture.fields.contentRating, group: 'general', type: 'text', bulk: true},
  {field: 'studio', label: fixture.fields.studio, group: 'general', type: 'text', bulk: true},
  {field: 'network', label: fixture.fields.network, group: 'general', type: 'text', bulk: true},
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
function SelectionExample({scenario, deniedDestination = false}: {scenario: Scenario; deniedDestination?: boolean}) {
  const theme = useTheme();
  const [evidence, setEvidence] = useState(() => globalThis.__porticoNativeSelectionEvidence?.getSnapshot());
  useEffect(() => {
    const source = globalThis.__porticoNativeSelectionEvidence;
    if (!source) return;
    const update = () => setEvidence(source.getSnapshot());
    const unsubscribe = source.subscribe(update);
    update();
    return unsubscribe;
  }, []);
  const [selected, setSelected] = useState<readonly string[]>(scenario === 'circles' ? [] : theme.isTV ? ['0', '1', '2'] : ['0', '1', '2', '3']);
  const [menu, setMenu] = useState<'queue' | 'watched' | 'more' | null>(scenario === 'queue' ? 'queue' : scenario === 'more' ? 'more' : null);
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(scenario === 'newPlaylist');
  const [name, setName] = useState(scenario === 'newPlaylist' ? fixture.newName : '');
  const [query, setQuery] = useState('');
  const [lastAction, setLastAction] = useState<SelectionAction | 'navigate'>();
  const [changes, setChanges] = useState<BulkChanges>(scenario === 'episodes' ? {metadataLanguage: {value: fixture.values.language}} : scenario === 'tracks' ? {year: {value: String(2020)}} : {contentRating: {value: fixture.values.rating}, tags: {add: [fixture.tags[1]], remove: []}});
  const [lockEdited, setLockEdited] = useState(true);
  const [bulkReceipts] = useState<readonly BulkReceipt[]>(scenario === 'editResult' ? [receipt()] : []);
  const [removeFiles, setRemoveFiles] = useState(scenario !== 'deleteOff');
  const [confirmation, setConfirmation] = useState(scenario === 'deleteSeveral' || scenario === 'deleteOff' ? '4' : '');
  const [deleteResult] = useState<DeleteResult | undefined>(scenario === 'deleteResult' ? deletionResult() : undefined);
  const [pickerResult, setPickerResult] = useState<PickerResult>();
  const [page, setPage] = useState(0);
  const size = theme.isTV ? 76 : 48;
  const collection = scenario === 'collection';
  const entries: PickerEntry[] = (collection ? fixture.collections : fixture.playlists).map((title, index) => ({id: String(index), title, size: [12, 6, 9][index], canAdd: !deniedDestination || index !== 1, ...(index === 0 ? {alreadyIn: 2} : {}),
    artwork: <CoverMosaic covers={[art(index), art((index + 1) % 4), art((index + 2) % 4), art((index + 3) % 4)]} shape="square" width={size} height={size} />}));
  const pickerCount = theme.isTV ? 3 : 4;
  const destination = entries[0];
  const referenceFailure = {id: String(pickerCount - 1), title: fixture.movieTitles[pickerCount - 1], reason: fixture.failedAdd};
  const suppliedResult: PickerResult | undefined = pickerResult ?? (scenario === 'partialPlaylist' && destination ? {destination, inserted: pickerCount - 1, failed: 1, total: pickerCount, failures: [referenceFailure], complete: true} : undefined);
  // Bounded in-memory reference directory, not the current-page search or a server receipt.
  const matching = entries.filter(entry => entry.title.toLocaleLowerCase('en-US').includes(query.toLocaleLowerCase('en-US')));
  const windowStart = page * 2, windowEntries = matching.slice(windowStart, windowStart + 2);
  const bulkResult = bulkReceipts.length ? bulkReceiptView(bulkReceipts) : undefined;
  const close = (next: boolean) => setOpen(next);
  const onAction = (action: SelectionAction) => {setLastAction(action);};
  const barProps = {count: selected.length, subtitle: fixture.films, selectAllLabel: fixture.selectAll, onSelectAll: () => setSelected(['0', '1', '2', '3']), onCancel: () => setSelected([]), actions, onAction, menu, onMenuChange: setMenu, ownerTag: <OwnerTag compact variant="badge" />};
  const base = {open, onOpenChange: close, ownerHeader: <View style={{paddingHorizontal: 20, paddingTop: 8}}><OwnerTag compact /></View>};
  const isPicker = ['playlist', 'newPlaylist', 'partialPlaylist', 'collection'].includes(scenario);
  const isEditor = ['editor', 'episodes', 'tracks', 'editResult'].includes(scenario);
  const editorKind = scenario === 'episodes' ? 'episode' : scenario === 'tracks' ? 'song' : 'movie';
  const editorCount = editorKind === 'episode' ? 3 : 4;
  const editorSchema = schemas.filter(field => editorKind === 'episode' ? ['contentRating', 'network', 'year', 'metadataLanguage', 'tags', 'labels'].includes(field.field) : editorKind === 'song' ? ['year', 'metadataLanguage', 'genres', 'tags', 'labels'].includes(field.field) : field.field !== 'network');
  const t = defaultI18n.t;
  const summary = Object.entries(changes).flatMap(([id, change]) => {
    const field = editorSchema.find(value => value.field === id);
    if (!field) return [];
    if ('value' in change) return [{id, text: t('next.selection.scalarChange', {field: field.label, value: change.value, count: editorCount})}];
    const list = new Intl.ListFormat('en-US', {style: 'long', type: 'conjunction'});
    return [
      ...(change.add.length ? [{id: `${id}-add`, text: t('next.selection.listAdd', {field: field.label, values: list.format(change.add), count: editorCount})}] : []),
      ...(change.remove.length ? [{id: `${id}-remove`, text: t('next.selection.listRemove', {field: field.label, values: list.format(change.remove), count: editorCount})}] : []),
    ];
  });
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
      ...base, count: pickerCount, selectionLabel: theme.isTV ? fixture.tvSelectionLabel : fixture.selectionLabel, entries: windowEntries, query, onQueryChange: value => {setQuery(value); setPage(0);}, showFind: true,
      creating, onCreatingChange: setCreating, name, onNameChange: setName,
      hasNext: windowStart + windowEntries.length < matching.length, hasPrevious: page > 0,
      onNext: windowStart + windowEntries.length < matching.length ? () => setPage(current => current + 1) : undefined,
      onPrevious: page > 0 ? () => setPage(current => current - 1) : undefined,
      onCreateAndAdd: requireSelectionEvidence, onAdd: requireSelectionEvidence,
      result: suppliedResult, onRetry: requireSelectionEvidence,
      onViewDestination: () => {setPickerResult(undefined);setOpen(true);}, onResultDismiss: () => setPickerResult(undefined),
      ...evidence?.picker,
    }) : null}
    {isEditor ? <BulkEditor {...base} title={scenario === 'episodes' ? fixture.episodeTitle : scenario === 'tracks' ? fixture.trackTitle : fixture.editTitle} count={editorCount} saveLabel={t('next.selection.save', {items: t(editorKind === 'episode' ? 'next.selection.episode' : editorKind === 'song' ? 'next.selection.track' : 'next.selection.movie', {count: editorCount})})}
      schema={editorSchema}
      fieldLabel={field => field.label} values={referenceFields(editorKind)}
      changes={changes} onChangesChange={setChanges} lockEdited={lockEdited} onLockEditedChange={setLockEdited} onSave={requireSelectionEvidence} result={bulkResult}
      resultEntries={fixture.movieTitles.map((title, index) => ({id: String(index), title, artwork: <Artwork source={art(index)} width={30} height={45} />}))}
      onRetry={requireSelectionEvidence}
      singleItemFields={referenceSingleItemFields(editorKind)} summary={summary} {...evidence?.editor} /> : null}
    {scenario === 'mixed' ? <MixedEditExplainer open={open} onOpenChange={close} total={4} description={fixture.mixedDescription} groups={fixture.groups.map((label, index) => ({kind: ['movie', 'episode', 'album', 'song'][index], label, count: 1, icon: (['i-film', 'i-tv', 'i-disk', 'i-music'] as const)[index]}))} onKeepOnly={kind => {setSelected([kind]);}} /> : null}
    {scenario.startsWith('delete') ? <DeleteMediaDialog {...base} owner selectionCount={scenario === 'deleteLimit' ? 240 : scenario === 'deleteOne' || scenario === 'deleteShow' || scenario === 'deleteBlocked' ? 1 : 4}
      preview={deletionPreview(scenario)} removeFiles={removeFiles} onRemoveFilesChange={setRemoveFiles} confirmation={confirmation} onConfirmationChange={setConfirmation}
      onDelete={requireSelectionEvidence} result={deleteResult} renderArtwork={id => <Artwork source={art(Number(id))} width={24} height={36} />} {...evidence?.deletion} /> : null}
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
const galleries: readonly Gallery[] = [
  ...(Object.keys(fixture.scenarios) as Scenario[]).map((scenario): Gallery => ({id: `selection-${scenario}`, title: 'next.selection.native.gallery', platforms: ['circles', 'bar', 'queue', 'more', 'playlist', 'newPlaylist', 'partialPlaylist', 'collection'].includes(scenario) ? ['phone', 'tablet', 'tv'] : ['phone', 'tablet'], render: function GalleryExample() {return <OverlaysProvider><SelectionExample scenario={scenario} /></OverlaysProvider>;}})),
  {id: 'selection-picker-admission', title: 'next.selection.native.gallery', platforms: ['phone', 'tablet', 'tv'], render: function PickerAdmission() {return <OverlaysProvider><SelectionExample scenario="playlist" deniedDestination /></OverlaysProvider>;}},
];
export default galleries;
