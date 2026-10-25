import React, {useLayoutEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativeShellRuntime} from '../../shell/runtime';
import {Button, TextField} from '../../kit/controls';
import {Dialog} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeLiveOwnerController} from './live-owner-controller';
import type {UploadPreview} from './live-owner-model';
import {liveDocumentPicker} from './live-document-picker';

type Picked = Readonly<{title: string; bytes: number}>;
type UploadInput = Readonly<{id: string; requestId: string; expectedRevision: number; name: string; playlist: string; guide: string; tunerCount: number}>;
type Opening = {
  readonly id: number;
  readonly abort: AbortController;
  phase: 'open' | 'checking' | 'saving' | 'closed';
  draft: UploadInput;
  revision: number;
  preview?: Readonly<{revision: number; value: UploadPreview}>;
  files: Readonly<{playlist?: Picked; guide?: Picked}>;
  reading?: 'playlist' | 'guide';
  error?: unknown;
};

const limit = 16 * 1024 * 1024;
const blank: UploadInput = Object.freeze({id: '', requestId: '', expectedRevision: 0, name: '', playlist: '', guide: '', tunerCount: 0});
const sizeLabel = (bytes: number) => bytes >= 1024 * 1024
  ? `${defaultI18n.number(Number((bytes / (1024 * 1024)).toFixed(1)))} MB`
  : `${defaultI18n.number(Math.max(1, Math.round(bytes / 1024)))} KB`;
/** Idempotency/source ids are not secrets; use the device crypto when present. */
const makeId = () => {
  const bytes = new Uint8Array(24), crypto = globalThis.crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
};
const emptyInput = (): UploadInput => Object.freeze({id: makeId(), requestId: makeId(), expectedRevision: 0, name: '', playlist: '', guide: '', tunerCount: 0});
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** live-owner.html 13b: an uploaded M3U plus an optional XMLTV guide. The same
 * direct live-source preview/save contracts the web uses; files stay in memory. */
