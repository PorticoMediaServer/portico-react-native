import type {ReactNode, RefObject} from 'react';
import type {View} from 'react-native';
import {sameFence} from '../../../../../packages/player-core/src';
import {readFileInfo, type DetailApi, type DetailProjection, type PersonalIntent} from '../../../../../packages/client-core/src/detail';
import {deletionAllowed, versionDeletionService, type VersionDeletePreview} from '../../../../../packages/client-core/src/administration';
import {SearchService} from '../../../../../packages/client-core/src/search';
import {canMergeTitles, findLibraryFile, mergeTitles, separateLibraryFile, SPLITTABLE_KINDS} from '../../../../../packages/client-core/src/title-identity';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {sameAuthority} from '../../shell/model';
import type {NativeScreenServices} from '../screen-services';
import type {NativeWatchCapture, NativeWatchMenuActions, NativeWatchMenuEntry, NativeVersionDestination} from './factory';
import {nativeFileInfoMergeGroups, type NativeFileInfo} from './file-info';

type FileOwner = Readonly<{info: NativeFileInfo; changed: () => Promise<void>}>;
export type NativeWatchOverlay = Readonly<{
  capture: NativeWatchCapture;
  phase: 'menu' | 'file-pending' | 'file-info' | 'split-pick' | 'split' | 'delete' | 'merge' | 'versions-pending' | 'versions';
  actions?: NativeWatchMenuActions;
  destination?: NativeVersionDestination;
  anchorRef?: RefObject<View | null>;
  /** The captured title's own live detail projection: real personal actions. */
  detail?: DetailProjection;
  content?: ReactNode;
  owner?: FileOwner;
  fileId?: string;
  preview?: VersionDeletePreview;
  operationId?: string;
  confirmation: string;
  busy: boolean;
  error?: unknown;
  candidates: readonly ContentEntry[];
  searchReady?: boolean;
  other?: ContentEntry;
  keep?: string;
}>;

const cancelled = () => Object.assign(new Error('watch_capture_ended'), {name: 'AbortError'});

/** The presenter borrows the real captured member. Closing it retires requests;
 * navigation, authority and output replacement retire the same owned lifetime. */
