import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {sourceReadPresetName, type RemoteSource, type SourceReadSettings} from '../../../../../../packages/client-core/src/remote-sources';
import type {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {useTheme} from '../../../kit/theme';
import type {NativeRemoteSourcesController} from './controller';
import {Page, Problem, remoteSourceError, sourceReadPresetLabel, useAttempt} from './RemoteSourceForms';

/** Saving a source without assigning folders is an explicit, complete outcome. */
export function SourceCompletion({source, controller, t, isCurrent, onCancel, onOpen, onAddAnother}: {
  source: RemoteSource; controller: NativeRemoteSourcesController; t: typeof defaultI18n.t; isCurrent: () => boolean;
  onCancel: () => void; onOpen: () => void; onAddAnother: () => void;
}) {
  const theme = useTheme(), current = useAttempt(isCurrent), [profile, setProfile] = useState<SourceReadSettings>(), [error, setError] = useState<string>();
  useEffect(() => {
    void controller.readProfile(source, current).then(value => {if (current()) setProfile(value);}, problem => {if (current()) setError(remoteSourceError(t, problem));});
  }, [controller, source, current, t]);
  const preset = profile ? sourceReadPresetName(profile.values) : undefined;
  return <Page title={source.name} t={t} busy={false} onCancel={onCancel} wizardStep={5}
    footer={<View style={{gap: 12}}><Button onPress={onOpen}>{t('next.remoteSources.openSource', {name: source.name})}</Button><Button variant="glass" onPress={onAddAnother}>{t('next.remoteSources.addAnother')}</Button></View>}>
    <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>Source saved</Text>
    <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>Add folders to a library later.</Text>
    {profile && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.summaryLimits', {connections: profile.values.connections, requests: profile.values.requestsPerSecond})}</Text>}
    {preset && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.remoteSources.summaryTreatment', {preset: sourceReadPresetLabel(t, preset)})}</Text>}
    <Problem message={error}/>
  </Page>;
}
