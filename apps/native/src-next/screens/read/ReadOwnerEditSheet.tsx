import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {MetadataRepairService, type RepairData} from '../../../../../packages/client-core/src/metadata-repair';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button, TextField} from '../../kit/controls';
import {BottomSheet} from '../../kit/overlays';
import {SkeletonBlock, StateView} from '../../kit/states';
import {browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import {linkNativeAbortSignals} from '../../platform/abort-signals';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeReadOwnerEditLease} from './read-book-model';

const {t} = defaultI18n;
const cancelled = () => Object.assign(new Error('cancelled'), {name: 'AbortError', code: 'cancelled'});
const sourceLabel = (source: string | undefined): string | undefined =>
  !source || source === 'automatic' ? undefined
    : source === 'file-metadata' ? t('next.reader.sourceFileMetadata')
      : source === 'file-name' ? t('next.reader.sourceFileName')
        : source === 'folder' ? t('next.reader.sourceFolder')
          : source === 'owner' || source === 'manual' ? t('next.reader.sourceOwner')
            : t('web.metadata.fromSource', {source});

/** phone-read 3b: the owner's Reading edit sheet over the single-item repair
 * producer. It is bound to the committed book page it was opened from: every
 * request is scoped to that route/revision, session family and authority, and
 * the sheet retires with its page or its own close. */
