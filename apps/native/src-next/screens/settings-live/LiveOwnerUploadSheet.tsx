import React, {useEffect, useRef, useState} from 'react';
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

const limit = 16 * 1024 * 1024;
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
const emptyInput = (): UploadInput => ({id: makeId(), requestId: makeId(), expectedRevision: 0, name: '', playlist: '', guide: '', tunerCount: 0});
const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** live-owner.html 13b: an uploaded M3U plus an optional XMLTV guide. The same
 * direct live-source preview/save contracts the web uses; files stay in memory. */
export function UploadSourceSheet({controller, runtime, open, onOpenChange, onSaved}: {
  controller: NativeLiveOwnerController; runtime: NativeShellRuntime; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void;
}) {
  const theme = useTheme(), t = runtime.text.t;
  const [input, setInput] = useState<UploadInput>(emptyInput);
  const inputRef = useRef(input);inputRef.current = input;
  const [preview, setPreview] = useState<UploadPreview>(), [files, setFiles] = useState<Readonly<{playlist?: Picked; guide?: Picked}>>({});
  const [busy, setBusy] = useState(false), [reading, setReading] = useState<'playlist' | 'guide'>(), [error, setError] = useState<unknown>();
  const picker = useRef<AbortController>(), openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!open) return;
    const fresh = emptyInput();inputRef.current = fresh;setInput(fresh);
    setPreview(undefined);setFiles({});setError(undefined);setBusy(false);setReading(undefined);
  }, [open]);
  useEffect(() => {if (!open) picker.current?.abort();}, [open]);
  useEffect(() => () => {picker.current?.abort();}, []);
  const update = (patch: Pick<Partial<UploadInput>, 'name' | 'tunerCount'>) => {
    if (busy) return;
    setPreview(undefined);setError(undefined);
    const next = {...inputRef.current, ...patch, requestId: makeId()};inputRef.current = next;setInput(next);
  };
  const choose = async (field: 'playlist' | 'guide') => {
    if (!liveDocumentPicker || busy || reading) return;
    picker.current?.abort();
    const pickerController = new AbortController();picker.current = pickerController;
    setReading(field);setError(undefined);setPreview(undefined);
    try {
      const picked = await liveDocumentPicker.pick(field, pickerController.signal);
      if (!picked || !openRef.current || pickerController.signal.aborted) return;
      const current = inputRef.current;
      const other = field === 'playlist' ? current.guide : current.playlist;
      if (byteLength(picked.data) + byteLength(other) > limit) throw new Error('The playlist and guide together must be no larger than 16 MB.');
      const next = {...current, [field]: picked.data, requestId: makeId()};inputRef.current = next;setInput(next);
      if (openRef.current) setFiles(value => ({...value, [field]: {title: picked.title, bytes: picked.bytes}}));
    } catch (failure) {
      if (!pickerController.signal.aborted) setError(failure);
    } finally {
      if (picker.current === pickerController) {picker.current = undefined;setReading(undefined);}
    }
  };
  const check = async () => {
    const current = inputRef.current;
    if (busy || reading || !current.name.trim() || !current.playlist) return;
    setBusy(true);setError(undefined);
    try {setPreview(await controller.previewFiles(current));}
    catch (failure) {setError(failure);}
    finally {setBusy(false);}
  };
  const save = async () => {
    const current = inputRef.current;
    if (!preview || busy || reading) return;
    setBusy(true);setError(undefined);
    try {
      const saved = await controller.saveFiles(current);
      if (saved) {onSaved();onOpenChange(false);}
      else setError(controller.getSnapshot().error ?? new Error('save_live_source'));
    } finally {setBusy(false);}
  };
  const fileRow = (field: 'playlist' | 'guide', label: string) => <View style={{gap: 6}}>
    <Text style={[shellType(13, 700), {color: theme.colors.textSecondary}]}>{t(label as Parameters<typeof t>[0])}</Text>
    <Button testID={`live-owner-upload-${field}`} variant="glass" icon="i-upload" loading={reading === field} disabled={busy || !!reading}
      onPress={() => void choose(field)}>{files[field]?.title ?? t('web.metadata.chooseImageFile')}</Button>
    {files[field] && <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{sizeLabel(files[field]!.bytes)}</Text>}
  </View>;
  return <Dialog open={open} onOpenChange={value => {if (!busy) onOpenChange(value);}} title={t('web.liveTv.upload')} description={t('web.liveTv.uploadLede')}
    footer={<View style={{flexDirection: 'row', gap: 10}}>
      <Button variant="glass" disabled={busy} onPress={() => onOpenChange(false)}>{t('action.cancel')}</Button>
      <Button variant="primary" loading={busy || !!reading} disabled={busy || !!reading || !input.name.trim() || !input.playlist}
        onPress={() => {if (preview) void save();else void check();}}>{t(preview ? 'web.liveTv.addSource' : 'web.liveTv.checkFiles')}</Button>
    </View>} testID="live-owner-upload">
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{gap: 16}}>
      <TextField testID="live-owner-upload-name" label={t('web.liveTv.sourceName')} value={input.name} maxLength={100} disabled={busy} onChangeText={name => update({name})}/>
      {fileRow('playlist', 'web.liveTv.playlistFile')}
      {fileRow('guide', 'web.liveTv.guideFile')}
      <TextField testID="live-owner-upload-tuners" label={t('web.dvrSettings.tuners')} description={t('web.liveTv.tunersHelp')} keyboardType="number-pad"
        value={String(input.tunerCount)} disabled={busy}
        onChangeText={value => {const count = Number(value);if (Number.isSafeInteger(count) && count >= 0 && count <= 64) update({tunerCount: count});}}/>
      {error !== undefined && <StateView testID="live-owner-upload-error" {...runtime.error(error, () => setError(undefined))}/>}
      {preview && <View testID="live-owner-upload-preview" style={{backgroundColor: theme.colors.raisedHigh, borderRadius: 12, padding: 14, gap: 6}}>
        <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{[t('server.live.channelCount', {count: preview.channels}), t('server.live.programCount', {count: preview.programmes})].join(' · ')}</Text>
        {!!preview.names.length && <Text numberOfLines={3} style={[shellType(13), {color: theme.colors.textSecondary}]}>{preview.names.slice(0, 6).join(', ')}{preview.names.length > 6 ? '…' : ''}</Text>}
      </View>}
    </ScrollView>
  </Dialog>;
}
