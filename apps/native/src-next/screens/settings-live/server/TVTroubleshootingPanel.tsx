import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {routePath} from '../../../../../../packages/contracts/src/routes';
import {parseLogPage, type LogRecord} from '../../../../../../packages/client-core/src/server-administration';
import {Focusable} from '../../../kit/controls';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeScreenLifetime} from '../lifetime';
import type {NativeSettingsLivePorts} from '../ports';
import {createTVServerReader} from './tv-server-reader';

const latest = 8;

/** TV39: the message log as a short read-only list of the latest messages. */
export function TVTroubleshootingPanel({ports, runtime, lifetime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; lifetime: NativeScreenLifetime}) {
  const theme = useTheme(), t = runtime.text.t;
  const [state, setState] = useState<readonly LogRecord[]>(), [error, setError] = useState<unknown>(), [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const api = createTVServerReader(ports.context, lifetime);
    setState(undefined); setError(undefined);
    void api.request<unknown>(routePath('get_admin_logs'), 'GET', undefined, abort.signal).then(parseLogPage).then(page => {
      if (!abort.signal.aborted && lifetime.current()) setState(page.items.slice(0, latest));
    }, failure => {if (!abort.signal.aborted && lifetime.current()) setError(failure);});
    const retire = () => {abort.abort(); setState(undefined); setError(undefined);};
    lifetime.signal.addEventListener('abort', retire, {once: true});
    return () => {abort.abort(); lifetime.signal.removeEventListener('abort', retire);};
  }, [ports, lifetime, revision]);
  if (error) return <StateView {...runtime.error(error, () => setRevision(value => value + 1))}/>;
  if (!state) return <StateView title={t('status.loading')}/>;
  if (!state.length) return <StateView title={t('next.tvPeople.noMessages')}/>;
  return <View>
    <Text accessibilityRole="header" style={[shellType(24, 700), {color: theme.colors.textSecondary, marginBottom: 12}]}>{t('next.tvPeople.latestMessages')}</Text>
    {state.map(line => <Focusable key={line.sequence} focusId={`log:${line.sequence}`} focusKind="row" accessibilityRole="text" accessibilityLabel={line.message}
      style={{padding: 20, marginBottom: 6, borderRadius: 14, backgroundColor: theme.colors.raised, gap: 6}}>
      <Text style={[shellType(21, 600), {color: theme.colors.text}]}>{line.message}</Text>
      <Text style={[shellType(18), {color: theme.colors.textTertiary}]}>{line.level} · {line.category} · {new Intl.DateTimeFormat(runtime.text.locale ?? 'en-US', {hour: 'numeric', minute: '2-digit'}).format(new Date(line.at))}</Text>
    </Focusable>)}
  </View>;
}
