import {deletionAllowed, parseDeletePreview, parseDeleteResult, type DeletePreview, type DeleteResult} from '../../../../../packages/client-core/src/administration';
import {fetchBulkMetadataPreview, metadataPreviewTargets, type BulkMetadataPreview} from '../../../../../packages/client-core/src/home-selection';
import type {HomeApi} from '../../../../../packages/client-core/src/home';
import {validBulkEdit, validateBulkReceipt, type BulkEdit, type BulkReceipt} from '../../../../../packages/client-core/src/metadata-bulk';
import type {BulkChanges, BulkFieldValue, BulkResultView} from '../../kit/selection';
import {routePath} from '../../../../../packages/contracts/src/routes';
import type {CatalogueSelectionOptions} from '../../../../../packages/client-core/src/catalogue-selection';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';

const unavailable = (code = 'selection-admin-unavailable') => Object.assign(new Error(code), {code});
const cancelled = () => Object.assign(new Error('cancelled'), {name: 'AbortError', code: 'cancelled'});

/** Bulk metadata edit and media deletion for one explicit captured leaf selection.
 *
 * The preview is the server's own (schema, shared/mixed values, per-target expected
 * revisions, and the delete preview's files/disk/blocks). Only explicit changes are
 * sent, each chunk keeps its operation id and receipt through a retry, and the delete
 * body keeps its revision, confirmation and operation id across an uncertain answer.
 * The caller's Search/Saved lifetime is checked before and after every read and write,
 * and a preview whose viewer fence is not the captured one is refused. */
export type NativeBulkMediaSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'saving' | 'result' | 'uncertain' | 'error';
  preview?: BulkMetadataPreview;
  error?: string;
  lockEdited: boolean;
  changes: BulkChanges;
  receipts: readonly BulkReceipt[];
  result?: BulkResultView;
  singleItemFields: BulkMetadataPreview['singleItemFields'];
  values: Readonly<Record<string, BulkFieldValue>>;
  deletion?: Readonly<{phase: 'loading' | 'ready' | 'saving' | 'uncertain' | 'result' | 'error'; preview?: DeletePreview; error?: string;
    confirmation: string; removeFiles: boolean; result?: DeleteResult}>;
}>;

const fieldValue = (preview: BulkMetadataPreview): Readonly<Record<string, BulkFieldValue>> => Object.fromEntries(preview.schema.map(spec => {
  const field = preview.fields[spec.field];
  return [spec.field, field
    ? {state: field.state, distinctCount: field.distinctCount, ...(field.value !== undefined ? {value: field.value} : {}),
        values: field.values, entries: field.entries, truncated: field.truncated}
    : {state: 'mixed' as const, distinctCount: 0, values: [], entries: [], truncated: false}];
}));

export class NativeBulkMedia {
  private readonly options: CatalogueSelectionOptions & Readonly<{fence: string}>;
  private readonly entries: readonly ContentEntry[];
  private readonly targets: ReturnType<typeof metadataPreviewTargets>;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private state: NativeBulkMediaSnapshot = Object.freeze({phase: 'idle', lockEdited: true, changes: {}, receipts: [], singleItemFields: [], values: {}});
  private edits: {body: BulkEdit; receipt?: BulkReceipt}[] = [];
  private deleteBody?: Readonly<Record<string, unknown>>;
  private baseEdit?: Omit<BulkEdit, 'operationId' | 'targets'>;

