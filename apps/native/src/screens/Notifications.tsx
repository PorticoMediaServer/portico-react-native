import React, {useEffect, useState, useSyncExternalStore, useMemo} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {FeedbackService, type FeedbackDraft, type InboxView, type Notification, type NotificationAudience} from '../../../../packages/client-core/src/index';
import {useInbox} from '../app/inbox';
import {useSession} from '../app/session';
import {Badge, Button, Divider, Field, ListRow, Menu, Notice, Page, PageHeader, RowGroup, Segmented, Sheet, StateView, Surface, Text, useEntryFocus, useTheme, type IconName, type MenuItem} from '../ui';
import {useI18n} from '../app/i18n';
import {AccountFeed} from './AccountFeed';

const severityIcon: Record<Notification['severity'], IconName> = {info: 'bell', warning: 'warning', critical: 'error'};

/** The server-owned inbox for this viewer. Pressing a message offers what can be done with
 * it; a long list of buttons per row does not work with a remote or a thumb. */
export function NotificationsScreen() {
  const {service, state} = useInbox();
  const navigation = useNavigation();
  const i18n = useI18n();
  const {space, isTV} = useTheme();
  const entry = useEntryFocus(state.phase !== 'loading');
  const [chosen, setChosen] = useState<Notification>();
  useEffect(() => { void service?.load(); }, [service]);
  if (!service) return null;
  const views = [{id: 'unread', label: i18n.t('notifications.view.unread')}, {id: 'all', label: i18n.t('notifications.view.all')}, {id: 'archived', label: i18n.t('notifications.view.archived')}];
  const audienceLabel = (a: NotificationAudience) => i18n.t(a === 'profile' ? 'notifications.audience.profile' : 'notifications.audience.admin');
  const empty = i18n.t(state.view === 'unread' ? 'notifications.caughtUp' : state.view === 'archived' ? 'notifications.noneArchived' : 'notifications.none');
  const actions: MenuItem[] = chosen ? [
    ...(state.view !== 'archived' ? [{id: chosen.read ? 'unread' : 'read', label: i18n.t(chosen.read ? 'notifications.markUnread' : 'notifications.markRead'), icon: (chosen.read ? 'markUnread' : 'check') as IconName}] : []),
    {id: chosen.archived ? 'unarchive' : 'archive', label: i18n.t(chosen.archived ? 'notifications.unarchive' : 'notifications.archive'), icon: 'archive'},
  ] : [];
  return (
    <View style={{flex: 1}}>
      <Page>
        <PageHeader title={i18n.t('notifications.title')} eyebrow={i18n.t('notifications.fromServer')} onBack={() => navigation.goBack()} />
        <View style={{paddingHorizontal: space.page, gap: space.lg}}>
          {/* Portico Account sign-ins: the account's own notices come first (BE-hosted feed). */}
          <AccountFeed />
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center'}}>
            {state.audiences.length > 1 ? <Segmented items={state.audiences.map(a => ({id: a, label: audienceLabel(a)}))} selected={state.audience} onSelect={id => void service.load(id as NotificationAudience, state.view)} /> : null}
            <Segmented items={views} selected={state.view} onSelect={id => void service.load(state.audience, id as InboxView)} />
            {state.counts.unread > 0 && state.view !== 'archived' ? <Button variant="ghost" size="sm" icon="check" label={i18n.t('notifications.markAllRead')} onPress={() => void service.readAll()} /> : null}
          </View>
          {state.error && state.items.length ? <Notice tone="warning" message={state.error} action={i18n.t('action.tryAgain')} onAction={() => void service.load()} /> : null}
          {state.phase === 'loading' && !state.items.length ? <StateView loading title={i18n.t('notifications.loading')} /> : null}
          {state.phase === 'error' ? <StateView icon="error" title={i18n.t('notifications.error.load')} message={state.error} action={i18n.t('action.tryAgain')} onAction={() => void service.load()} /> : null}
          {state.phase === 'ready' && !state.items.length ? <StateView icon={state.view === 'archived' ? 'archive' : 'bell'} title={empty} message={i18n.t('notifications.emptyBody')} /> : null}
          {state.items.length ? (
            <RowGroup>
              {state.items.map((n, index) => (
                <ListRow key={n.id} hasTVPreferredFocus={isTV && entry && index === 0} icon={severityIcon[n.severity]} title={n.title} subtitle={n.body || undefined} meta={i18n.relativeTime(n.createdAt)} trailing={!n.read ? <Badge label={i18n.t('notifications.new')} tone="accent" /> : undefined} style={{opacity: n.read && state.view !== 'archived' ? 0.7 : 1}} accessory="menu" onPress={() => setChosen(n)} />
              ))}
            </RowGroup>
          ) : null}
          {state.more ? <Button variant="secondary" label={i18n.t('notifications.loadMore')} loading={state.busy} onPress={() => void service.more()} /> : null}
        </View>
      </Page>
      <Menu open={!!chosen} onClose={() => setChosen(undefined)} title={chosen?.title} subtitle={chosen?.body || undefined} items={actions} onSelect={id => { if (chosen) void service.apply(id as 'read' | 'unread' | 'archive' | 'unarchive', [chosen.id]); setChosen(undefined); }} />
    </View>
  );
}

/** Report a problem, opened from the player with what was playing. What someone typed
 * survives a failed send. Not offered on Apple TV: there is no comfortable way to type it. */
