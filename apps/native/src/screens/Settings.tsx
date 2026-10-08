import {InviteSheet} from './InviteSheet';
import {managesServer} from '../app/roles';
import React, {useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {useNavigation, useRoute, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {findSettingsPage, settingsPageId} from '../../../../packages/client-core/src/presentation/index';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {useI18n} from '../app/i18n';
import {useUnreadCount} from '../app/inbox';
import {useServerPreferences} from '../app/server-preferences';
import {LinkTVSheet} from './LinkTV';
import {useInRoom} from '../app/together';
import {FocusGroup, ListRow, Page, PageHeader, RowGroup, Text, useInitialFocus, useTheme} from '../ui';
import {ProfileAvatar} from './auth/ProfileAvatar';
import {useDirectAccount} from './Profiles';
import {SettingsPageBody, useSettingsStructure} from './settings/SettingsPage';
import {ServerPageBody, ServerPageScope} from './settings/ServerPage';
import {usePullToRefresh} from '../app/refresh';

/**
 * The one Settings screen (Justin, 2 Oct 2026), drawn from `settingsStructure`. iPhone and iPad:
 * a grouped list of pages that pushes each page. Television: the pages in a column on the left
 * and the selected page's rows beside them, so a row and its value sit within one glance.
 */
export function SettingsScreen() {
  const {isTV} = useTheme();
  return isTV ? <TelevisionSettings /> : <PhoneSettings />;
}

/** What is reached from here but is not a settings page: the profile and server switchers, notifications, Watch Together. */
function useShortcuts(): readonly {id: string; icon: 'switch' | 'server' | 'bell' | 'people'; title: string; subtitle?: string; meta?: string; onPress: () => void}[] {
  const session = useSession();
  const i18n = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const inRoom = useInRoom();
  const unread = useUnreadCount();
  const badges = useServerPreferences().value<boolean>('notifications.badges', true);
  const {isTV} = useTheme();
  return [
    ...(session.session?.viewer.authority === 'local' ? [{id: 'profile', icon: 'switch' as const, title: i18n.t('settings.switchProfile'), onPress: session.direct.openProfileChooser}] : []),
    // Justin: an account on several servers switches between them here (choosing one keeps the account and picks a profile there).
    {id: 'server', icon: 'server' as const, title: i18n.t('settings.switchServer'), onPress: () => navigation.push('Servers')},
    // Television has no top bar, so its bell is this row; phones and iPad have the bell on every tab.
    ...(isTV ? [{id: 'notifications', icon: 'bell' as const, title: i18n.t('notifications.title'), meta: unread && badges ? i18n.t('settings.unreadCount', {count: unread}) : undefined, onPress: () => navigation.push('Notifications')}] : []),
    {id: 'together', icon: 'people' as const, title: i18n.t('feature.watchTogether'), subtitle: inRoom ? i18n.t('settings.inGroup') : undefined, onPress: () => navigation.push('Together')},
  ];
}

function PhoneSettings() {
  const session = useSession();
  const i18n = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space} = useTheme();
  const route = useRoute<RouteProp<ContentStackParams, 'Settings'>>();
  const structure = useSettingsStructure();
  const shortcuts = useShortcuts();
  const [linkTV, setLinkTV] = useState(false);
  const [inviting, setInviting] = useState(false);
  useEffect(() => { if (route.params?.linkTV) setLinkTV(true); }, [route.params?.linkTV]);
  const account = useDirectAccount();
  const viewer = session.session?.viewer;
  const server = session.system?.name ?? i18n.t('servers.fallbackName');
  const hosted = viewer?.authority === 'hosted';
  const profile = hosted ? session.hosted?.profiles.find(p => p.id === viewer?.profileId)?.name : account.snapshot?.profiles.find(p => p.id === viewer?.profileId)?.name;
  const username = hosted ? session.hosted?.account.username : account.snapshot?.account.username;
  const who = hosted ? i18n.t('settings.signedInWithAccount', {server}) : username ? i18n.t('settings.signedInAs', {server, username}) : i18n.t('settings.signedInTo', {server});
  const accountTitle = profile ?? session.hosted?.account.displayName ?? username ?? i18n.t('account.serverAccount');
  const profileArt = hosted ? undefined : account.snapshot?.profiles.find(p => p.id === viewer?.profileId)?.art;
  const open = (address: string) => navigation.push('SettingsPage', {address});
  return (
    <View style={{flex: 1}}>
      <Page>
        <PageHeader title={i18n.t('settings.title')} onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />
        <View style={{paddingHorizontal: space.page, gap: space.xl}}>
          {/* Who is signed in heads the list in its own group, with the profile's avatar (like the system Settings). */}
          <RowGroup>
            <ListRow leadingView={<ProfileAvatar name={accountTitle} art={profileArt} size={48} />} title={accountTitle} subtitle={who} accessory="navigation" onPress={() => open('profile')} />
          </RowGroup>
          <RowGroup>
            {shortcuts.map(x => <ListRow key={x.id} icon={x.icon} title={x.title} subtitle={x.subtitle} meta={x.meta} accessory="navigation" onPress={x.onPress} />)}
            {managesServer(viewer?.role) ? <ListRow icon="people" title={i18n.t('invite.row')} subtitle={i18n.t('invite.rowHelp')} accessory="navigation" onPress={() => setInviting(true)} /> : null}
          </RowGroup>
          {structure.headings.map(heading => (
            <RowGroup key={heading.id} title={i18n.t(heading.title)}>
              {heading.pages.map(page => <ListRow key={page.id} icon={page.icon} title={i18n.t(page.title)} accessory="navigation" onPress={() => open(settingsPageId(heading.id, page.id))} />)}
            </RowGroup>
          ))}
          {__DEV__ ? <RowGroup><ListRow icon="grid" title={i18n.t('settings.designGallery')} accessory="navigation" onPress={() => navigation.push('Gallery')} /></RowGroup> : null}
        </View>
      </Page>
      <LinkTVSheet open={linkTV} onClose={() => setLinkTV(false)} />
      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
    </View>
  );
}

/** A pushed settings page (iPhone and iPad), or one opened by a link (`portico://account`). */
export function SettingsPageScreen() {
  const route = useRoute<RouteProp<ContentStackParams, 'SettingsPage'>>();
  return <SettingsPageFrame address={route.params.address} />;
}
export function AccountScreen() {
  return <SettingsPageFrame address="profile" />;
}
export function AboutScreen() {
  return <SettingsPageFrame address="about" />;
}

function SettingsPageFrame({address}: {address: string}) {
  const i18n = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {space, isTV} = useTheme();
  const structure = useSettingsStructure();
  const entry = useInitialFocus();
  const found = findSettingsPage(structure, address);
  if (!found) return null;
  const header = <PageHeader title={i18n.t(found.page.title)} onBack={() => navigation.goBack()} />;
  // A Server page: its forms behind one Save at the bottom of the screen, and one refresh (pull down).
  if (found.heading.id === 'server') return (
    <ServerPageScope key={found.page.id}>
      {({refresh, bar}) => (
        <View style={{flex: 1}}>
          <RefreshingPage refresh={refresh}>
            {header}
            <View style={{paddingHorizontal: space.page}}><ServerPageBody page={found.page} entry={isTV && entry} /></View>
          </RefreshingPage>
          {bar}
        </View>
      )}
    </ServerPageScope>
  );
  return (
    <View style={{flex: 1}}>
      <Page>
        {header}
        <View style={{paddingHorizontal: space.page}}><SettingsPageBody page={found.page} entry={isTV && entry} /></View>
      </Page>
    </View>
  );
}

function RefreshingPage({refresh, children}: {refresh: () => void; children: React.ReactNode}) {
  const control = usePullToRefresh(refresh, {auto: false});
  return <Page refreshControl={control}>{children}</Page>;
}

const TV_COLUMN = 560;

function TelevisionSettings() {
  const i18n = useI18n();
  const {space, colors} = useTheme();
  const insets = useSafeAreaInsets();
  const structure = useSettingsStructure();
  const shortcuts = useShortcuts();
  const initial = useInitialFocus();
  const [address, setAddress] = useState<string>();
  const found = findSettingsPage(structure, address);
  const top = Math.max(insets.top, 60);
  return (
    <View style={{flex: 1, flexDirection: 'row', paddingTop: top, paddingLeft: space.page, gap: space.xxl}}>
      {/* Moving back into the column returns to the page that is open, not to whichever row is nearest. */}
      <FocusGroup style={{width: TV_COLUMN}}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{gap: space.xl, paddingBottom: space.xxxl}}>
          <Text variant="title">{i18n.t('settings.title')}</Text>
          {structure.headings.map(heading => (
            <RowGroup key={heading.id} title={i18n.t(heading.title)}>
              {heading.pages.map((page, index) => {
                const to = settingsPageId(heading.id, page.id);
                // A page opens as focus reaches it: nothing is more than a few presses away.
                return <ListRow key={to} icon={page.icon} title={i18n.t(page.title)} selected={found?.page === page} hasTVPreferredFocus={initial && heading === structure.headings[0] && index === 0} onFocus={() => setAddress(to)} onPress={() => setAddress(to)} />;
              })}
            </RowGroup>
          ))}
          <RowGroup title={i18n.t('settings.more')}>
            {shortcuts.map(x => <ListRow key={x.id} icon={x.icon} title={x.title} subtitle={x.subtitle} meta={x.meta} accessory="navigation" onPress={x.onPress} />)}
          </RowGroup>
        </ScrollView>
      </FocusGroup>
      <FocusGroup style={{flex: 1}}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingRight: space.page, paddingBottom: space.xxxl, gap: space.lg}}>
          {found ? (
            <>
              <Text variant="heading" style={{color: colors.textSecondary}}>{i18n.t(found.page.title)}</Text>
              {found.heading.id === 'server' ? <ServerPageScope key={found.page.id}>{() => <ServerPageBody page={found.page} />}</ServerPageScope> : <SettingsPageBody key={found.page.id} page={found.page} />}
            </>
          ) : null}
        </ScrollView>
      </FocusGroup>
    </View>
  );
}
