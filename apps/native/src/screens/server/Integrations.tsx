import React, {useEffect, useMemo, useState} from 'react';
import {Share, View} from 'react-native';
import {apiScopes, createAccessToken, createApiKey, createWebhook, deleteWebhook, getApiAccessOptions, listAccessTokens, listApiKeys, listMemberAccessTokens, listWebhookDeliveries, listWebhooks, revokeAccessToken, revokeApiKey, revokeMemberAccessToken, sendWebhookTest, updateWebhook, type ApiAccessOptions, type ApiCredential, type ApiCredentialPage, type ApiScope, type IssuedApiCredential, type IssuedWebhook, type NewApiCredential, type Webhook, type WebhookDelivery} from '../../../../../packages/client-core/src/api-access';
import {dependsOn} from '../../../../../packages/client-core/src/freshness-hub';
import {EXPIRY_DAYS, assistantAddress, credentialFacts, credentialMember, credentialState, credentialWorks, deliveryProblem, deliveryProgress, expiryLabel, scopeTicked, webhookEventGroups, webhookEventLabel, webhookTrouble, type ExpiryDays} from '../../../../../packages/client-core/src/server-admin/api-words';
import {createOperationIds} from '../../../../../packages/client-core/src/server-admin/server-forms';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {operationId, problem, useAction, usePagedList, useRead, type Read} from '../../app/server-console';
import {ConfirmSheet, Field, ListRow, Menu, Notice, RowGroup, Sheet, Text, ToggleRow, rowPaddingX, useSpecPlatform, useTheme, type MenuItem} from '../../ui';
import {PickRow} from '../settings/ServerForms';
import {credentialRequest, mergeDeliveries, webhookChange, webhookDraft, webhookDraftProblem, withEvents, type WebhookDraft} from './owner-rules';

// Each list follows the server's hint for it: what another device or the server itself changes shows by itself.
const API_KEY_MOVES = [dependsOn.list('apiKeys')];
const MEMBER_TOKEN_MOVES = [dependsOn.list('memberTokens')];
const OWN_TOKEN_MOVES = [dependsOn.list('accessTokens')];
const WEBHOOK_MOVES = [dependsOn.list('webhooks')];

// The owner turning members' tokens off, or changing the rate, is a change to the server's settings.
const ACCESS_OPTION_MOVES = [dependsOn.settings('server')];

/** What this server offers for keys and tokens: the scopes, how many there may be, and the rate each gets. */
function useApiAccessOptions(auto = true): Read<ApiAccessOptions> {
  const {api} = useSession();
  return useRead(() => getApiAccessOptions(api), [api], {auto, on: ACCESS_OPTION_MOVES});
}

/** The words a list uses for one kind of credential, so keys and tokens read as themselves. */
type Words = Readonly<{nameHelp: string; none: string; create: string; createTitle: string; copyTitle: string; shownOnce: string; secretLabel: string; share: string; revokeBody: string}>;

function useWords(kind: 'key' | 'token'): Words {
  const t = useI18n().t;
  return useMemo(() => (kind === 'key'
    ? {nameHelp: t('web.access.keyNameHelp'), none: t('web.access.noApiKeys'), create: t('web.access.createKey'), createTitle: t('web.access.createKeyTitle'), copyTitle: t('web.access.copyKeyTitle'), shownOnce: t('web.access.keyShownOnce'), secretLabel: t('web.access.apiKey'), share: t('server.people.shareKey'), revokeBody: t('web.access.revokeBody')}
    : {nameHelp: t('api.tokens.nameHelp'), none: t('api.tokens.none'), create: t('api.tokens.create'), createTitle: t('api.tokens.createTitle'), copyTitle: t('api.tokens.copyTitle'), shownOnce: t('api.tokens.shownOnce'), secretLabel: t('api.tokens.token'), share: t('api.tokens.share'), revokeBody: t('api.tokens.revokeBody')}), [kind, t]);
}

/**
 * A secret on the one occasion it is shown: readable in full, with the system's share sheet to
 * copy it or hand it on. Nothing keeps it after the sheet closes.
 */