  constructor(options: CatalogueSelectionOptions & Readonly<{fence: string}>, entries: readonly ContentEntry[]) {
    this.options = options;
    this.entries = Object.freeze([...entries]);
    if (!entries.length || entries.length > 200 || new Set(entries.map(entry => entry.id)).size !== entries.length
      || entries.some(entry => !entry.libraryId || !['movie', 'episode', 'song', 'audiobook_file'].includes(entry.kind))) throw unavailable();
    this.targets = metadataPreviewTargets(entries.map(entry => ({kind: entry.kind, id: entry.id, libraryId: entry.libraryId!})));
  }

  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  getSnapshot = () => this.state;
  private publish(patch: Partial<NativeBulkMediaSnapshot>): void {
    if (this.disposed) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  private assert(): void {
    if (this.disposed || this.options.signal.aborted || !this.options.isCurrent()) {
      if (!this.disposed) this.dispose();
      throw cancelled();
    }
  }
  private async api<T>(path: string, method: string, body: unknown): Promise<T> {
    this.assert();
    const value = await this.options.api.request<T>(path, method, body, this.options.signal);
    this.assert();
    return value;
  }

  openEditor = async (): Promise<void> => {
    this.publish({phase: 'loading', error: undefined, receipts: []});
    this.edits = [];
    try {
      const preview = await fetchBulkMetadataPreview(this.options.api as unknown as HomeApi, {targets: this.targets}, this.options.scope.serverId, this.options.signal);
      this.assert();
      if (preview.viewerFence !== this.options.fence) throw unavailable('metadata-authority-changed');
      this.publish({phase: 'ready', preview, values: fieldValue(preview), singleItemFields: preview.singleItemFields, lockEdited: true, changes: {}});
    } catch (error) {this.publish({phase: 'error', error: message(error)});}
  };
  setChanges = (changes: BulkChanges) => this.publish({changes});
  setLockEdited = (lockEdited: boolean) => this.publish({lockEdited});
  save = async (): Promise<void> => {
    const preview = this.state.preview, changes = this.state.changes;
    if (!preview || (this.state.phase !== 'ready' && this.state.phase !== 'uncertain')) return;
    if (!this.edits.length) {
      const fields: Record<string, {value?: string; values?: readonly string[]}> = {};
      const lists: Record<string, {add?: readonly string[]; remove?: readonly string[]}> = {};
      let genres: {add?: readonly string[]; remove?: readonly string[]} | undefined;
      for (const spec of preview.schema) {
        const change = changes[spec.field];
        if (!change) continue;
        if ('add' in change || 'remove' in change) {
          const list = {...('add' in change ? {add: change.add} : {}), ...('remove' in change ? {remove: change.remove} : {})};
          if (spec.field === 'genres') genres = list;
          else lists[spec.field] = list;
        } else if ('value' in change) fields[spec.field] = {value: change.value};
      }
      if (!Object.keys(fields).length && !Object.keys(lists).length && !genres) {this.publish({phase: 'result', result: {results: [], updated: 0, failed: 0}}); return;}
      for (let start = 0; start < preview.targets.length; start += 200) {
        this.assert();
        const operationId = await this.options.requestId();
        this.assert();
        const body: BulkEdit = {operationId, targets: preview.targets.slice(start, start + 200).map(({kind, id, expectedRevision}) => ({kind, id, expectedRevision})),
          ...(Object.keys(fields).length ? {fields} : {}), ...(Object.keys(lists).length ? {lists} : {}), ...(genres ? {genres} : {}), lockEdited: this.state.lockEdited};
        if (!validBulkEdit(body, preview.schema)) throw unavailable('invalid-bulk-edit');
        this.baseEdit = {...(Object.keys(fields).length ? {fields} : {}), ...(Object.keys(lists).length ? {lists} : {}), ...(genres ? {genres} : {}), lockEdited: this.state.lockEdited};
        this.edits.push({body});
      }
    }
    this.publish({phase: 'saving', error: undefined});
    try {
      const receipts: BulkReceipt[] = [...this.state.receipts];
      for (const edit of this.edits) {
        if (edit.receipt) continue;
        const raw = await this.api<unknown>(routePath('post_metadata_bulk'), 'POST', edit.body);
        edit.receipt = validateBulkReceipt(raw, edit.body);
        receipts.push(edit.receipt);
        this.publish({receipts});
      }
      this.publish({phase: 'result', result: bulkView(receipts)});
    } catch (error) {this.publish({phase: 'uncertain', error: message(error)});}
  };
  retry = async (failedIds: readonly string[]): Promise<void> => {
    const preview = this.state.preview;
    if (!preview) return;
    const latest = new Map<string, boolean>();
    for (const receipt of this.state.receipts) for (const row of receipt.results) latest.set(row.id, row.ok);
    const failed = new Set([...latest].filter(([, ok]) => !ok).map(([id]) => id));
    if (!failedIds.length || failedIds.some(id => !failed.has(id))) return;
    const targets = preview.targets.filter(target => failedIds.includes(target.id));
    if (!targets.length) return;
    this.edits = [];
    for (let start = 0; start < targets.length; start += 200) {
      const operationId = await this.options.requestId();
      if (!this.baseEdit) return;
      const body: BulkEdit = {...this.baseEdit, operationId, targets: targets.slice(start, start + 200).map(({kind, id, expectedRevision}) => ({kind, id, expectedRevision}))};
      if (!this.state.preview || !validBulkEdit(body, this.state.preview.schema)) return;
      this.edits.push({body});
    }
    this.publish({phase: 'saving', error: undefined});
    try {
      const receipts: BulkReceipt[] = [...this.state.receipts];
      for (const edit of this.edits) {
        const raw = await this.api<unknown>(routePath('post_metadata_bulk'), 'POST', edit.body);
        edit.receipt = validateBulkReceipt(raw, edit.body);
        receipts.push(edit.receipt);
        this.publish({receipts});
      }
      this.publish({phase: 'result', result: bulkView(receipts)});
    } catch (error) {this.publish({phase: 'uncertain', error: message(error)});}
  };

  openDelete = async (): Promise<void> => {
    this.deleteBody = undefined;
    this.publish({deletion: {phase: 'loading', confirmation: '', removeFiles: false}});
    try {
      const raw = await this.api<{protocolVersion: string; serverId: string; result: unknown}>(routePath('post_admin_media_delete_preview'), 'POST',
        {itemIds: this.entries.map(entry => entry.id)});
      const preview = parseDeletePreview(raw.result);
      this.assert();
      this.publish({deletion: {phase: 'ready', preview, confirmation: '', removeFiles: false}});
    } catch (error) {this.publish({deletion: {phase: 'error', confirmation: '', removeFiles: false, error: message(error)}});}
  };
  setDeletion = (patch: Partial<NonNullable<NativeBulkMediaSnapshot['deletion']>>) => {
    const deletion = this.state.deletion;
    if (!deletion) return;
    this.publish({deletion: {...deletion, ...patch}});
  };
  deleteNow = async (): Promise<void> => {
    const deletion = this.state.deletion, preview = deletion?.preview;
    if (!deletion || !preview || (deletion.phase !== 'ready' && deletion.phase !== 'uncertain')) return;
    if (!deletionAllowed(preview) || deletion.confirmation.trim() !== preview.confirmation) return;
    if (!this.deleteBody) {
      const operationId = await this.options.requestId();
      this.deleteBody = Object.freeze({itemIds: preview.targets.map(target => target.itemId), expectedRevision: preview.revision,
        confirmation: deletion.confirmation, deleteFiles: deletion.removeFiles, operationId});
    }
    this.setDeletion({phase: 'saving', error: undefined});
    try {
      const raw = await this.api<{protocolVersion: string; serverId: string; result: unknown}>(routePath('post_admin_media_delete'), 'POST', this.deleteBody);
      const result = parseDeleteResult(raw.result);
      this.setDeletion({phase: 'result', result});
    } catch (error) {this.setDeletion({phase: 'uncertain', error: message(error)});}
  };
  close = (): void => {
    this.deleteBody = undefined;
    this.publish({phase: 'idle', deletion: undefined, error: undefined, receipts: [], changes: {}, preview: undefined, result: undefined});
    this.edits = [];
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  };
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error ?? '');
function bulkView(receipts: readonly BulkReceipt[]): BulkResultView {
  const results = receipts.flatMap(receipt => receipt.results);
  return {results, updated: results.filter(row => row.ok).length, failed: results.filter(row => !row.ok).length};
}
