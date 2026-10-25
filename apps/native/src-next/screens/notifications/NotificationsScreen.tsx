import React, {useEffect, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {noticeWords, type Notification, type NotificationAction} from '../../../../../packages/client-core/src/notifications';
import type {InboxAction, InboxService, InboxView} from '../../../../../packages/client-core/src/inbox';
import {Button, Tabs} from '../../kit/controls';
import {Icon, type IconName} from '../../kit/Icon';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {NotificationItem} from '../../kit/shell';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import {nativeMenuRouteAvailable} from '../../shell/account';
import {sameAuthority, type ShellDestination} from '../../shell/model';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';

type Retirement = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Error | undefined;
}>;

/** The exact layout that drew these controls. Callbacks hold this object, never the
 * newest navigation/service state. The live flag is owned by this lease alone and is
 * closed by the layout cleanup, so an unmounted or replaced layout cannot act. */
type NotificationsLease = Readonly<{
  route: NativeShellRoute;
  revision: number;
  authority: ReturnType<NativeShellBootstrapContext['authority']>;
  origin: ShellDestination;
  profile: InboxService;
  admin: InboxService;
  retirement: Retirement;
  live: {value: boolean};
}>;

/** phone-app 9/21: the server's inbox, split by the audience envelopes it returns.
 * The profile feed is always this viewer's. The account-admin feed is requested only
 * for a local owner, the same rule the server enforces. Every word is either the
 * server's own notice or the catalogue; no notice is made up on the device. */