export function ReadOwnerEditSheet({context, lease, owner, itemId, libraryId, onClose}: Readonly<{
  context: NativeShellBootstrapContext; lease: NativeReadOwnerEditLease; owner: object;
  itemId: string; libraryId: string; onClose: (owner: object) => void;
}>) {
  const theme = useTheme();
  const sheetLife = useRef<AbortController>(new AbortController()).current;
  const linked = useMemo(() => linkNativeAbortSignals([lease.signal, sheetLife.signal]), [lease, sheetLife]);
  const owned = useMemo(() => () => !linked.signal.aborted && lease.isCurrent(), [lease, linked]);
  const api = useMemo(() => ({
    request: async <T,>(path: string, method?: string, body?: unknown, callerSignal?: AbortSignal): Promise<T> => {
      if (!owned()) throw cancelled();
      const operation = linkNativeAbortSignals([linked.signal, callerSignal]);
      try {
        const result = await context.api.request<T>(path, method, body, operation.signal);
        if (!owned()) throw cancelled();
        return result;
      } finally {operation.dispose();}
    },
    requestMetadataUpload: async <T,>(path: string, body: FormData, callerSignal?: AbortSignal): Promise<T> => {
      if (!owned()) throw cancelled();
      const operation = linkNativeAbortSignals([linked.signal, callerSignal]);
      try {
        const result = await context.api.requestMetadataUpload<T>(path, body, operation.signal);
        if (!owned()) throw cancelled();
        return result;
      } finally {operation.dispose();}
    },
  }), [context, linked, owned]);
  const service = useMemo(() => new MetadataRepairService({api,
    scope: {serverId: lease.viewer.serverId, viewerId: JSON.stringify([lease.viewer.authority, lease.viewer.accountId, lease.viewer.profileId])}}),
  [api, lease.viewer.serverId, lease.viewer.authority, lease.viewer.accountId, lease.viewer.profileId]);
  const [snapshot, setSnapshot] = useState(service.getSnapshot());
  const [draft, setDraft] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const loaded = useRef<RepairData | undefined>(undefined), saving = useRef<object | undefined>(undefined), retired = useRef(false);
  // Each opening is its own keyed instance: its owner ticket and close callback
  // are captured once and never follow a successor.
  const opening = useRef<Readonly<{owner: object; onClose: (owner: object) => void}>>();
  if (!opening.current) opening.current = Object.freeze({owner, onClose});
  const close = () => {if (!retired.current) {retired.current = true; sheetLife.abort(); opening.current!.onClose(opening.current!.owner);}};
  useLayoutEffect(() => {
    if (!owned()) {close(); return;}
    // The original page leaving its route or authority retires this sheet and
    // its in-flight repair immediately; Back never revives it.
    const retire = () => {if (!retired.current && !lease.isCurrent()) close();};
    const offNav = context.navigation.subscribe(retire), offAuthority = context.subscribeAuthority(retire), offModel = lease.subscribe(retire);
    const off = service.subscribe(() => {
      const next = service.getSnapshot();
      setSnapshot(next);
      // Only an owned successful load resets the draft; saving/conflict events
      // never clear what the owner is typing.
      if (next.phase === 'ready' && next.data && next.data !== loaded.current && owned() && !retired.current) {
        loaded.current = next.data; setDraft({});
      }
    });
    void service.load({kind: 'item', id: itemId, libraryId});
    return () => {offNav(); offAuthority(); offModel(); off(); retired.current = true; sheetLife.abort(); linked.dispose(); service.dispose();};
  }, [context, service, itemId, libraryId, owned, sheetLife, linked, lease]); // eslint-disable-line react-hooks/exhaustive-deps
  const data: RepairData | null | undefined = snapshot.data;
  const exact = (value: RepairData | null | undefined): value is RepairData => !!value && owned()
    && lease.origin.route.kind === 'read-book' && lease.origin.route.libraryId === libraryId && lease.origin.route.item.id === itemId
    && value.target.kind === 'item' && value.target.id === itemId && value.libraryId === libraryId
    && value.serverId === lease.viewer.serverId;
  const save = async () => {
    if (!service || !exact(data) || busy || saving.current) return;
    const fields: Record<string, {value: string}> = {};
    for (const spec of data.schema) {
      const current = data.snapshot.fields[spec.field];
      if (!current) continue;
      const next = draft[spec.field];
      if (next !== undefined && next !== current.value) fields[spec.field] = {value: next};
    }
    if (!Object.keys(fields).length) {if (owned()) close(); return;}
    const ticket = {};
    saving.current = ticket;
    setBusy(true); setFailed(false);
    try {
      const saved = await service.command({action: 'edit', fields}, data, {signal: linked.signal, current: owned});
      if (saved && owned()) close(); else if (owned()) setFailed(true);
    } catch {if (owned()) setFailed(true);}
    finally {if (saving.current === ticket) {saving.current = undefined; if (owned()) setBusy(false);}}
  };
  return <BottomSheet open onOpenChange={open => {if (!open && owned()) close();}} title={t('next.reader.editDetails')}
    description={t('next.reader.ownerOnly')} testID="native-read-owner-edit" keyboardAvoiding
    footer={<View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 10}}>
      <Button variant="glass" onPress={() => {if (owned()) close();}} disabled={busy}>{t('action.cancel')}</Button>
      <Button onPress={() => {void save();}} loading={busy} disabled={!exact(data) || busy}>{t('action.save')}</Button>
    </View>}>
    {snapshot.phase === 'idle' || snapshot.phase === 'loading' ? <SkeletonBlock width="100%" height={220}/> : null}
    {snapshot.phase === 'error' || failed ? <StateView variant="inline" title={t('error.unknown')}/> : null}
    {exact(data) ? <View style={{gap: 12}}>
      {data.schema.map(spec => {
        const field = data.snapshot.fields[spec.field];
        if (!field) return null;
        const provenance = sourceLabel(field.source);
        return <View key={spec.field} style={{gap: 4}}>
          <Text style={[browseType(theme, 13, 700), {color: theme.colors.text}]}>{spec.label}</Text>
          <TextField value={draft[spec.field] ?? field.value} onChangeText={next => {if (owned() && !busy) setDraft(current => ({...current, [spec.field]: next}));}}
            editable={!busy} maxLength={spec.maxLength} accessibilityLabel={spec.label}/>
          {provenance ? <Text style={[browseType(theme, 11.5, 500), {color: theme.colors.textTertiary}]}>{provenance}</Text> : null}
        </View>;
      })}
    </View> : null}
  </BottomSheet>;
}
