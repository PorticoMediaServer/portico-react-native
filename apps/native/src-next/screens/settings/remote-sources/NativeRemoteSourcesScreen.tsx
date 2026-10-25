import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {sourceStateText} from '../../../../../../packages/client-core/src/server-admin/storage-words';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import type {NativeSettingsLivePorts} from '../../settings-live/ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import {NativeRemoteSourcesController} from './controller';

/** Read surface only, not mounted yet: the frame's wizard and source-detail actions
 * must land before Settings exposes this screen. No legacy UI or invented status data. */
export function NativeRemoteSourcesScreen({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t;
  const controller = useMemo(() => new NativeRemoteSourcesController(ports), [ports]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {void controller.load(); return () => controller.dispose();}, [controller]);
  if (!snapshot.allowed) {
    const problem = presentError({code: 'forbidden'}, 'server-console');
    return <StateView title={problem.title} body={problem.body} tone="error"/>;
  }
  const state = snapshot.sources;
  const problem = state.error ? presentError({code: state.errorCode || 'request_failed'}, 'server-console') : undefined;
  return <ScrollView testID="native-remote-sources" contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40, gap: 16}}>
    <ServerHeader serverName={ports.serverName()} viewerRole="owner" audience="owner" variant="phone"/>
    <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.remoteSources')}</Text>
    {problem && <StateView title={problem.title} body={problem.body} tone="error"
      primaryAction={{id: 'retry', label: t('action.tryAgain'), onPress: () => {void controller.load();}}}/>}
    {!state.loading && !problem && !state.sources.length && <StateView title={t('web.storage.empty')} body={t('web.storage.emptyHelp')}/>}
    {state.sources.map(source => <View key={source.id} testID={`remote-source-${source.id}`} style={{paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.line, gap: 6}}>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{source.name}</Text>
      <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{sourceStateText(t, id => defaultI18n.has(id), source)}</Text>
      {!!source.origin && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{source.origin}</Text>}
      {!!source.rootPath && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{source.rootPath}</Text>}
    </View>)}
  </ScrollView>;
}