export function FeedbackSheet({open, onClose, itemId, playbackSessionId, title}: {open: boolean; onClose: () => void; itemId?: string; playbackSessionId?: string; title?: string}) {
  const {api} = useSession();
  const {space} = useTheme();
  const i18n = useI18n();
  // A fresh service (and draft state) each time the sheet opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const service = useMemo(() => new FeedbackService(api!), [api, open]);
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const [draft, setDraft] = useState<FeedbackDraft>({kind: '', category: '', message: '', attachDiagnostics: true});
  const [picking, setPicking] = useState<'kind' | 'category'>();
  useEffect(() => { if (open) void service.open(); }, [open, service]);
  const capabilities = state.capabilities;
  useEffect(() => {
    if (!capabilities || draft.kind) return;
    const kind = (playbackSessionId ? capabilities.kinds.find(k => k.categories.some(c => c.wantsPlaybackSession)) : undefined) ?? capabilities.kinds[0];
    setDraft(d => ({...d, kind: kind.id, category: kind.categories[0].id}));
  }, [capabilities, draft.kind, playbackSessionId]);
  const kind = capabilities?.kinds.find(k => k.id === draft.kind);
  const category = kind?.categories.find(c => c.id === draft.category);
  const complete = {...draft, itemId, playbackSessionId};
  const problem = capabilities ? service.problem(complete) : '';
  if (state.phase === 'sent') {
    return (
      <Sheet open={open} onClose={onClose} kind="acknowledge" title={i18n.t(state.result?.duplicate ? 'feedback.duplicateTitle' : 'feedback.sentTitle')} primary={{label: i18n.t('action.done'), onPress: onClose}}>
        <Text variant="body" tone="secondary">{i18n.t(state.result?.duplicate ? 'feedback.duplicateBody' : 'feedback.sentBody')}</Text>
      </Sheet>
    );
  }
  return (
    <>
      <Sheet open={open && !picking} onClose={onClose} title={i18n.t('feedback.title')} subtitle={title ? i18n.t('feedback.about', {title}) : undefined} kind="form"
        cancelLabel={state.phase === 'unavailable' ? i18n.t('action.close') : undefined}
        primary={state.phase === 'unavailable' ? undefined : {label: i18n.t('feedback.send'), loading: state.phase === 'sending', disabled: !!problem || (state.phase !== 'ready' && state.phase !== 'sending'), onPress: () => void service.submit(complete)}}>
        {state.phase === 'loading' ? <StateView loading title={i18n.t('feedback.loading')} /> : null}
        {state.phase === 'unavailable' ? <Notice tone="info" message={state.error ?? i18n.t('feedback.unavailable')} /> : null}
        {capabilities && state.phase !== 'unavailable' && state.phase !== 'loading' ? (
          <View style={{gap: space.md}}>
            {state.error ? <Notice tone="error" message={state.error} /> : null}
            <Surface padded={false}>
              <ListRow title={i18n.t('feedback.kind')} meta={kind?.label} trailingIcon="forward" onPress={() => setPicking('kind')} />
              <Divider inset={space.md} />
              <ListRow title={i18n.t('feedback.category')} meta={category?.label} subtitle={category?.description} trailingIcon="forward" onPress={() => setPicking('category')} />
            </Surface>
            {/* CD-46: code points, not UTF-16 units — and the field allows twice the units so a
              valid 2000-code-point astral message is never truncated by the input itself. */}
            <Field label={i18n.t('feedback.message')} multiline numberOfLines={5} maxLength={capabilities.maxMessageLength * 2} value={draft.message} onChangeText={message => setDraft(d => ({...d, message}))} placeholder={i18n.t('feedback.messagePlaceholder')} hint={draft.message ? problem || i18n.t('feedback.length', {count: Array.from(draft.message.trim()).length, max: capabilities.maxMessageLength}) : undefined} />
            {capabilities.diagnosticsSupported && category?.wantsPlaybackSession && playbackSessionId ? (
              <Surface padded={false}><ListRow title={i18n.t('feedback.diagnostics')} subtitle={i18n.t('feedback.diagnosticsHelp')} icon={draft.attachDiagnostics ? 'check' : undefined} onPress={capabilities.diagnosticsOptional ? () => setDraft(d => ({...d, attachDiagnostics: !d.attachDiagnostics})) : undefined} /></Surface>
            ) : null}
            <Text variant="caption" tone="tertiary">{i18n.t('feedback.sentAs', {name: capabilities.reporterName})}</Text>
          </View>
        ) : null}
      </Sheet>
      <Menu open={picking === 'kind'} onClose={() => setPicking(undefined)} title={i18n.t('feedback.kind')} items={(capabilities?.kinds ?? []).map(k => ({id: k.id, label: k.label}))} onSelect={id => { const next = capabilities?.kinds.find(k => k.id === id); if (next) setDraft(d => ({...d, kind: next.id, category: next.categories[0].id})); setPicking(undefined); }} />
      <Menu open={picking === 'category'} onClose={() => setPicking(undefined)} title={i18n.t('feedback.category')} items={(kind?.categories ?? []).map(c => ({id: c.id, label: c.label}))} onSelect={id => { setDraft(d => ({...d, category: id})); setPicking(undefined); }} />
    </>
  );
}
