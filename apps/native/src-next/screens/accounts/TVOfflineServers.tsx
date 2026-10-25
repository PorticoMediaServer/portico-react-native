import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {ColourBackdrop} from '../../kit/artwork';
import {Button} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {nativeType, useTheme} from '../../kit/theme';
import type {DirectoryRow} from './directory-chooser';
import {PhoneOfflineServers} from './PhoneOfflineServers';

type Props = {rows: readonly DirectoryRow[]; scope: object | undefined; revision: number; isCurrent: () => boolean;
  onDownloads?: () => void; username?: string; onSettings?: () => void; onJoin?: () => void; onFind?: () => void;
  busy: boolean; retryIn?: number; activeId?: string; onRetry: (id: string) => void; onBack: () => void; onRefresh: () => void};
type Ticket = {live: boolean; scope: object};
/** Actual directory observations only. The parent owns one serialized connection
 * and its existing captured-issuer retry timer; this view never starts a session. */
export function TVOfflineServers(props: Props) {
  const t = defaultI18n.t, theme = useTheme();
  const scope = useMemo(() => ({owner: props.scope, revision: props.revision}), [props.scope, props.revision]);
  const active = useRef<Ticket | undefined>(undefined), [committed, setCommitted] = useState<Ticket>();
  if (active.current && active.current.scope !== scope) {active.current.live = false; active.current = undefined;}
  useLayoutEffect(() => {const ticket = {scope, live: true}; active.current = ticket; setCommitted(ticket);
    return () => {ticket.live = false; if (active.current === ticket) active.current = undefined;};}, [scope]);
  const current = () => !!committed?.live && committed.scope === scope && active.current === committed && props.isCurrent();
  if (!theme.isTV) {
    const action = (command?: () => void) => () => {if (current() && !props.busy) command?.();};
    return <PhoneOfflineServers rows={props.rows} busy={props.busy} activeId={props.activeId} retryIn={props.retryIn} username={props.username}
      onRetry={id => {if (current() && !props.busy && props.rows.some(row => row.id === id)) props.onRetry(id);}}
      onDownloads={props.onDownloads ? action(props.onDownloads) : undefined}
      onSettings={props.onSettings ? action(props.onSettings) : undefined} onJoin={props.onJoin ? action(props.onJoin) : undefined} onFind={props.onFind ? action(props.onFind) : undefined} onRefresh={action(props.onRefresh)} onBack={action(props.onBack)}/>;
  }
  return <View testID="tv-offline-servers" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ColourBackdrop shape="top"/>
    <ScrollView contentContainerStyle={{padding: 64, gap: 24}}>
      <Text style={[theme.type.captionStrong, {color: theme.colors.textSecondary}]}>{t('accounts.session.portico')}</Text>
      <Text accessibilityRole="header" style={[nativeType({size: 44, lineHeight: 52, weight: 700, tracking: -.03}, theme.textScale), {color: theme.colors.text}]}>{t('accounts.tvOffline.title')}</Text>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('accounts.tvOffline.body')}</Text>
      <View style={{gap: 16}}>{props.rows.map((row, index) => <View key={row.id} style={{padding: 24, borderRadius: 18, backgroundColor: theme.colors.raised, flexDirection: 'row', alignItems: 'center', gap: 24}}>
        <Icon name="i-server" size={32} color={theme.colors.textTertiary}/>
        <View style={{flex: 1, gap: 6}}>
          <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{row.name}</Text>
          {row.subtitle && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t(row.subtitle.key, row.subtitle.values)}</Text>}
        </View>
        {row.owner && <Text style={[theme.type.captionStrong, {color: theme.colors.textSecondary}]}>{t('accounts.settings.owner')}</Text>}
        <Button hasTVPreferredFocus={index === 0} disabled={props.busy} loading={props.busy && props.activeId === row.id || undefined}
          onPress={() => {if (current() && !props.busy) props.onRetry(row.id);}}>{t('web.chooser.tryAgain')}</Button>
      </View>)}</View>
      {props.retryIn !== undefined && !props.busy && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('web.chooser.checkingAgain', {seconds: props.retryIn})}</Text>}
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('accounts.tvOffline.help')}</Text>
      <View style={{flexDirection: 'row', gap: 24}}>
        <Button variant="text" disabled={props.busy} onPress={() => {if (current()) props.onRefresh();}}>{t('accounts.servers.refresh')}</Button>
        <Button variant="text" disabled={props.busy} onPress={() => {if (current()) props.onBack();}}>{t('action.back')}</Button>
      </View>
    </ScrollView>
  </View>;
}