export function NativeNotificationsScreen({context, route, runtime, profileService, adminService, retirement}: {
  context: NativeShellBootstrapContext;
  route: NativeShellRoute;
  runtime: NativeShellRuntime;
  profileService: InboxService;
  adminService: InboxService;
  retirement: Retirement;
}) {
  const theme = useTheme(), t = runtime.text.t, insets = useSafeAreaInsets();
  const profile = useSyncExternalStore(profileService.subscribe, profileService.getSnapshot);
  const admin = useSyncExternalStore(adminService.subscribe, adminService.getSnapshot);
  const retired = useSyncExternalStore(retirement.subscribe, retirement.getSnapshot);
  const [view, setView] = useState<InboxView>('unread');
  const [chosen, setChosen] = useState<Notification>();
  const [lease, setLease] = useState<NotificationsLease>();

  // Admission and retirement belong to the committed layout, not to render. The
  // state-published lease is what every callback below captures.
  useLayoutEffect(() => {
    const live = {value: true};
    const next = Object.freeze({
      route, revision: context.navigation.getSnapshot().revision,
      authority: Object.freeze({...context.authority()}),
      origin: context.navigation.getSnapshot().destination,
      profile: profileService, admin: adminService, retirement, live,
    });
    setLease(next);
    return () => {
      live.value = false;
      setLease(current => current === next ? undefined : current);
    };
  }, [adminService, context, profileService, retirement, route]);

  useEffect(() => {
    if (!lease || retired) return;
    void lease.profile.load('profile', view);
  }, [lease, retired]);
  useEffect(() => {
    if (!lease || retired || context.account.account.role !== 'owner') return;
    void lease.admin.load('account-admin', view);
  }, [context, lease, retired]);

  // The captured route/revision/authority and the lease's own live flag, without the
  // retirement check. Only the retirement fallback's Back uses this; it must still be
  // unable to navigate once this exact layout is gone or replaced.
  const routeLive = () => !!lease && lease.live.value
    && sameAuthority(lease.authority, context.authority())
    && context.navigation.getSnapshot().revision === lease.revision
    && context.navigation.getSnapshot().route === lease.route;
  if (retired) return <View testID="native-notifications-retired" style={{flex: 1, backgroundColor: theme.colors.ink, paddingTop: insets.top + 14}}>
    <StateView icon="i-warn" title={t('notifications.error.load')} primaryAction={{id: 'back', label: t('action.back'), onPress: () => {if (routeLive()) context.navigation.back(context.authority());}}}/>
  </View>;
  if (!lease || lease.profile !== profileService || lease.admin !== adminService || lease.retirement !== retirement) return <View testID="native-notifications-pending" style={{flex: 1, backgroundColor: theme.colors.ink}}/>;

  const hasLiveTV = runtime.getSnapshot().hasLiveTV;
  const adminRequested = context.account.account.role === 'owner';
  const current = () => routeLive() && lease.retirement.getSnapshot() === undefined;
  const viewLive = (service: InboxService, viewAt: InboxView) => current()
    && (service === lease.profile || service === lease.admin)
    && service.getSnapshot().view === viewAt;
  const noticeLive = (service: InboxService, viewAt: InboxView, notice: Notification) => {
    const snapshot = service.getSnapshot();
    return viewLive(service, viewAt) && snapshot.items.some(item =>
      item.id === notice.id && item.audience === notice.audience && item.revision === notice.revision);
  };
  const serviceFor = (notice: Notification) => notice.audience === 'account-admin' ? lease.admin : lease.profile;

  const changeView = (next: string) => {
    if (!current() || lease.profile.getSnapshot().view !== view) return;
    const value = next as InboxView;
    setView(value);
    void lease.profile.load('profile', value);
    if (adminRequested) void lease.admin.load('account-admin', value);
  };
  const reload = () => {
    if (!current() || lease.profile.getSnapshot().view !== view) return;
    void lease.profile.load('profile', view);
    if (adminRequested) void lease.admin.load('account-admin', view);
  };
  const words = (notice: Notification) => noticeWords(notice, {has: defaultI18n.has, t: runtime.text.t});
  const adminVisible = adminRequested && admin.phase === 'ready' && admin.audiences.includes('account-admin');
  const unread = profile.counts.unread + (adminVisible ? admin.counts.unread : 0);
  const busy = profile.busy || (adminVisible && admin.busy);
  const error = profile.error ?? (adminRequested ? admin.error : undefined);
  const loading = profile.phase === 'loading' || (adminRequested && admin.phase === 'loading');
  const ready = profile.phase === 'ready' && (!adminRequested || admin.phase === 'ready');
  const items = [...profile.items, ...(adminVisible ? admin.items : [])];
  const sections = [
    {id: 'profile', title: t('notifications.audience.profile'), tag: undefined, service: lease.profile, state: profile},
    ...(adminVisible ? [{id: 'admin', title: t('notifications.audience.admin'), tag: t(context.account.account.role === 'admin' ? 'next.shell.administrators' : 'next.shell.ownerOnly'), service: lease.admin, state: admin}] : []),
  ].filter(section => section.state.items.length > 0);

  const routeFor = (action: NotificationAction): NativeShellRoute | undefined => {
    if (action.kind === 'command') return action.command === 'open-download' ? {kind: 'downloads'} : undefined;
    const targetView = action.target?.view, libraryId = action.target?.libraryId, entityId = action.target?.entityId;
    switch (targetView) {
      case 'home': return {kind: 'shell', destination: {kind: 'home'}};
      case 'library': return libraryId ? {kind: 'shell', destination: {kind: 'library', libraryId}} : undefined;
      case 'live': return hasLiveTV ? {kind: 'shell', destination: {kind: 'live'}} : undefined;
      case 'search': return {kind: 'shell', destination: {kind: 'search'}};
      // Root33: a preparation-ready notice only points at the real Downloads
      // surface. It never claims the file is on this device or locally playable.
      case 'downloads': return {kind: 'downloads'};
      case 'settings': return {kind: 'shell', destination: {kind: 'settings'}};
      case 'person': return entityId ? {kind: 'person', personId: entityId} : undefined;
      // A view this build has no real surface for stays out rather than guessing.
      default: return undefined;
    }
  };
  const routeAvailable = (targetRoute: NativeShellRoute) =>
    targetRoute.kind === 'shell' && targetRoute.destination.kind === 'home' ? true : nativeMenuRouteAvailable(targetRoute);
  const openAction = (notice: Notification, targetRoute: NativeShellRoute, viewAt: InboxView) => {
    const service = serviceFor(notice);
    if (!noticeLive(service, viewAt, notice) || !routeAvailable(targetRoute)) return;
    // Mark read while this original notice and route lease are still current, then
    // navigate only if that is still true. The read is an independent command, not
    // a promise carried by the route switch.
    void service.apply('read', [notice.id]).catch(runtime.reportError);
    if (!current()) return;
    context.navigation.open(targetRoute, context.authority());
  };
  const actionsFor = (notice: Notification, viewAt: InboxView) => notice.actions.flatMap((action, index) => {
    const targetRoute = routeFor(action);
    return targetRoute && routeAvailable(targetRoute) ? [{id: String(index), label: action.label, onPress: () => openAction(notice, targetRoute, viewAt)}] : [];
  });
  const apply = (notice: Notification, action: InboxAction, viewAt: InboxView) => {
    setChosen(undefined);
    const service = serviceFor(notice);
    if (!noticeLive(service, viewAt, notice)) return;
    void service.apply(action, [notice.id]).catch(runtime.reportError);
  };
  const markAll = () => {
    if (!current()) return;
    if (viewLive(lease.profile, view)) void lease.profile.readAll().catch(runtime.reportError);
    if (adminVisible && viewLive(lease.admin, view)) void lease.admin.readAll().catch(runtime.reportError);
  };
  const chosenWords = chosen ? words(chosen) : undefined;
  const menu: readonly MenuEntry[] = chosen ? [
    ...(view === 'archived' ? [] : [{id: chosen.read ? 'unread' : 'read', label: t(chosen.read ? 'notifications.markUnread' : 'notifications.markRead'), icon: (chosen.read ? 'i-eyeoff' : 'i-check') as IconName, onSelect: () => apply(chosen, chosen.read ? 'unread' : 'read', view)}]),
    {id: chosen.archived ? 'unarchive' : 'archive', label: t(chosen.archived ? 'notifications.unarchive' : 'notifications.archive'), icon: 'i-archive' as IconName, onSelect: () => apply(chosen, chosen.archived ? 'unarchive' : 'archive', view)},
  ] : [];
  const emptyTitle = view === 'unread' ? t('notifications.caughtUp') : view === 'archived' ? t('notifications.noneArchived') : t('notifications.none');
  const backLabel = lease.origin.kind === 'settings' ? t('next.shell.settings') : t('action.back');

  return <View testID="native-notifications" style={{flex: 1, backgroundColor: theme.colors.ink, paddingTop: insets.top + 14}}>
    <View style={{height: 56, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
      {theme.platform === 'phone' && <View accessible={false} pointerEvents="none" style={{position: 'absolute', top: 6, alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: theme.colors.lineStrong}}/>}
      <Button testID="notifications-back" variant="text" size="small" icon="i-left" accessibilityLabel={backLabel}
        onPress={() => {if (!current()) return; if (context.navigation.back(context.authority())) setChosen(undefined);}} style={{minHeight: 38, paddingHorizontal: 6, marginLeft: -4}}
        textStyle={shellType(16, 600)}>{backLabel}</Button>
      <Text accessibilityRole="header" pointerEvents="none" style={[shellType(17, 700), {position: 'absolute', left: 96, right: 96, textAlign: 'center', color: theme.colors.text}]}>{t('next.shell.notifications')}</Text>
      {view !== 'archived' && unread > 0 ? <Button testID="notifications-mark-all" variant="text" size="small" disabled={busy} onPress={markAll}
        style={{minHeight: 38, paddingHorizontal: 6, marginRight: -4}} textStyle={shellType(14, 700)}>{t('notifications.markAllRead')}</Button> : <View/>}
    </View>
    <Tabs testID="notifications-views" value={view} onValueChange={changeView} items={[
      {value: 'unread', label: unread > 0 ? `${t('notifications.view.unread')} ${defaultI18n.number(unread)}` : t('notifications.view.unread')},
      {value: 'all', label: t('notifications.view.all')},
      {value: 'archived', label: t('notifications.view.archived')},
    ]}/>
    <ScrollView style={{flex: 1}} contentContainerStyle={{paddingBottom: Math.max(24, insets.bottom + 16), paddingTop: 4}}>
      {error !== undefined && items.length > 0 && <StateView tone="warning" title={error} primaryAction={{id: 'retry', label: t('action.tryAgain'), onPress: reload}} style={{paddingTop: 8, paddingBottom: 8}}/>}
      {loading && !items.length && <StateView icon="i-bell" title={t('notifications.loading')}/>}
      {!loading && !items.length && error !== undefined && <StateView icon="i-warn" title={t('notifications.error.load')} body={error} primaryAction={{id: 'retry', label: t('action.tryAgain'), onPress: reload}}/>}
      {ready && !items.length && error === undefined && <StateView icon={view === 'archived' ? 'i-archive' : 'i-bell'} title={emptyTitle} body={t('notifications.emptyBody')}/>}
      {sections.map(section => <View key={section.id} testID={`notifications-section-${section.id}`} style={{marginTop: 12}}>
        <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 20, marginBottom: 8}}>
          <Text style={[shellType(13, 700), {color: theme.colors.textTertiary}]}>{section.title}</Text>
          {section.tag && <Text style={[shellType(12, 700), {color: theme.colors.textTertiary}]}>{section.tag}</Text>}
        </View>
        <View style={{marginHorizontal: 16, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
          {section.state.items.map(notice => {
            const message = words(notice);
            return <NotificationItem key={notice.id} testID={`notification-${notice.id}`} notification={notice} title={message.title} body={message.body} when={defaultI18n.relativeTime(notice.createdAt)}
              subject={<Icon name={sourceIcon(notice.source)} size={18} color={notice.severity === 'critical' ? theme.colors.record : notice.severity === 'warning' ? theme.colors.amber : theme.colors.textSecondary}/>}
              actions={actionsFor(notice, view)} menuLabel={t('next.shell.native.moreOptions')} onMenu={() => {const service = serviceFor(notice); if (!noticeLive(service, view, notice)) return; setChosen(notice);}} style={{opacity: notice.read && view !== 'archived' ? .7 : 1}}/>;
          })}
        </View>
        {section.state.more && <View style={{alignItems: 'center', marginTop: 10}}><Button testID={`notifications-more-${section.id}`} variant="glass" size="small" loading={section.state.busy} onPress={() => {if (!viewLive(section.service, view)) return; void section.service.more().catch(runtime.reportError);}}>{t('notifications.loadMore')}</Button></View>}
      </View>)}
    </ScrollView>
    <Menu testID="notification-actions" open={chosen !== undefined} onOpenChange={open => {if (!open) setChosen(undefined);}} presentation="sheet"
      title={chosenWords?.title} description={chosenWords?.body} items={menu}/>
  </View>;
}

const sourceIcon = (source: string): IconName => source === 'downloads' ? 'i-dl'
  : source === 'dvr' ? 'i-rec'
    : source === 'feedback' ? 'i-bubble'
      : source === 'security' ? 'i-shield'
        : source === 'scan' ? 'i-refresh'
          : source === 'networking' ? 'i-wifi'
            : source === 'storage' ? 'i-disk' : 'i-bell';
