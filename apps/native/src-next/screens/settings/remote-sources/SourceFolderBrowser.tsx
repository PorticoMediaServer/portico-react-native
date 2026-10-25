import React, {useEffect, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import type {RemoteFolderPage, RemoteSource} from '../../../../../../packages/client-core/src/remote-sources';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {Switch} from '../../../kit/controls/Switch';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';
import {Page, Problem, remoteSourceError, useAttempt} from './RemoteSourceForms';

/** Saved-source directory producer only; no local filesystem discovery or invented folders. */
export function SourceFolderBrowser({controller, source, t, isCurrent, onCancel}: {
  controller: NativeRemoteSourcesController; source: RemoteSource; t: typeof defaultI18n.t; isCurrent: () => boolean; onCancel: () => void;
}) {
  const theme = useTheme(), current = useAttempt(isCurrent), flight = useRef(false);
  const [page, setPage] = useState<RemoteFolderPage>(), [hidden, setHidden] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const read = async (path = '', showHidden = hidden, more = false) => {
    if (flight.current || !current() || more && (!page?.nextCursor || page.entries.length >= 500)) return;
    const base = more ? page : undefined;
    flight.current = true; setBusy(true); setError(undefined);
    if (!more) setPage(undefined);
    try {
      const next = await controller.sourceFolders(source, {...(path ? {path} : {}), showHidden, ...(base ? {cursor: base.nextCursor} : {})}, current);
      if (!current()) return;
      if (base && (next.relative !== base.relative || next.path !== base.path || next.generation !== base.generation || next.nextCursor && next.nextCursor === base.nextCursor))
        throw Object.assign(new Error('remote_source_changed'), {code: 'remote_source_changed'});
      const entries = base ? [...new Map([...base.entries, ...next.entries].map(value => [value.relative, value])).values()] : next.entries;
      setPage({...next, entries}); setHidden(showHidden);
    } catch (problem) {if (current()) setError(remoteSourceError(t, problem));}
    finally {flight.current = false; if (current()) setBusy(false);}
  };
  useEffect(() => {void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const parent = page?.relative.split('/').slice(0, -1).join('/') ?? '';
  return <Page title={t('next.remoteSources.foldersSection')} t={t} busy={busy} onCancel={onCancel} footer={null}>
    <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{source.name}</Text>
    {page && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{page.path}</Text>}
    <Switch checked={hidden} disabled={busy} onCheckedChange={value => {void read(page?.relative ?? '', value);}}>{t('next.remoteSources.showHiddenFolders')}</Switch>
    {!!page?.relative && <Button disabled={busy} variant="text" onPress={() => {void read(parent);}}>{t('next.remoteSources.upOneFolder')}</Button>}
    {busy && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.folderListing')}</Text>}
    {page && !page.entries.length && !busy && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.noFoldersHere')}</Text>}
    {page?.entries.map(folder => <View key={folder.relative} style={{gap: 4}}>
      <Button disabled={busy} variant="glass" accessibilityLabel={t('next.remoteSources.openFolder', {name: folder.name})}
        onPress={() => {void read(folder.relative);}}>{folder.name}</Button>
    </View>)}
    {!!page?.nextCursor && page.entries.length < 500 && <Button variant="text" disabled={busy} onPress={() => {void read(page.relative, hidden, true);}}>{t('next.remoteSources.showMoreFolders')}</Button>}
    {(page?.truncated || !!page?.nextCursor && page.entries.length >= 500) && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.folderTruncated')}</Text>}
    <Problem message={error}/>
    <Button variant="text" disabled={busy} onPress={() => {void read(page?.relative ?? '');}}>{t('next.remoteSources.refresh')}</Button>
  </Page>;
}
