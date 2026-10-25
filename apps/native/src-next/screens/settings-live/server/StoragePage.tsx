import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {LimitsTab} from './storage/LimitsTab';
import {BackupsTab} from './storage/BackupsTab';
import {NativeStorageSpaceUsage} from './storage/SpaceUsage';
import {NativeEmptyCache} from './storage/EmptyCache';
import {NativeDownloadsUsage} from './storage/DownloadsUsage';

type ViewerRole = 'owner' | 'administrator' | 'member';
/** Storage & backups is one page; Missing titles belongs to Libraries. */
export function NativeServerStorage({ports, runtime, compactHeader = false}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean}) {
  const theme = useTheme(), t = runtime.text.t as typeof defaultI18n.t, context = ports.context;
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  return <View style={{flex:1}}><ScrollView contentContainerStyle={{paddingHorizontal:20,paddingBottom:40}}>
    <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom:12}}/>
    {!compactHeader && <Text accessibilityRole="header" style={[shellType(28,800,33,-.03),{color:theme.colors.text}]}>{t('settings.server.storage')}</Text>}
    <View style={{marginTop:14}}><NativeStorageSpaceUsage context={context} runtime={runtime}/></View>
    <NativeEmptyCache context={context} runtime={runtime}/>
    <BackupsTab ports={ports} runtime={runtime} t={t}/>
    <NativeDownloadsUsage ports={ports} runtime={runtime}/>
    <LimitsTab ports={ports} runtime={runtime} t={t}/>
  </ScrollView></View>;
}
