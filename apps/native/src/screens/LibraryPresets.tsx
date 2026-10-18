import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {savedViewBrowse, type PersonalResource, type PersonalSavedService} from '../../../../packages/client-core/src/personal-saved';
import {isUnconfirmed, useLibraryPresets, type LibraryPresets} from '../app/library-presets';
import {viewerScope} from '../app/content';
import {requestId} from '../app/detail';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {useFreshDocument} from '../app/freshness';
import {titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';

/** A saved view saved, renamed or deleted on another device moves this profile's personal state, as on Saved. */
const presetDependencies = Object.freeze([...titlesWithPersonalState()]);
import {Button, Field, Menu, Notice, Sheet, Text, useTheme, type MenuItem} from '../ui';

/** A library's presets on this screen's viewer (`useLibraryPresets`). */
export function useScreenPresets(libraryId: string, pivot: string | undefined, enabled: boolean): LibraryPresets {
  const session = useSession();
  const scope = useMemo(() => viewerScope(session.session, session.api), [session.session, session.api]);
  const presets = useLibraryPresets({api: session.api, scope, requestId, libraryId, pivot, enabled});
  // Kept current while the library is in front, read quietly in place, never over a change on its way.
  useFreshDocument(presetDependencies, context => presets.refresh(context), () => !!presets.service?.getSnapshot().viewerFence);
  return presets;
}
/** The words for a change that failed: an earlier unconfirmed one in the way, or the server's answer. */
export const changeError = (i18n: ReturnType<typeof useI18n>, e: unknown) => (isUnconfirmed(e) ? i18n.t('lib.savedViewUnconfirmed') : say(e, 'library', 'save'));

/** What an unconfirmed change was, in words: what it would have done to which view. */
export function heldText(i18n: ReturnType<typeof useI18n>, held: NonNullable<ReturnType<PersonalSavedService['unconfirmed']>>): string {
  const intent = held.intent;
  if (intent.action === 'create') return i18n.t('lib.savedViewHeldCreate', {name: intent.name});
  if (intent.action === 'delete') return i18n.t('lib.savedViewHeldDelete', {name: held.resourceName ?? ''});
  return i18n.t('lib.savedViewHeldRename', {name: held.resourceName ?? '', to: intent.action === 'update' ? intent.name ?? '' : ''});
}

/**
 * The toolbar's Saved views: a button that opens the library's saved views to apply one, and to
 * manage them. One that needs review is listed, explained and never applied.
 */
export function SavedViewsButton({presets, onApply}: {presets: LibraryPresets; onApply: (row: PersonalResource) => void}) {
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const snap = presets.snapshot;
  const rows = snap?.resources ?? [];
  const items: MenuItem[] = snap?.loading && !rows.length ? [{id: ':loading', label: i18n.t('lib.savedViewsLoading'), disabled: true}]
    : snap?.error && !rows.length ? [{id: ':retry', label: i18n.t('lib.savedViewsFailed'), detail: i18n.t('action.tryAgain'), icon: 'refresh'}]
    : !rows.length ? [{id: ':empty', label: i18n.t('lib.savedViewsEmpty'), disabled: true}]
    : rows.map(r => (savedViewBrowse(r) ? {id: r.id, label: r.name, icon: 'bookmark'} : {id: r.id, label: r.name, detail: i18n.t('lib.savedViewReview'), disabled: true}));
  // The list was read again from the top (it changed since the page before), and a change still unconfirmed, before the views.
  if (snap?.restarted && rows.length) items.unshift({id: ':restarted', label: i18n.t('lib.savedViewsRestarted'), disabled: true});
  if (presets.unconfirmed) items.unshift({id: ':held', label: i18n.t('lib.savedViewHeld'), detail: i18n.t('lib.savedViewsManage'), icon: 'warning'});
  // A page at a time: the ones before and after, and a page that could not be read says so.
  if (rows.length && snap?.error) items.push({id: ':retry-page', label: i18n.t('lib.savedViewsFailed'), detail: i18n.t('action.tryAgain'), icon: 'refresh', section: ''});
  if (snap && !snap.history.length && snap.cursor !== null) items.push({id: ':first', label: i18n.t('lib.savedViewsFirst'), icon: 'chevronUp', section: ''});
  if (snap?.history.length) items.push({id: ':previous', label: i18n.t('lib.savedViewsPrevious'), icon: 'chevronUp', section: ''});
  if (snap?.nextCursor) items.push({id: ':next', label: i18n.t('lib.savedViewsMore'), icon: 'chevronDown', ...(snap.history.length ? {} : {section: ''})});
  if (rows.length || presets.unconfirmed) items.push({id: ':manage', label: i18n.t('lib.savedViewsManage'), icon: 'settings', section: ''});
  const choose = (id: string) => {
    // Paging (and reading a page again) opens the list again on that page: a menu closes on any choice.
    const page = id === ':next' ? presets.service?.next : id === ':previous' ? presets.service?.previous : id === ':first' ? presets.service?.first : id === ':retry-page' ? presets.service?.retryRead : undefined;
    setOpen(false);
    if (page) { void page(); setTimeout(() => setOpen(true), 0); return; }
    if (id === ':manage' || id === ':held') setManaging(true);
    else if (id === ':retry') void presets.service?.refresh();
    else { const row = rows.find(r => r.id === id); if (row && savedViewBrowse(row)) onApply(row); }
  };
  return (
    <>
      {/* Opening it reads the list again quietly, so a view saved on another device is there. */}
      <Button size="sm" variant="secondary" icon="bookmark" label={i18n.t('lib.savedViews')} onPress={() => { presets.opened(); setOpen(true); }} />
      <Menu open={open} onClose={() => setOpen(false)} title={i18n.t('lib.savedViews')} items={items} onSelect={choose} />
      <ManageSavedViews open={managing} onClose={() => setManaging(false)} presets={presets} />
    </>
  );
}

/**
 * Rename and delete a library's saved views from their rows; one that needs review says why. A
 * change that got no answer is shown above the rows, whatever page is in view and whether or not
 * its row is still listed (the change may already have happened): Try again sends it again exactly
 * as it was, Set aside forgets it. No other change is offered until one of them is chosen.
 */
export function ManageSavedViews({open, onClose, presets}: {open: boolean; onClose: () => void; presets: LibraryPresets}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const rows = presets.snapshot?.resources ?? [];
  const [editing, setEditing] = useState<{id: string; name: string} | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!open) { setEditing(null); setConfirming(null); setError(''); } }, [open]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); setEditing(null); setConfirming(null); }
    catch (e) {
      // No answer: the change is held, and offered above the rows rather than in its row.
      if (presets.service?.unconfirmed()) { setEditing(null); setConfirming(null); } else setError(changeError(i18n, e));
    } finally { setBusy(false); }
  };
  const held = presets.unconfirmed;
  const snap = presets.snapshot;
  const locked = busy || !!held;
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('lib.savedViewsManage')} subtitle={i18n.t('lib.savedViewsManageLede')} kind="form" cancelLabel={null} primary={{label: i18n.t('lib.done'), onPress: onClose}}>
      <View style={{gap: space.md}}>
        {held ? (
          <View style={{gap: space.sm}}>
            <Notice tone="warning" message={heldText(i18n, held)} />
            <View style={{flexDirection: 'row', gap: space.sm}}>
              <Button size="sm" variant="secondary" label={i18n.t('lib.savedViewSetAside')} disabled={busy} onPress={presets.discard} />
              <Button size="sm" variant="primary" label={i18n.t('action.tryAgain')} loading={busy} onPress={() => void run(presets.retryHeld)} />
            </View>
          </View>
        ) : null}
        {error ? <Notice tone="error" message={error} /> : null}
        {snap?.restarted && rows.length ? <Notice tone="info" message={i18n.t('lib.savedViewsRestarted')} /> : null}
        {rows.map(row => {
          if (editing?.id === row.id) {
            const name = editing.name.trim();
            return (
              <View key={row.id} style={{gap: space.sm}}>
                <Field label={i18n.t('lib.saveViewName')} value={editing.name} maxLength={200} onChangeText={text => setEditing({id: row.id, name: text})} returnKeyType="done" onSubmitEditing={() => { if (name && !locked) void run(() => presets.rename(row, name)); }} />
                <View style={{flexDirection: 'row', gap: space.sm}}>
                  <Button size="sm" variant="secondary" label={i18n.t('lib.cancel')} disabled={busy} onPress={() => setEditing(null)} />
                  <Button size="sm" variant="primary" label={i18n.t('lib.save')} loading={busy} disabled={!name || locked} onPress={() => void run(() => presets.rename(row, name))} />
                </View>
              </View>
            );
          }
          if (confirming === row.id) return (
            <View key={row.id} style={{gap: space.sm}}>
              <Text variant="body">{i18n.t('lib.deleteSavedView', {name: row.name})}</Text>
              <View style={{flexDirection: 'row', gap: space.sm}}>
                <Button size="sm" variant="secondary" label={i18n.t('lib.cancel')} disabled={busy} onPress={() => setConfirming(null)} />
                <Button size="sm" variant="destructive" label={i18n.t('lib.delete')} loading={busy} disabled={locked} onPress={() => void run(() => presets.remove(row))} />
              </View>
            </View>
          );
          return (
            <View key={row.id} style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
              <View style={{flex: 1, minWidth: 0}}>
                <Text variant="body" lines={1}>{row.name}</Text>
                {savedViewBrowse(row) ? null : <Text variant="caption" tone="tertiary">{i18n.t('lib.savedViewReviewHelp')}</Text>}
              </View>
              {row.actions.includes('update') ? <Button size="sm" variant="ghost" label={i18n.t('lib.rename')} disabled={locked} onPress={() => setEditing({id: row.id, name: row.name})} /> : null}
              {row.actions.includes('delete') ? <Button size="sm" variant="ghost" label={i18n.t('lib.delete')} disabled={locked} onPress={() => setConfirming(row.id)} /> : null}
            </View>
          );
        })}
        {snap?.history.length || snap?.nextCursor || (snap && snap.cursor !== null) ? (
          <View style={{flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end'}}>
            {!snap.history.length && snap.cursor !== null ? <Button size="sm" variant="ghost" icon="chevronUp" label={i18n.t('lib.savedViewsFirst')} disabled={busy || snap.loading} onPress={() => void presets.service?.first()} /> : null}
            {snap.history.length ? <Button size="sm" variant="ghost" icon="chevronUp" label={i18n.t('lib.savedViewsPrevious')} disabled={busy || snap.loading} onPress={() => void presets.service?.previous()} /> : null}
            {snap.nextCursor ? <Button size="sm" variant="ghost" icon="chevronDown" label={i18n.t('lib.savedViewsMore')} disabled={busy || snap.loading} onPress={() => void presets.service?.next()} /> : null}
          </View>
        ) : null}
        {snap?.error ? <Notice tone="error" message={i18n.t('lib.savedViewsFailed')} action={i18n.t('action.tryAgain')} onAction={() => void presets.service?.retryRead()} /> : null}
      </View>
    </Sheet>
  );
}
