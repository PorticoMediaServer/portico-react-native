import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {ConsoleClient, type MissingTitlesRule} from '../../../../../../../packages/client-core/src/console';
import {emptyMissingTitles, listMissingTitles, type MissingTitlesPage} from '../../../../../../../packages/client-core/src/title-identity';
import {presentError} from '../../../../../../../packages/client-core/src/presentation/errors';
import {when} from '../../../../../../../packages/client-core/src/server-admin/console-words';
import {defaultI18n} from '../../../../../../../packages/i18n/src';
import type {MessageId} from '../../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';

type Translate = typeof defaultI18n.t;
const RULES: readonly MissingTitlesRule[] = ['immediately', 'after_days', 'never'];

/** Settings › Server › Storage & backups › Missing titles (owner-server.html frame 37). */
export function MissingTitlesTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme(), context = ports.context, authority = context.authority();
  const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => context.api.request<T>(path, method, body, signal)};
  const consoleClient = React.useMemo(() => new ConsoleClient(api, {serverId: authority.serverId, viewerId: authority.profileId}), [context]);
  useEffect(() => () => consoleClient.dispose(), [consoleClient]);
  const [rule, setRule] = useState<MissingTitlesRule>('never'), [days, setDays] = useState(30), [revision, setRevision] = useState(0);
  const [page, setPage] = useState<MissingTitlesPage>(), [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string>();
  const [editingDays, setEditingDays] = useState(false), [daysText, setDaysText] = useState('30'), [removing, setRemoving] = useState(false), [typed, setTyped] = useState('');
  const reload = () => setRevision(value => value + 1);
  useEffect(() => {
    let live = true;
    void Promise.all([consoleClient.settings(), listMissingTitles(api)]).then(([settings, list]) => {
      if (!live) return;
      setRule(settings.requested['library.missingTitles']); setDays(settings.requested['library.missingTitlesDays']);
      setPage(list); setError(undefined);
    }, failure => {if (live) setError(failure);});
    return () => {live = false;};
  }, [consoleClient, api, revision]);
  const apply = (patch: Partial<Record<'library.missingTitles' | 'library.missingTitlesDays', MissingTitlesRule | number>>) => {
    setBusy(true); setProblem(undefined);
    void consoleClient.settings().then(async settings => {
      const values = {...patch, ...(patch['library.missingTitles'] === 'after_days' || rule === 'after_days' ? {'library.missingTitlesDays': patch['library.missingTitlesDays'] ?? days} : {})};
      await consoleClient.applySettings(settings.revision, values as never, settings.requested);
      reload();
    }).catch(failure => setProblem(presentError(failure, 'server-console').body)).finally(() => setBusy(false));
  };
  const removeAll = () => {
    setBusy(true); setProblem(undefined);
    void emptyMissingTitles(api).then(() => {setRemoving(false); setTyped(''); reload();}, failure => setProblem(presentError(failure, 'server-console').body)).finally(() => setBusy(false));
  };
  const total = page?.total ?? 0;
  if (error !== undefined && !page) return <StateView {...runtime.error(error, reload)}/>;
  const removes = (missingSince: string) => {
    if (rule !== 'after_days') return undefined;
    const at = Date.parse(missingSince);
    if (!Number.isFinite(at)) return undefined;
    return when(at + days * 86_400_000);
  };
  return <View style={{marginTop: 14}} testID="server-storage-missing">
    <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('settings.server.missingTitles')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('settings.server.missingTitlesLede')}</Text>
    <Text style={[shellType(14, 700), {color: theme.colors.text, marginTop: 16}]}>{t('settings.server.missingTitlesRule')}</Text>
    <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{t('settings.server.missingTitlesRuleHelp')}</Text>
    <View style={{gap: 6, marginTop: 10}}>
      {RULES.map(value => <Button key={value} size="compact" variant={rule === value ? 'primary' : 'glass'} disabled={busy} onPress={() => {setRule(value); apply({'library.missingTitles': value});}}>{t(`settings.server.missingTitlesRule.${value}` as MessageId)}</Button>)}
    </View>
    {rule === 'after_days' ? <Button variant="text" size="compact" style={{alignSelf: 'flex-start', marginTop: 8}} onPress={() => {setDaysText(String(days)); setEditingDays(true);}}>{t('settings.server.missingTitlesDays')}{' '}{defaultI18n.number(days)}{' '}{t('settings.unit.days')}</Button> : null}
    {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 8}]}>{problem}</Text> : null}
    <Text style={[shellType(14, 700), {color: theme.colors.text, marginTop: 18}]}>{total ? t('web.missingTitles.count', {count: total}) : t('web.missingTitles.none')}</Text>
    <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {(page?.items ?? []).map((row, index) => <View key={row.id} style={{paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <Text numberOfLines={1} style={[shellType(15, 600), {color: theme.colors.text}]}>{row.title}</Text>
        <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{removes(row.missingSince) ? t('web.missingTitles.sinceRemoved', {when: when(Date.parse(row.missingSince)), removes: removes(row.missingSince)!}) : t('web.missingTitles.since', {when: when(Date.parse(row.missingSince))})}</Text>
      </View>)}
    </View>
    {total ? <View style={{flexDirection: 'row', marginTop: 12}}><Button size="compact" variant="glass" textStyle={{color: theme.colors.record}} onPress={() => {setTyped(''); setRemoving(true);}}>{t('web.missingTitles.removeNow')}</Button></View> : null}
    <BottomSheet open={editingDays} onOpenChange={setEditingDays} testID="server-missing-days" keyboardAvoiding title={t('settings.server.missingTitlesDays')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" onPress={() => setEditingDays(false)}>{t('action.cancel')}</Button>
        <Button loading={busy} onPress={() => {const next = Math.max(1, Math.min(3650, Number(daysText) || 1)); setDays(next); apply({'library.missingTitlesDays': next}); setEditingDays(false);}}>{t('action.save')}</Button></View>}>
      <TextField label={t('settings.server.missingTitlesDays')} value={daysText} onChangeText={setDaysText} keyboardType="number-pad"/>
    </BottomSheet>
    <BottomSheet open={removing} onOpenChange={open => {if (!open && !busy) setRemoving(false);}} testID="server-missing-remove" keyboardAvoiding
      title={t('web.missingTitles.removeTitle')} description={t('web.missingTitles.removeBody', {count: total})}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setRemoving(false)}>{t('action.cancel')}</Button>
        <Button variant="glass" textStyle={{color: theme.colors.record}} loading={busy} disabled={typed.trim() !== String(total)} onPress={removeAll}>{t('web.missingTitles.removeNow')}</Button></View>}>
      <TextField label={t('confirm.typeToConfirm', {token: total})} value={typed} onChangeText={setTyped} keyboardType="number-pad"/>
    </BottomSheet>
  </View>;
}
