import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {homeViewResourceId, homeViewRowId, isPersonalRowId, type HomeLayoutView} from '../../../../packages/client-core/src/home';
import {serverTextLabel} from '../../../../packages/client-core/src/presentation/server-text';
import {PersonalSavedService, type PersonalSavedSnapshot} from '../../../../packages/client-core/src/personal-saved';
import {viewerScope} from '../app/content';
import {requestId} from '../app/detail';
import {useSession} from '../app/session';
import {Button, ConfirmSheet, Divider, ListRow, Notice, Sheet, StateView, Surface, Switch, Text, useTheme} from '../ui';
import {useI18n} from '../app/i18n';
import {say} from '../app/errors';

/**
 * Row order and visibility on handheld and TV. The rows come from
 * GET /v1/home/layout (every row this viewer could have, in the viewer's
 * order); the server says which rows may move or hide; this sheet arranges
 * the rest and saves one fenced layout.
 */
export function customiseLists(view: HomeLayoutView): {order: string[]; hidden: string[]} {
  // P7: Picks for you is one row (`for_you`); its generators are never listed.
  const rows = view.rows.filter(r => !isPersonalRowId(r.id));
  return {order: rows.map(r => r.id), hidden: rows.filter(r => r.hidden).map(r => r.id)};
}

export function customiseSavePayload(view: HomeLayoutView, order: readonly string[], hidden: readonly string[]): {rowOrder: string[]; hiddenRowIds: string[]; expectedRevision: number} {
  return {rowOrder: order.filter(id => view.rows.find(r => r.id === id)?.reorderable !== false), hiddenRowIds: hidden.filter(id => order.includes(id) || !homeViewResourceId(id)), expectedRevision: view.revision};
}

/** P6: a saved view added to Home goes last; one already there isn't added twice. */
export function addViewRow(order: readonly string[], resourceId: string): string[] {
  const id = homeViewRowId(resourceId);
  return order.includes(id) ? [...order] : [...order, id];
}

/** Removing a saved view from Home drops its id from the order (and from the hidden set). */
export function removeViewRow(order: readonly string[], hidden: ReadonlySet<string>, id: string): {order: string[]; hidden: Set<string>} {
  const next = new Set(hidden);
  next.delete(id);
  return {order: order.filter(x => x !== id), hidden: next};
}

