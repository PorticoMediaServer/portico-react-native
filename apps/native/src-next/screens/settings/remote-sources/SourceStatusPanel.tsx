import React, {useEffect, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import type {RemoteSource, RemoteSourceStatus} from '../../../../../../packages/client-core/src/remote-sources';
import {sourceStateText} from '../../../../../../packages/client-core/src/server-admin/storage-words';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';
import {Problem, remoteSourceError, useAttempt} from './RemoteSourceForms';

/** One explicit status read; no polling or inferred provider wait deadline. */
export function SourceStatusPanel({controller, source, isCurrent, t}: {
  controller: NativeRemoteSourcesController; source: RemoteSource; isCurrent: () => boolean; t: typeof defaultI18n.t;
}) {
  const theme = useTheme(), current = useAttempt(isCurrent), flight = useRef(false);
  const [status, setStatus] = useState<RemoteSourceStatus>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const load = async () => {
    if (flight.current || !current()) return;
    flight.current = true; setBusy(true); setError(undefined);
    try {const next = await controller.sourceStatus(source, current); if (current()) setStatus(next);}
    catch (problem) {if (current()) {setStatus(undefined); setError(remoteSourceError(t, problem));}}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  useEffect(() => {void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={{gap: 10}}>
    <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('next.remoteSources.status')}</Text>
    {status && <>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{sourceStateText(t, id => defaultI18n.has(id), {...source, state: status.state, errorCode: status.errorCode})}</Text>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.connectionsNow', {connections: status.connectionsInUse})}</Text>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('next.remoteSources.lastChecked')}</Text>
      <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{status.lastCheckedAt || t('next.remoteSources.neverChecked')}</Text>
      <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('next.remoteSources.usedBy')}</Text>
      {!status.libraries.length && !status.librariesTruncated && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.noLibraryUses')}</Text>}
      {status.libraries.map(library => <View key={library.libraryId} style={{gap: 4}}>
        <Text style={[theme.type.body, {color: theme.colors.text}]}>{library.name}</Text>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.foldersInLibrary', {count: library.folders})}</Text>
      </View>)}
    </>}
    <Problem message={error}/>
    <Button variant="text" disabled={busy} onPress={() => {void load();}}>{t(busy ? 'next.remoteSources.loading' : 'next.remoteSources.refresh')}</Button>
  </View>;
}
