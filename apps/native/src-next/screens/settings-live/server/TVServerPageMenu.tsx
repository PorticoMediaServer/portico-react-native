import React from 'react';
import {Text, View} from 'react-native';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Focusable} from '../../../kit/controls';
import {FocusRegion} from '../../../kit/focus';
import {Icon} from '../../../kit/Icon';
import {ServerHeader} from '../../../kit/shell';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';

export type TVServerPage = 'dashboard' | 'libraries' | 'remote' | 'people' | 'troubleshooting';
const pages: readonly {id: TVServerPage; label: MessageId; icon: React.ComponentProps<typeof Icon>['name']}[] = [
  {id: 'dashboard', label: 'next.shell.dashboard', icon: 'i-pulse'},
  {id: 'libraries', label: 'settings.server.libraries', icon: 'i-folder'},
  {id: 'remote', label: 'settings.server.remote', icon: 'i-globe'},
  {id: 'people', label: 'settings.server.people', icon: 'i-people'},
  {id: 'troubleshooting', label: 'settings.server.troubleshooting', icon: 'i-wrench'},
];
/** Pages the drawn administrator view exposes (frame 39); the owner sees every
 * mounted page. This list never grants a reader authority. */
// Troubleshooting's log reader is owner-only on the server; it stays off the
// administrator's menu until an admin-safe producer is approved.
const administratorPages: ReadonlySet<TVServerPage> = new Set(['dashboard', 'people']);

/** Only pages with a real mounted reader enter the menu. Admission is still
 * checked by route composition; this list never grants a reader authority. */
export function TVServerPageMenu({role, page, serverName, runtime, column, rows, rail, onLayout, onSelect}: {
  role: 'owner' | 'administrator'; page: TVServerPage; serverName: string;
  runtime: NativeShellRuntime; column: string; rows: string; rail: string;
  onLayout?: React.ComponentProps<typeof FocusRegion>['onLayout'];
  onSelect: (page: TVServerPage) => void;
}) {
  const theme = useTheme(), t = runtime.text.t;
  return <View style={{width: 480}}>
    <Text accessibilityRole="header" style={[shellType(44, 800), {color: theme.colors.text, marginLeft: 20, marginBottom: 24}]}>{t('next.shell.serverSettings')}</Text>
    <ServerHeader serverName={serverName} viewerRole={role} audience={role === 'owner' ? 'owner' : 'administrators'} variant="group" style={{padding: 20}}/>
    <FocusRegion id={column} entry={page} orientation="vertical" edges={{left: rail, right: rows}} onLayout={onLayout}>
      {pages.filter(item => role === 'owner' || administratorPages.has(item.id)).map(item => <Focusable key={item.id} focusId={item.id} testID={`server-page-${item.id}`} focusKind="row" accessibilityRole="button" accessibilityLabel={t(item.label)} accessibilityState={{selected: page === item.id}}
        onPress={() => onSelect(item.id)} style={{minHeight: 50, paddingHorizontal: 20, borderRadius: 14, backgroundColor: page === item.id ? `${theme.colors.accent}29` : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 16}}>
        <Icon name={item.icon} size={24} color={page === item.id ? theme.colors.accentStrong : theme.colors.text}/>
        <Text style={[shellType(24, 600), {color: theme.colors.text}]}>{t(item.label)}</Text>
      </Focusable>)}
    </FocusRegion>
  </View>;
}