export function HomeCustomise({open, onClose, onSave, onReset, loadLayout}: {open: boolean; onClose: () => void; onSave: (order: readonly string[], hidden: readonly string[], expectedRevision?: number) => Promise<unknown>; onReset: () => Promise<unknown>; loadLayout: (signal?: AbortSignal) => Promise<HomeLayoutView>}) {
  const {space} = useTheme();
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmReset, setConfirmReset] = useState(false);
  const [view, setView] = useState<HomeLayoutView | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(undefined);
  const [attempt, setAttempt] = useState(0);
  const i18n = useI18n();
  // P6: saved views added in this sheet, by row id, for their names until the layout lists them.
  const [addedNames, setAddedNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (!open) { setConfirmReset(false); setPicking(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError(undefined);
    setView(undefined);
    setError(undefined);
    loadLayout(controller.signal).then(v => {
      if (!active || controller.signal.aborted) return;
      setView(v);
      const lists = customiseLists(v);
      setOrder(lists.order);
      setHidden(new Set(lists.hidden));
      setLoading(false);
    }).catch(e => {
      if (!active || controller.signal.aborted) return;
      setLoadError(e);
      setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [open, loadLayout, attempt]);
  const rowOf = (id: string) => view?.rows.find(r => r.id === id);
  const addView = (resourceId: string, name: string) => {
    setOrder(prev => addViewRow(prev, resourceId));
    setAddedNames(prev => new Map(prev).set(homeViewRowId(resourceId), name));
    setPicking(false);
  };
  const removeView = (id: string) => {
    const next = removeViewRow(order, hidden, id);
    setOrder(next.order);
    setHidden(next.hidden);
  };
  if (picking) return <SavedViewSheet open={open} exclude={order} onPick={addView} onClose={() => setPicking(false)} />;
  const move = (id: string, delta: number) => setOrder(prev => { const i = prev.indexOf(id); const j = i + delta; if (i < 0 || j < 0 || j >= prev.length) return prev; const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next; });
  const run = async (task: () => Promise<unknown>) => { setBusy(true); setError(undefined); try { await task(); onClose(); } catch (e) { setError(say(e, 'home', 'save')); } finally { setBusy(false); } };
  const retry = () => setAttempt(a => a + 1);
  // APL-HOME-04: Reset discards the viewer's own layout, so it asks first.
  if (confirmReset) return <ConfirmSheet open={open} onDismiss={() => setConfirmReset(false)} title={i18n.t('confirm.resetHome.title')} consequence={i18n.t('confirm.resetHome.body')} confirmLabel={i18n.t('action.reset')} onConfirm={async () => { await onReset(); onClose(); }} />;
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('home.customize.action')} subtitle={i18n.t('home.customize.subtitle')} leading={{label: i18n.t('action.resetToDefault'), disabled: busy || loading || !view, onPress: () => setConfirmReset(true)}} primary={{label: i18n.t('action.save'), loading: busy, disabled: loading || !view, onPress: () => {
      if (!view) return;
      const payload = customiseSavePayload(view, order, [...hidden]);
      void run(() => onSave(payload.rowOrder, payload.hiddenRowIds, payload.expectedRevision));
    }}}>
      {error ? <Notice tone="error" message={error} style={{marginBottom: space.sm}} /> : null}
      {loading ? <StateView loading title={i18n.t('status.loading')} /> : null}
      {loadError && !loading ? <Notice tone="error" message={say(loadError, 'home', 'load')} action={i18n.t('action.tryAgain')} onAction={retry} style={{marginBottom: space.sm}} /> : null}
      {/* CON-10: one group, separators between rows; no border or fill per row. */}
      {view && !loading && !loadError ? (
      <Surface padded={false}>
        {order.map((id, i) => {
          const row = rowOf(id);
          const title = addedNames.get(id) ?? serverTextLabel(i18n, row?.titleText, row?.title ?? id);
          const savedView = !!homeViewResourceId(id);
          const isHidden = hidden.has(id);
          return (
            <View key={id}>
            {i ? <Divider inset={space.md} /> : null}
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, paddingHorizontal: space.sm, opacity: isHidden ? 0.55 : 1}}>
              <View>
                <Button size="sm" variant="ghost" round icon="chevronUp" accessibilityLabel={i18n.t('home.customize.moveUp', {title})} disabled={i === 0 || row?.reorderable === false || busy} onPress={() => move(id, -1)} />
                <Button size="sm" variant="ghost" round icon="chevronDown" accessibilityLabel={i18n.t('home.customize.moveDown', {title})} disabled={i === order.length - 1 || row?.reorderable === false || busy} onPress={() => move(id, 1)} />
              </View>
              <View style={{flex: 1, minWidth: 0}}>
                <Text variant="body" lines={1}>{title}</Text>
                {row?.required ? <Text variant="caption" tone="tertiary">{i18n.t('home.customize.alwaysOn')}</Text> : null}
              </View>
              {savedView ? <Button size="sm" variant="ghost" round icon="close" accessibilityLabel={i18n.t('home.customize.removeRow', {title})} disabled={busy} onPress={() => removeView(id)} /> : null}
              {/* APL-HOME-04: one aligned switch per row, named for what it does. */}
              <Switch value={!isHidden} disabled={row?.hideable === false || busy} accessibilityLabel={i18n.t('home.customize.showRow', {title})} onValueChange={() => setHidden(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
            </View>
            </View>
          );
        })}
      </Surface>
      ) : null}
      {view && !loading && !loadError ? <View style={{marginTop: space.md, alignItems: 'flex-start'}}><Button size="sm" variant="secondary" icon="plus" label={i18n.t('home.customize.addView')} disabled={busy} onPress={() => setPicking(true)} /></View> : null}
    </Sheet>
  );
}

/** P6: the viewer's saved views (the saved-resources API), to put one on Home. */
function SavedViewSheet({open, exclude, onPick, onClose}: {open: boolean; exclude: readonly string[]; onPick: (resourceId: string, name: string) => void; onClose: () => void}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const {api, session} = useSession();
  const service = useMemo(() => new PersonalSavedService(api, viewerScope(session, api), requestId), [api, session]);
  const [snapshot, setSnapshot] = useState<PersonalSavedSnapshot>(service.getSnapshot());
  useEffect(() => {
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    void service.select({view: 'views'}).catch(() => {});
    return () => { unsubscribe(); service.dispose(); };
  }, [service]);
  const views = snapshot.resources.filter(r => r.kind === 'view' && r.status === 'ready' && !exclude.includes(homeViewRowId(r.id)));
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('home.customize.addView')} subtitle={i18n.t('home.customize.chooseView')}>
      <View style={{gap: space.md}}>
        {snapshot.error ? <Notice tone="error" message={say(snapshot.error, 'home', 'load')} action={i18n.t('action.tryAgain')} onAction={() => void service.refresh()} /> : null}
        {snapshot.loading && !views.length ? <StateView loading title={i18n.t('home.customize.loadingViews')} /> : null}
        {views.length ? (
          <Surface padded={false}>
            {views.map((v, i) => (
              <View key={v.id}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow icon="filter" title={v.name} subtitle={v.summary || undefined} onPress={() => onPick(v.id, v.name)} />
              </View>
            ))}
          </Surface>
        ) : null}
        {!snapshot.loading && !snapshot.error && !views.length ? <Text variant="caption" tone="tertiary">{i18n.t('home.customize.noViews')}</Text> : null}
        {snapshot.nextCursor ? <Button variant="secondary" label={i18n.t('action.showMore')} loading={snapshot.loading} onPress={() => void service.next()} /> : null}
      </View>
    </Sheet>
  );
}