function SecretRows({label, secret, share}: {label: string; secret: string; share: string}) {
  return (
    <RowGroup>
      <ListRow readable title={label} subtitle={secret} subtitleLines={6} />
      <ListRow tone="action" icon="upload" title={share} onPress={() => { void Share.share({message: secret}).catch(() => {}); }} />
    </RowGroup>
  );
}

type CredentialPages = ReturnType<typeof usePagedList<ApiCredential>>;
const credentialPage = (list: Promise<ApiCredentialPage>) => list.then(page => ({items: [...page.items], nextCursor: page.nextCursor ?? ''}));

/**
 * One list of keys or tokens: the working ones first, each with what it may do, when it was last
 * used and when it stops; the ones that no longer work behind a quiet "show" so the list stays
 * short. Creating shows the secret once. The same list serves the owner's keys, a member's own
 * tokens and the owner's view of everyone's tokens.
 */
function CredentialList({kind, title, footer, read, create, revoke, options, showMember, expander}: {
  kind: 'key' | 'token';
  title?: string;
  footer?: string;
  read: CredentialPages;
  /** Absent: this list only shows and revokes (the owner's view of members' tokens). */
  create?: (input: NewApiCredential) => Promise<IssuedApiCredential>;
  revoke: (id: string) => Promise<unknown>;
  options?: ApiAccessOptions;
  /** Name whose token each row is. */
  showMember?: boolean;
  /** A list kept out of the way until asked for: the group is one row that opens it. */
  expander?: Readonly<{title: string; open: boolean; onToggle: () => void}>;
}) {
  const i18n = useI18n();
  const t = i18n.t;
  const words = useWords(kind);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<ApiCredential>();
  const [showEnded, setShowEnded] = useState(false);
  const working = useMemo(() => read.items?.filter(credentialWorks) ?? [], [read.items]);
  const ended = useMemo(() => read.items?.filter(c => !credentialWorks(c)) ?? [], [read.items]);
  const format = {relative: (iso: string) => i18n.relativeTime(iso), date: (iso: string) => i18n.date(iso)};
  const off = kind === 'token' && !!create && !!options && !options.tokensAllowed;
  const shown = !expander || expander.open;
  const row = (c: ApiCredential) => {
    const state = credentialState(t, id => i18n.has(id), c);
    const facts = credentialFacts(t, c, format);
    return <ListRow key={c.id} icon="lock" title={c.name} subtitle={[showMember ? `${credentialMember(c)} · ${facts}` : facts, state?.text].filter(Boolean).join('\n')} subtitleLines={4} {...(credentialWorks(c) ? {accessory: 'menu' as const, onPress: () => setRevoking(c)} : {readable: true})} />;
  };
  return (
    <>
      {shown && read.error ? <Notice tone={read.items ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {/* Tokens turned off by the owner: the ones that exist are still listed and can still be revoked. */}
      {shown && off ? <Notice tone="info" message={t('api.tokens.off')} /> : null}
      <RowGroup title={expander ? undefined : title} footer={shown ? footer : undefined}>
        {expander ? <ListRow title={expander.title} trailingIcon={expander.open ? 'chevronUp' : 'chevronDown'} accessibilityState={{expanded: expander.open}} onPress={expander.onToggle} /> : null}
        {shown ? working.map(row) : null}
        {shown && read.items && !working.length ? <ListRow readable title={words.none} /> : null}
        {shown && showEnded ? ended.map(row) : null}
        {shown && ended.length ? <ListRow title={showEnded ? t('api.credential.hideEnded') : t('api.credential.showEnded', {count: ended.length})} trailingIcon={showEnded ? 'chevronUp' : 'chevronDown'} accessibilityState={{expanded: showEnded}} onPress={() => setShowEnded(v => !v)} /> : null}
        {shown && read.more ? <ListRow tone="action" title={t('server.showMore')} disabled={read.loading} onPress={read.loadMore} /> : null}
        {shown && create && !off ? <ListRow tone="action" icon="plus" title={words.create} onPress={() => setAdding(true)} /> : null}
      </RowGroup>
      {create ? <CreateCredentialSheet open={adding} onClose={() => setAdding(false)} words={words} scopes={options?.scopes.length ? options.scopes : apiScopes} create={create} onCreated={read.reload} /> : null}
      <ConfirmSheet open={!!revoking} onDismiss={() => setRevoking(undefined)} title={t('web.access.revokeTitle', {name: revoking?.name ?? ''})} consequence={words.revokeBody} confirmLabel={t('web.access.revoke')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const c = revoking; if (!c) return; await revoke(c.id); setRevoking(undefined); read.reload(); }} />
    </>
  );
}

/**
 * Create a key or token: a name, what it may do (from the scopes this server offers, each with
 * one sentence), and when it stops working. The answer is the only time the secret is seen.
 */
function CreateCredentialSheet({open, onClose, words, scopes, create, onCreated}: {open: boolean; onClose: () => void; words: Words; scopes: readonly ApiScope[]; create: (input: NewApiCredential) => Promise<IssuedApiCredential>; onCreated: () => void}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  // One ID per logical write; a retry of the same form reuses it, so the server answers with the key it already made.
  const [opIds] = useState(() => createOperationIds(operationId));
  // The moment a form was first sent decides the expiry, so a retry asks for the same key.
  const [sentAt] = useState(() => new Map<string, number>());
  const [name, setName] = useState('');
  const [ticked, setTicked] = useState<ReadonlySet<ApiScope>>(new Set(['read']));
  const [days, setDays] = useState<ExpiryDays>(0);
  const [issued, setIssued] = useState<IssuedApiCredential>();
  useEffect(() => {
    if (!open) return;
    setName(''); setTicked(new Set(scopes.includes('read') ? ['read'] : [])); setDays(0); setIssued(undefined); action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ready = !!credentialRequest({name, ticked, offered: scopes, days, firstSentAt: 0});
  const submit = () => void action.run(async () => {
    const key = JSON.stringify({name: name.trim(), scopes: scopes.filter(scope => ticked.has(scope)), days});
    if (!sentAt.has(key)) sentAt.set(key, Date.now());
    const body = credentialRequest({name, ticked, offered: scopes, days, firstSentAt: sentAt.get(key)!});
    if (!body) return;
    const out = await create({operationId: opIds.forPayload(key), ...body});
    opIds.release();
    setIssued(out);
    onCreated();
  });
  return (
    <Sheet open={open} onClose={onClose} kind={issued?.secret ? 'acknowledge' : 'form'} title={issued ? words.copyTitle : words.createTitle} cancelLabel={issued ? null : undefined}
      primary={issued ? {label: issued.secret ? t('web.access.copiedIt') : t('action.done'), onPress: onClose} : {label: t('web.saved.create'), loading: action.busy, disabled: !ready, onPress: submit}}>
      <View style={{gap: space.md}}>
        {issued?.secret ? (
          <>
            <Notice tone="warning" message={words.shownOnce} />
            <SecretRows label={words.secretLabel} secret={issued.secret} share={words.share} />
          </>
        ) : issued ? (
          // The server answers a repeated request without the secret: it exists and cannot be shown again.
          <Notice tone="warning" message={t('api.credential.secretNotShown')} />
        ) : (
          <>
            {action.error ? <Notice tone="error" message={action.error} /> : null}
            <Field label={t('profile.name')} hint={words.nameHelp} value={name} onChangeText={setName} maxLength={80} />
            <RowGroup title={t('web.access.scopeLabel')} footer={t('api.scopes.note')}>
              {scopes.map(scope => <ToggleRow key={scope} title={t(`api.scope.${scope}`)} subtitle={t(`api.scope.${scope}.help`)} value={scopeTicked(ticked, scope)} disabled={scope !== 'admin' && ticked.has('admin')} onChange={on => setTicked(prev => { const next = new Set(prev); if (on) next.add(scope); else next.delete(scope); return next; })} />)}
            </RowGroup>
            <RowGroup><PickRow title={t('api.credential.expiryLabel')} value={String(days)} options={EXPIRY_DAYS.map(d => ({id: String(d), label: expiryLabel(t, d)}))} onChange={id => setDays(Number(id) as ExpiryDays)} /></RowGroup>
          </>
        )}
      </View>
    </Sheet>
  );
}

/** Integrations › API keys: the owner's keys for scripts and other programs. A key is shown once, when it is made. */
export function APIKeysPanel() {
  const t = useI18n().t;
  const {api} = useSession();
  const options = useApiAccessOptions();
  const read = usePagedList(cursor => credentialPage(listApiKeys(api, cursor)), [api], {on: API_KEY_MOVES});
  return <CredentialList kind="key" title={t('web.access.apiKeys')} footer={`${t('server.access.keyLede')}\n\n${t('api.tokens.lifetime')}`} read={read} options={options.data} create={input => createApiKey(api, input)} revoke={id => revokeApiKey(api, id)} />;
}

/** Integrations › Members' tokens: every token a member has made for themselves, to see and to end. */
export function MemberTokensPanel() {
  const t = useI18n().t;
  const {api} = useSession();
  const read = usePagedList(cursor => credentialPage(listMemberAccessTokens(api, {cursor})), [api], {on: MEMBER_TOKEN_MOVES});
  return <CredentialList kind="token" title={t('api.tokens.memberTitle')} footer={t('api.tokens.memberLede')} read={read} revoke={id => revokeMemberAccessToken(api, id)} showMember />;
}

/**
 * Profile & account › Personal access tokens: a member's own tokens for their own scripts and
 * apps, kept out of the way until asked for. A token signs in as the member and can do only what
 * was chosen when it was made, never more than the member.
 */
export function AccessTokensPanel() {
  const t = useI18n().t;
  const {api} = useSession();
  const [open, setOpen] = useState(false);
  const options = useApiAccessOptions(open);
  const read = usePagedList(cursor => credentialPage(listAccessTokens(api, cursor)), [api], {auto: open, on: OWN_TOKEN_MOVES});
  const limit = options.data ? `${t('api.credential.limitNote', {count: options.data.requestsPerMinute})} ` : '';
  return <CredentialList kind="token" footer={`${t('api.tokens.lede')}\n\n${limit}${t('api.tokens.lifetime')}`} read={read} options={options.data} create={input => createAccessToken(api, input)} revoke={id => revokeAccessToken(api, id)} expander={{title: t('api.tokens.title'), open, onToggle: () => setOpen(v => !v)}} />;
}

/**
 * Integrations › Webhooks: messages this server sends to another service when something
 * happens. A webhook opens to its menu; adding and editing are one sheet (whether it sends, its
 * name, its address, the events by group); the signing secret is shown once, when it is made or
 * replaced; the delivery log says what was sent and whether it arrived.
 */
export function WebhooksPanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {space} = useTheme();
  const {api} = useSession();
  // Whether each one is arriving changes as the server delivers; nothing on the feed says so.
  const read = useRead(() => listWebhooks(api), [api], {on: WEBHOOK_MOVES});
  const action = useAction();
  const [menu, setMenu] = useState<Webhook>();
  const [editing, setEditing] = useState<{webhook?: Webhook}>();
  const [issued, setIssued] = useState<IssuedWebhook>();
  const [removing, setRemoving] = useState<Webhook>();
  const [rotating, setRotating] = useState<Webhook>();
  const [log, setLog] = useState<Webhook>();
  const [queued, setQueued] = useState(false);
  const list = read.data;
  const full = !!list && list.items.length >= list.maximum;
  const saved = (out: IssuedWebhook) => { if (out.secret) setIssued(out); read.reload(); };
  const items = (w: Webhook): MenuItem[] => [
    {id: 'edit', label: t('web.selection.edit'), icon: 'edit'},
    {id: 'test', label: t('api.webhooks.sendTest'), icon: 'play', disabled: !w.enabled},
    {id: 'log', label: t('api.webhooks.log'), icon: 'logs'},
    {id: 'rotate', label: t('api.webhooks.rotate'), icon: 'refresh'},
    {id: 'remove', label: t('action.removeShort'), icon: 'trash', destructive: true},
  ];
  const select = (w: Webhook, id: string) => {
    action.clear(); setQueued(false);
    if (id === 'edit') setEditing({webhook: w});
    else if (id === 'log') setLog(w);
    else if (id === 'rotate') setRotating(w);
    else if (id === 'remove') setRemoving(w);
    else if (id === 'test') void action.run(async () => { await sendWebhookTest(api, w.id); read.reload(); }).then(ok => { if (ok) { setQueued(true); setLog(w); } });
  };
  return (
    <>
      {read.error && !list ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {action.error && !editing && !rotating ? <Notice tone="error" message={action.error} /> : null}
      <RowGroup title={t('api.webhooks.title')} footer={full ? `${t('api.webhooks.lede')}\n\n${t('api.webhooks.full', {count: list.maximum})}` : t('api.webhooks.lede')}>
        {list?.items.map(w => <ListRow key={w.id} icon="link" title={w.name} meta={w.enabled ? undefined : t('api.webhooks.off')} subtitle={[`${w.url} · ${t('api.webhooks.eventCount', {count: w.events.length})}`, webhookTrouble(t, w)?.text].filter(Boolean).join('\n')} subtitleLines={4} accessory="menu" onPress={() => setMenu(w)} />)}
        {list && !list.items.length ? <ListRow readable title={t('api.webhooks.none')} /> : null}
        {list && !full ? <ListRow tone="action" icon="plus" title={t('api.webhooks.add')} onPress={() => { action.clear(); setEditing({}); }} /> : null}
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.name} subtitle={menu?.url} items={menu ? items(menu) : []} onSelect={id => { if (menu) select(menu, id); }} />
      <WebhookSheet open={!!editing} webhook={editing?.webhook} offered={list?.events ?? []} busy={action.busy} error={action.error} onClose={() => setEditing(undefined)}
        onSave={draft => void action.run(async () => {
          const w = editing?.webhook;
          if (!w) { saved(await createWebhook(api, {name: draft.name.trim(), url: draft.url.trim(), events: draft.events, ...(draft.secret ? {secret: draft.secret} : {})})); return; }
          const change = webhookChange(w, draft);
          if (change) saved(await updateWebhook(api, w.id, change));
        }).then(ok => { if (ok) setEditing(undefined); })} />
      <Sheet open={!!issued?.secret} onClose={() => setIssued(undefined)} kind="acknowledge" title={t('api.webhooks.secretTitle')} primary={{label: t('web.access.copiedIt'), onPress: () => setIssued(undefined)}}>
        <View style={{gap: space.md}}>
          <Notice tone="warning" message={t('api.webhooks.secretShownOnce')} />
          <SecretRows label={t('api.webhooks.secret')} secret={issued?.secret ?? ''} share={t('api.webhooks.shareSecret')} />
        </View>
      </Sheet>
      <RotateSheet webhook={rotating} busy={action.busy} error={action.error} onClose={() => setRotating(undefined)}
        onRotate={secret => void action.run(async () => { if (rotating) saved(await updateWebhook(api, rotating.id, {rotateSecret: true, ...(secret ? {secret} : {})})); }).then(ok => { if (ok) setRotating(undefined); })} />
      <ConfirmSheet open={!!removing} onDismiss={() => setRemoving(undefined)} title={t('api.webhooks.removeTitle', {name: removing?.name ?? ''})} consequence={t('api.webhooks.removeBody')} confirmLabel={t('action.removeShort')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const w = removing; if (!w) return; await deleteWebhook(api, w.id); setRemoving(undefined); read.reload(); }} />
      <DeliveryLogSheet webhook={log} queued={queued} onClose={() => { setLog(undefined); setQueued(false); read.reload(); }} />
    </>
  );
}

/** Add or edit: whether it sends, its name, its address, and what to send, chosen from the events this server offers. */
function WebhookSheet({open, webhook, offered, busy, error, onClose, onSave}: {open: boolean; webhook?: Webhook; offered: readonly string[]; busy: boolean; error: string; onClose: () => void; onSave: (draft: WebhookDraft) => void}) {
  const i18n = useI18n();
  const t = i18n.t;
  const {space} = useTheme();
  const pad = rowPaddingX(useSpecPlatform());
  const [draft, setDraft] = useState<WebhookDraft>(() => webhookDraft());
  // Filled when the sheet opens for a webhook; the list reading itself again must not clear what is being typed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setDraft(webhookDraft(webhook)); }, [open, webhook?.id]);
  // An event this webhook already has stays in the list even if the server no longer offers it, so saving never drops it unseen.
  const groups = useMemo(() => webhookEventGroups([...offered, ...(webhook?.events ?? [])]), [offered, webhook]);
  const has = (event: string) => draft.events.includes(event);
  const set = (events: readonly string[], on: boolean) => setDraft(d => ({...d, events: withEvents(d.events, events, on)}));
  const trouble = webhookDraftProblem(draft);
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={webhook ? t('api.webhooks.editTitle') : t('api.webhooks.add')} primary={{label: webhook ? t('action.save') : t('api.webhooks.add'), loading: busy, disabled: !!trouble, onPress: () => onSave(draft)}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        {webhook ? <RowGroup><ToggleRow title={t('api.webhooks.turnOn', {name: webhook.name})} value={draft.enabled} onChange={enabled => setDraft(d => ({...d, enabled}))} /></RowGroup> : null}
        <Field label={t('profile.name')} value={draft.name} onChangeText={name => setDraft(d => ({...d, name}))} maxLength={120} />
        <Field label={t('api.webhooks.url')} hint={t('api.webhooks.urlHelp')} error={trouble === 'addressInvalid' ? t('api.webhooks.urlProblem') : undefined} value={draft.url} onChangeText={url => setDraft(d => ({...d, url}))} placeholder="https://example.com/hooks/portico" autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2048} />
        <Text variant="label" tone="tertiary" style={{paddingHorizontal: pad}}>{t('api.webhooks.events')}</Text>
        {groups.map(group => {
          const all = group.events.every(has);
          return (
            <RowGroup key={group.id} title={t(group.label)}>
              {group.events.map(event => <ToggleRow key={event} title={webhookEventLabel(t, id => i18n.has(id), event)} value={has(event)} onChange={on => set([event], on)} />)}
              {group.events.length > 1 ? <ListRow tone="action" title={t(all ? 'api.webhooks.groupNoneOf' : 'api.webhooks.groupAllOf', {group: t(group.label)})} onPress={() => set(group.events, !all)} /> : null}
            </RowGroup>
          );
        })}
        {webhook
          ? <Text variant="caption" tone="tertiary" style={{paddingHorizontal: pad}}>{t('api.webhooks.secretKept', {hint: webhook.secretHint})}</Text>
          : <Field label={t('api.webhooks.secret')} hint={t('api.webhooks.secretHelp')} secure value={draft.secret} onChangeText={secret => setDraft(d => ({...d, secret}))} autoCapitalize="none" autoCorrect={false} maxLength={200} />}
      </View>
    </Sheet>
  );
}

