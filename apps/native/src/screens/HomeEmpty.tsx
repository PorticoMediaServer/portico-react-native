import React from 'react';
import {View} from 'react-native';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {useLibrariesContext} from '../app/libraries-context';
import {StateView, isTV, useTheme} from '../ui';
import {WebHandoff} from './SettingsPages';

/** The server console's address for this sign-in (the local server serves the web app). */
function useConsoleUrl(): string | undefined {
  const {serverUrl, session, hostedUrl} = useSession();
  if (session?.viewer.authority === 'hosted') return hostedUrl.replace(/\/$/, '');
  return serverUrl?.replace(/\/$/, '');
}

/**
 * ONB-07: Home with nothing on it. With no libraries the owner learns where libraries are added
 * (the server console, handed off to a browser: a link on a phone, a QR code on TV); a member is
 * told to ask the owner. With libraries that haven't produced titles yet, say so instead.
 */
export function HomeEmpty() {
  const {session} = useSession();
  const libraries = useLibrariesContext();
  const i18n = useI18n();
  const consoleUrl = useConsoleUrl();
  const owner = session?.viewer.role === 'owner';
  if (libraries.loading) return null;
  if (!libraries.items.length) {
    if (!owner) return <StateView icon="library" title={i18n.t('web.empty.memberTitle')} message={i18n.t('web.empty.memberBody')} />;
    return (
      <View>
        <StateView icon="library" title={i18n.t('web.empty.ownerTitle')} message={i18n.t('web.empty.ownerBody')} />
        {consoleUrl ? <HandoffRow url={`${consoleUrl}/server/libraries`} title={i18n.t('home.empty.openConsole')} subtitle={i18n.t('home.empty.ownerComputer')} /> : null}
      </View>
    );
  }
  return <StateView icon="home" title={i18n.t('web.empty.homeTitle')} message={i18n.t(owner ? 'web.empty.homeOwnerBody' : 'web.empty.homeMemberBody')} />;
}

function HandoffRow({url, title, subtitle}: {url: string; title: string; subtitle?: string}) {
  const {space} = useTheme();
  return <View style={{paddingHorizontal: space.page, paddingBottom: space.lg, alignSelf: 'center', width: '100%', maxWidth: isTV ? 1100 : 640}}><WebHandoff url={url} title={title} subtitle={subtitle} /></View>;
}