export class NativeWatchPresenters {
  private value?: NativeWatchOverlay;
  private listeners = new Set<() => void>();
  private requests = new Set<AbortController>();
  private off: (() => void)[];
  private searchService?: SearchService;
  private menuEntry?: NativeWatchMenuEntry;
  private menuOff?: () => void;
  private disposed = false;
  private readonly context: NativeShellBootstrapContext;
  private readonly common: NativeScreenServices;
  constructor(context: NativeShellBootstrapContext, common: NativeScreenServices) {
    this.context = context; this.common = common;
    this.off = [context.navigation.subscribe(this.invalidate), context.subscribeAuthority(this.invalidate), context.playback.subscribe(this.invalidate)];
  }
  getSnapshot = () => this.value;
  getMenuEntry = () => this.value?.phase === 'menu' ? this.value.capture.entry : undefined;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private emit() {for (const listener of [...this.listeners]) listener();}
  hostCurrent = (capture: NativeWatchCapture) => {
    const route = this.context.navigation.getSnapshot();
    return !this.disposed && this.context.current() && capture.current() && sameAuthority(capture.authority, this.context.authority())
      && sameAuthority(route.authority, capture.authority) && route.revision === capture.routeRevision;
  };
  current = (capture: NativeWatchCapture) => {
    const actual = this.context.playback.getSnapshot().fence;
    return this.hostCurrent(capture) && (capture.expectedFence ? sameFence(actual, capture.expectedFence) : !actual);
  };
  overlayCurrent = (value: NativeWatchOverlay) => value.phase === 'versions' && value.destination ? value.destination.isCurrent() : this.current(value.capture);
  private invalidate = () => {if (this.value && !this.overlayCurrent(this.value)) this.close();};
  private releaseMenuEntry = () => {this.menuOff?.(); this.menuOff = undefined; this.menuEntry?.dispose(); this.menuEntry = undefined;};
  private menuChanged = () => {
    const value = this.value, data = this.menuEntry?.current();
    if (!value || value.phase !== 'menu' || !data || data === value.detail || !this.current(value.capture)) return;
    this.replace({...value, detail: data});
  };
  close = () => {
    this.value?.destination?.dispose();
    this.releaseMenuEntry();
    for (const request of this.requests) request.abort(); this.requests.clear();
    this.searchService?.dispose(); this.searchService = undefined;
    if (this.value) {this.value = undefined; this.emit();}
  };
  closeMenu = (value: NativeWatchOverlay) => {if (this.value === value && value.phase === 'menu') this.close();};
  private patch(value: NativeWatchOverlay, change: Partial<NativeWatchOverlay>): NativeWatchOverlay | undefined {
    if (this.value !== value || !this.current(value.capture)) return;
    this.value = Object.freeze({...value, ...change}); this.emit(); return this.value;
  }
  private replace(value: NativeWatchOverlay) {this.value = Object.freeze(value); this.emit();}
  openMenu = (capture: NativeWatchCapture, actions: NativeWatchMenuActions, anchorRef?: RefObject<View | null>) => {
    this.close();
    if (!this.current(capture)) {actions.entry?.dispose(); return;}
    this.menuEntry = actions.entry;
    this.menuOff = actions.entry?.subscribe(this.menuChanged);
    const detail = actions.entry?.current();
    this.replace({capture, actions, anchorRef, phase: 'menu', confirmation: '', busy: false, candidates: [], ...(detail ? {detail} : {})});
  };
  playEntry = (value: NativeWatchOverlay) => {
    const entry = value.actions?.entry;
    if (!entry?.play || value.busy || !this.current(value.capture)) return;
    this.close();
    void entry.play().catch(error => {if (!this.disposed && this.context.current()) this.common.reportError(error, 'detail');});
  };
  personal = async (value: NativeWatchOverlay, intent: PersonalIntent) => {
    const entry = value.actions?.entry, live = this.value;
    if (!entry || live?.phase !== 'menu' || live.busy || live !== value) return;
    const pending = this.patch(value, {busy: true, error: undefined}); if (!pending) return;
    try {await entry.mutate(intent);}
    catch (error) {if (this.value === pending && this.current(value.capture)) this.common.reportError(error, 'detail');}
    finally {if (this.value === pending) this.patch(pending, {busy: false});}
  };
  showDetails = (value: NativeWatchOverlay) => {
    const entry = value.actions?.entry;
    if (!entry?.details || value.busy || !this.current(value.capture)) return;
    this.close(); entry.details();
  };
  differentVersion = async (value: NativeWatchOverlay) => {
    if (!value.actions?.differentVersion || !this.patch(value, {phase: 'versions-pending', busy: true})) return;
    this.releaseMenuEntry();
    try {await value.actions.differentVersion();}
    catch (error) {if (this.value?.capture === value.capture && this.current(value.capture)) this.common.reportError(error, 'detail');}
    finally {if (this.value?.capture === value.capture && this.value.phase === 'versions-pending') this.close();}
  };
  openVersions = (capture: NativeWatchCapture, destination: NativeVersionDestination) => {
    if (!this.current(capture) || !destination.isCurrent() || this.value && (this.value.capture !== capture || this.value.phase !== 'versions-pending')) {destination.dispose(); return;}
    // A genuine playback-failure action can enter without a More menu. Its
    // descriptor already checked the actual failed session/version identity.
    this.replace({confirmation: '', candidates: [], ...this.value, capture, phase: 'versions', destination, busy: false});
  };
  chooseVersion = async (versionId: string) => {
    const value = this.value, destination = value?.destination;
    if (value?.phase !== 'versions' || !destination || value.busy || !destination.isCurrent() || !destination.rows.some(row => row.id === versionId)) return;
    this.replace({...value, busy: true});
    try {await destination.choose(versionId); if (this.value?.destination === destination) this.close();}
    catch (error) {
      if (this.value?.destination === destination) {
        if (!destination.isCurrent()) this.close();
        else {this.replace({...this.value, busy: false}); this.common.reportError(error, 'detail');}
      }
    }
  };
  fileInfo = async (value: NativeWatchOverlay) => {
    if (!value.actions || !this.patch(value, {phase: 'file-pending', busy: true})) return;
    this.releaseMenuEntry();
    try {await value.actions.fileInfo();}
    catch (error) {if (this.value?.capture === value.capture && this.current(value.capture)) {this.close(); this.common.reportError(error, 'detail');}}
  };
  openFileInfo = (capture: NativeWatchCapture, content: ReactNode, owner: FileOwner) => {
    if (!this.current(capture) || this.value?.capture !== capture || this.value.phase !== 'file-pending') return;
    this.replace({...this.value, phase: 'file-info', content, owner, busy: false});
  };
  private async run(value: NativeWatchOverlay, action: (api: DetailApi, signal: AbortSignal, check: () => void) => Promise<void>) {
    const pending = this.patch(value, {busy: true, error: undefined}); if (!pending) return;
    const request = new AbortController(); this.requests.add(request);
    const current = () => !request.signal.aborted && this.value === pending && this.current(pending.capture);
    const check = () => {if (!current()) throw cancelled();};
    // This is the same authenticated API, with the presenter lifetime carried
    // into every request and checked after response parsing, before mutation.
    const api = {request: async <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
      check(); if (signal?.aborted) throw cancelled();
      const result = await this.context.api.request<T>(path, method, body, request.signal); check(); return result;
    }};
    try {await action(api, request.signal, check);}
    catch (error) {if (current()) this.patch(pending, {busy: false, error});}
    finally {this.requests.delete(request);}
  }
  private async validateOwner(value: NativeWatchOverlay, api: Pick<NativeShellBootstrapContext['api'], 'request'>, signal: AbortSignal, action: 'delete' | 'split' | 'merge') {
    const info = value.owner?.info, entry = value.capture.entry;
    if (!info || !entry.libraryId || !info.manage?.[action] || info.scope.itemId !== entry.id || info.scope.libraryId !== entry.libraryId) throw cancelled();
    const viewer = this.context.session()?.viewer;
    if (!viewer) throw cancelled();
    const fresh = await readFileInfo(api, {serverId: viewer.serverId, viewerId: JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId])}, {libraryId: entry.libraryId, itemId: entry.id}, {limit: 1}, signal);
    if (!fresh.manage?.[action]) throw Object.assign(new Error('file_management_forbidden'), {code: 'forbidden'});
    if (fresh.scope.viewerFence !== info.scope.viewerFence || fresh.revision.catalog !== info.revision.catalog || fresh.revision.viewer !== info.revision.viewer) throw Object.assign(new Error('file_info_changed'), {code: 'revision_conflict'});
  }
  manageFile = (capture: NativeWatchCapture, action: 'delete-version' | 'split-versions' | 'merge-title', fileId?: string) => {
    const value = this.value, info = value?.owner?.info;
    if (!value || value.capture !== capture || value.phase !== 'file-info' || !info || !this.current(capture)) return;
    if (action === 'delete-version' && info.manage?.delete && fileId && info.locations?.some(file => file.id === fileId && file.actions.some(offered => offered.id === action))) {
      const next = this.patch(value, {phase: 'delete', fileId, confirmation: '', error: undefined, preview: undefined, operationId: undefined});
      if (next) void this.previewDelete(next);
    } else if (action === 'split-versions' && info.model.owner?.actions.some(offered => offered.id === action) && SPLITTABLE_KINDS.includes(info.kind)) {
      this.patch(value, {phase: 'split-pick', fileId: undefined, error: undefined});
    } else if (action === 'merge-title' && info.manage?.merge && nativeFileInfoMergeGroups[capture.entry.kind]) {
      this.patch(value, {phase: 'merge', other: undefined, keep: capture.entry.id, candidates: [], error: undefined});
    }
  };
  backToInfo = () => {const value = this.value; if (value && !value.busy && value.owner) {
    this.searchService?.dispose(); this.searchService = undefined;
    this.patch(value, {phase: 'file-info', error: undefined});
  }};
  chooseSplit = (fileId: string) => {
    const value = this.value, files = value?.owner?.info.files;
    if (value?.phase === 'split-pick' && files && files.length > 1 && files.some(file => file.id === fileId && file.available) && value.owner?.info.groups.some(group => group.members.length === 1 && group.members[0]?.id === fileId)) this.patch(value, {phase: 'split', fileId, error: undefined});
  };
  split = async () => {
    const value = this.value, entry = value?.capture.entry;
    if (value?.phase !== 'split' || !value.fileId || !entry?.libraryId || value.busy) return;
    await this.run(value, async (api, signal, check) => {
      await this.validateOwner(value, api, signal, 'split');
      const record = await findLibraryFile(api, entry.libraryId!, value.fileId!, {signal});
      if (!record) throw Object.assign(new Error('file_not_listed'), {code: 'file_not_listed'});
      await separateLibraryFile(api, entry.libraryId!, record);
      await value.owner!.changed(); check(); this.close();
    });
  };
  previewDelete = async (value = this.value) => {
    if (!value || value.phase !== 'delete' || !value.fileId || value.busy) return;
    await this.run(value, async (api, signal, check) => {
      await this.validateOwner(value, api, signal, 'delete');
      const preview = await versionDeletionService(api.request).preview(value.capture.entry.id, value.fileId!);
      const operationId = value.operationId ?? await this.common.requestId();
      const pending = this.value;
      if (pending?.capture === value.capture && this.current(value.capture)) this.patch(pending, {preview, operationId, busy: false});
    });
  };
  confirmation = (confirmation: string) => {const value = this.value; if (value?.phase === 'delete' && !value.busy) this.patch(value, {confirmation});};
  deleteVersion = async () => {
    const value = this.value;
    if (value?.phase !== 'delete' || !value.preview || !value.operationId || value.busy || !deletionAllowed(value.preview) || value.confirmation.trim() !== value.preview.confirmation) return;
    await this.run(value, async (api, signal, check) => {
      await this.validateOwner(value, api, signal, 'delete');
      const result = await versionDeletionService(api.request).remove(value.preview!, value.confirmation.trim(), value.operationId!);
      const kept = result.receipts.find(receipt => !receipt.removed);
      if (kept) throw Object.assign(new Error('file_not_removed'), {code: kept.code === 'file_changed' ? 'file_changed' : 'file_not_removed'});
      await value.owner!.changed(); check(); this.close();
    });
  };
  search = async (words: string) => {
    const value = this.value, viewer = this.context.session()?.viewer, group = value && nativeFileInfoMergeGroups[value.capture.entry.kind];
    if (value?.phase !== 'merge' || !viewer || !group || value.busy || !this.current(value.capture)) return;
    if (!this.searchService) this.searchService = new SearchService({api: this.context.api, scope: {serverId: viewer.serverId, viewerId: JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId])}, pageSize: 12});
    const service = this.searchService;
    if (!words.trim()) {service.cancel(); this.patch(value, {candidates: [], searchReady: false, error: undefined}); return;}
    const pending = this.patch(value, {error: undefined, other: undefined, searchReady: false}); if (!pending) return;
    try {
      await service.select(words.trim(), {group, libraryIds: [value.capture.entry.libraryId!], record: false});
      if (this.searchService !== service || this.value !== pending || !this.current(value.capture)) return;
      const snapshot = service.getSnapshot();
      if (snapshot.error) throw snapshot.error;
      const candidates = snapshot.groups.flatMap(result => result.items).filter((entry): entry is ContentEntry => entry.kind !== 'person' && entry.kind !== 'channel')
        .filter(entry => canMergeTitles(value.capture.entry, entry));
      this.patch(pending, {candidates, searchReady: true});
    } catch (error) {if (this.value === pending) this.patch(pending, {error});}
  };
  chooseMerge = (other: ContentEntry) => {const value = this.value; if (value?.phase === 'merge' && value.candidates.includes(other)) this.patch(value, {other, keep: value.capture.entry.id});};
  keep = (id: string) => {const value = this.value; if (value?.phase === 'merge' && !value.busy && [value.capture.entry.id, value.other?.id].includes(id)) this.patch(value, {keep: id});};
  merge = async () => {
    const value = this.value, other = value?.other;
    if (value?.phase !== 'merge' || !other || value.busy || !canMergeTitles(value.capture.entry, other)) return;
    const from = value.keep === other.id ? value.capture.entry : other, into = value.keep === other.id ? other : value.capture.entry;
    await this.run(value, async (api, signal, check) => {
      await this.validateOwner(value, api, signal, 'merge');
      await mergeTitles(api, from.id, into.id);
      await value.owner!.changed(); check(); this.close();
      if (into === other) this.common.navigate(other);
    });
  };
  dispose = () => {if (this.disposed) return; this.close(); this.disposed = true; for (const off of this.off) off(); this.off = []; this.listeners.clear();};
}