/** Replace the secret: the old one stops being used at once, so the other service has to be given the new one. */
function RotateSheet({webhook, busy, error, onClose, onRotate}: {webhook?: Webhook; busy: boolean; error: string; onClose: () => void; onRotate: (secret: string) => void}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const [secret, setSecret] = useState('');
  useEffect(() => { if (webhook) setSecret(''); }, [webhook]);
  return (
    <Sheet open={!!webhook} onClose={onClose} kind="form" title={t('api.webhooks.rotateTitle', {name: webhook?.name ?? ''})} subtitle={t('api.webhooks.rotateBody')} primary={{label: t('api.webhooks.rotate'), loading: busy, onPress: () => onRotate(secret)}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        <Field label={t('api.webhooks.secret')} hint={t('api.webhooks.secretHelp')} secure value={secret} onChangeText={setSecret} autoCapitalize="none" autoCorrect={false} maxLength={200} />
      </View>
    </Sheet>
  );
}

const DELIVERY_POLL_MS = 4000;
const deliveryState: Readonly<Record<WebhookDelivery['state'], MessageId>> = {pending: 'api.webhooks.delivery.pending', delivered: 'api.webhooks.delivery.delivered', failed: 'api.webhooks.delivery.failed'};

/**
 * The delivery log, newest first: what was sent, whether it arrived, and for one that has not,
 * why and when the server tries again. It keeps itself current while anything is still waiting.
 */
function DeliveryLogSheet({webhook, queued, onClose}: {webhook?: Webhook; /** A test was just asked for: say so above the log. */ queued: boolean; onClose: () => void}) {
  const i18n = useI18n();
  const t = i18n.t;
  const {space} = useTheme();
  const {api} = useSession();
  const id = webhook?.id;
  const [rows, setRows] = useState<readonly WebhookDelivery[]>();
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // The first page is read again while something waits; older pages already shown are kept under it.
  const load = (from: string, quiet = false) => {
    if (!id) return;
    if (!quiet) { setLoading(true); setError(''); }
    listWebhookDeliveries(api, id, {cursor: from || undefined, limit: 50}).then(page => {
      setRows(shown => mergeDeliveries(shown, page.items, !!from));
      if (from) setCursor(page.nextCursor ?? ''); else setCursor(current => current || (page.nextCursor ?? ''));
    }, e => { if (!quiet) setError(problem(e)); }).finally(() => { if (!quiet) setLoading(false); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(undefined); setCursor(''); setError(''); if (id) load(''); }, [api, id]);
  const waiting = !!id && (queued || !!rows?.some(d => d.state === 'pending'));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => load('', true), DELIVERY_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, api, id]);
  return (
    <Sheet open={!!webhook} onClose={onClose} kind="form" cancelLabel={t('action.done')} title={t('api.webhooks.log')} subtitle={webhook?.name} primary={{label: t('action.refresh'), loading, onPress: () => load('')}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} action={t('action.tryAgain')} onAction={() => load('')} /> : null}
        {queued && !rows?.length ? <Notice tone="info" message={t('api.webhooks.testQueued')} /> : null}
        {rows ? (
          <RowGroup>
            {rows.map(d => (
              <ListRow key={d.id} readable title={d.event === 'webhook.test' ? t('api.webhooks.testEvent') : webhookEventLabel(t, key => i18n.has(key), d.event)} meta={t(deliveryState[d.state])} subtitleLines={4}
                subtitle={[[i18n.dateTime(d.finishedAt ?? d.createdAt), deliveryProgress(t, d, iso => i18n.time(iso))].filter(Boolean).join(' · '), deliveryProblem(t, key => i18n.has(key), d)].filter(Boolean).join('\n')} />
            ))}
            {!rows.length ? <ListRow readable title={t('api.webhooks.logEmpty')} /> : null}
            {cursor && rows.length ? <ListRow tone="action" title={t('server.showMore')} disabled={loading} onPress={() => load(cursor)} /> : null}
          </RowGroup>
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Integrations › Assistants: what it is, the address to give an assistant, and the key it
 * needs. There is nothing to turn on: the address answers only to an API key or a personal
 * access token, and an assistant can do only what that key allows.
 */
export function AssistantsPanel() {
  const t = useI18n().t;
  const {api} = useSession();
  const address = assistantAddress(api.baseUrl);
  return (
    <RowGroup title={t('api.mcp.title')} footer={t('api.mcp.lede')}>
      <ListRow readable icon="link" title={t('api.mcp.address')} subtitle={`${address}\n${t('api.mcp.addressHelp')}`} subtitleLines={8} />
      <ListRow tone="action" icon="upload" title={t('api.mcp.shareAddress')} onPress={() => { void Share.share({message: address}).catch(() => {}); }} />
      <ListRow readable icon="lock" title={t('api.mcp.key')} subtitle={t('api.mcp.keyHelp')} subtitleLines={8} />
    </RowGroup>
  );
}