export function UploadSourceSheet({controller, runtime, open, onOpenChange, onSaved}: {
  controller: NativeLiveOwnerController; runtime: NativeShellRuntime; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void;
}) {
  const theme = useTheme(), t = runtime.text.t;
  const [opening, setOpening] = useState<Opening>();
  const active = useRef<Opening>(), sequence = useRef(0), picker = useRef<AbortController>();
  const retire = (target: Opening) => {
    if (target.phase === 'closed') return;
    target.phase = 'closed';target.abort.abort();picker.current?.abort();
    // Uploaded text does not outlive the opening that collected it.
    target.draft = emptyInput();target.preview = undefined;target.files = {};target.reading = undefined;target.error = undefined;
  };
  useLayoutEffect(() => {
    if (open) {
      const next: Opening = {id: ++sequence.current, abort: new AbortController(), phase: 'open', draft: emptyInput(), revision: 0, files: {}};
      active.current = next;setOpening(next);
    }
    return () => {
      const target = active.current;
      if (!target) return;
      active.current = undefined;
      retire(target);
    };
  }, [open, controller]);
  const current = opening && active.current === opening && opening.phase !== 'closed' ? opening : undefined;
  const input = current?.draft ?? blank, files = current?.files ?? {}, preview = current?.preview, busy = current?.phase === 'checking' || current?.phase === 'saving', reading = current?.reading;
  const edit = (target: Opening, patch: Pick<Partial<UploadInput>, 'name' | 'tunerCount'>) => {
    if (active.current !== target || target.phase !== 'open' || target.reading || target.abort.signal.aborted) return;
    const next: Opening = {...target, draft: Object.freeze({...target.draft, ...patch, requestId: makeId()}), revision: target.revision + 1, preview: undefined, error: undefined};
    active.current = next;setOpening(next);
  };
  const choose = async (target: Opening, field: 'playlist' | 'guide') => {
    if (!liveDocumentPicker || active.current !== target || target.phase !== 'open' || target.reading || target.abort.signal.aborted) return;
    picker.current?.abort();
    const pickController = new AbortController();picker.current = pickController;
    const picking: Opening = {...target, reading: field, preview: undefined, error: undefined};
    active.current = picking;setOpening(picking);
    try {
      const picked = await liveDocumentPicker.pick(field, pickController.signal);
      if (!picked || active.current !== picking || picking.phase !== 'open' || picking.abort.signal.aborted || pickController.signal.aborted) return;
      const other = field === 'playlist' ? picking.draft.guide : picking.draft.playlist;
      if (byteLength(picked.data) + byteLength(other) > limit) throw new Error('The playlist and guide together must be no larger than 16 MB.');
      const draft = Object.freeze({...picking.draft, [field]: picked.data, requestId: makeId()});
      const next: Opening = {...picking, draft, revision: picking.revision + 1, reading: undefined, files: {...picking.files, [field]: {title: picked.title, bytes: picked.bytes}}};
      active.current = next;setOpening(next);
    } catch (failure) {
      if (active.current === picking && !pickController.signal.aborted) {
        const next: Opening = {...picking, reading: undefined, error: failure};active.current = next;setOpening(next);
      }
    } finally {
      if (picker.current === pickController) picker.current = undefined;
      if (active.current === picking) {
        const next: Opening = {...picking, reading: undefined};active.current = next;setOpening(next);
      }
    }
  };
  const check = async (target: Opening, renderedRevision: number) => {
    if (active.current !== target || target.phase !== 'open' || target.revision !== renderedRevision || !target.draft.name.trim() || !target.draft.playlist || target.abort.signal.aborted) return;
    const checking: Opening = {...target, phase: 'checking', preview: undefined, error: undefined};
    active.current = checking;setOpening(checking);
    const caller = {isCurrent: () => active.current === checking && checking.phase === 'checking' && !checking.abort.signal.aborted, signal: checking.abort.signal};
    try {
      const value = await controller.previewFiles(checking.draft, caller);
      if (active.current !== checking || checking.phase !== 'checking' || checking.abort.signal.aborted) return;
      const next: Opening = {...checking, phase: 'open', preview: {revision: checking.revision, value}};
      active.current = next;setOpening(next);
    } catch (failure) {
      if (active.current === checking && !checking.abort.signal.aborted) {
        const next: Opening = {...checking, phase: 'open', error: failure};active.current = next;setOpening(next);
      }
    }
  };
  const save = async (target: Opening, renderedRevision: number) => {
    if (active.current !== target || target.phase !== 'open' || target.revision !== renderedRevision || target.preview?.revision !== renderedRevision || target.abort.signal.aborted) return;
    const saving: Opening = {...target, phase: 'saving', error: undefined};
    active.current = saving;setOpening(saving);
    const caller = {isCurrent: () => active.current === saving && saving.phase === 'saving' && !saving.abort.signal.aborted, signal: saving.abort.signal};
    try {
      const saved = await controller.saveFiles(saving.draft, caller);
      if (active.current !== saving || saving.phase !== 'saving' || saving.abort.signal.aborted) return;
      if (saved) {onSaved();onOpenChange(false);}
      else {
        const next: Opening = {...saving, phase: 'open', error: controller.getSnapshot().error ?? new Error('save_live_source')};
        active.current = next;setOpening(next);
      }
    } catch (failure) {
      if (active.current === saving && !saving.abort.signal.aborted) {
        const next: Opening = {...saving, phase: 'open', error: failure};active.current = next;setOpening(next);
      }
    }
  };
  const fileRow = (field: 'playlist' | 'guide', label: string) => <View style={{gap: 6}}>
    <Text style={[shellType(13, 700), {color: theme.colors.textSecondary}]}>{t(label as Parameters<typeof t>[0])}</Text>
    <Button testID={`live-owner-upload-${field}`} variant="glass" icon="i-upload" loading={reading === field} disabled={busy || !!reading}
      onPress={() => {if (current) void choose(current, field);}}>{files[field]?.title ?? t('web.metadata.chooseImageFile')}</Button>
    {files[field] && <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{sizeLabel(files[field]!.bytes)}</Text>}
  </View>;
  return <Dialog open={open && !!current} onOpenChange={value => {if (!busy && !value) onOpenChange(false);}} title={t('web.liveTv.upload')} description={t('web.liveTv.uploadLede')}
    footer={<View style={{flexDirection: 'row', gap: 10}}>
      <Button variant="glass" disabled={busy} onPress={() => onOpenChange(false)}>{t('action.cancel')}</Button>
      <Button variant="primary" loading={busy} disabled={busy || !!reading || !input.name.trim() || !input.playlist}
        onPress={() => {if (current) {if (preview) void save(current, current.revision);else void check(current, current.revision);}}}>{t(preview ? 'web.liveTv.addSource' : 'web.liveTv.checkFiles')}</Button>
    </View>} testID="live-owner-upload">
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap: 16}}>
      <TextField testID="live-owner-upload-name" label={t('web.liveTv.sourceName')} value={input.name} maxLength={100} disabled={busy || !!reading} onChangeText={name => {if (current) edit(current, {name});}}/>
      {fileRow('playlist', 'web.liveTv.playlistFile')}
      {fileRow('guide', 'web.liveTv.guideFile')}
      <TextField testID="live-owner-upload-tuners" label={t('web.dvrSettings.tuners')} description={t('web.liveTv.tunersHelp')} keyboardType="number-pad"
        value={String(input.tunerCount)} disabled={busy || !!reading}
        onChangeText={value => {const count = Number(value);if (current && Number.isSafeInteger(count) && count >= 0 && count <= 64) edit(current, {tunerCount: count});}}/>
      {current && current.error !== undefined && <StateView testID="live-owner-upload-error" {...runtime.error(current.error, () => {if (active.current === current) {const next: Opening = {...current, error: undefined};active.current = next;setOpening(next);}})}/>}
      {preview && <View testID="live-owner-upload-preview" style={{backgroundColor: theme.colors.raisedHigh, borderRadius: 12, padding: 14, gap: 6}}>
        <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{[t('server.live.channelCount', {count: preview.value.channels}), t('server.live.programCount', {count: preview.value.programmes})].join(' · ')}</Text>
        {!!preview.value.names.length && <Text numberOfLines={3} style={[shellType(13), {color: theme.colors.textSecondary}]}>{preview.value.names.slice(0, 6).join(', ')}{preview.value.names.length > 6 ? '…' : ''}</Text>}
      </View>}
    </ScrollView>
  </Dialog>;
}
