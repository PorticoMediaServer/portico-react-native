import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {
  parseAdminServerEvents,
  type AdminServerEvent,
  type AdminServerEventCode,
} from '../../../../../../packages/client-core/src/server-administration';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Focusable} from '../../../kit/controls';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeScreenLifetime} from '../lifetime';
import type {NativeSettingsLivePorts} from '../ports';
import {createTVServerReader} from './tv-server-reader';

/** Every code has one catalogue sentence, with no parameter taken from a record. */
const sentence: Readonly<Record<AdminServerEventCode, MessageId>> = {
  'alert.acknowledge': 'next.tvTroubleshooting.alertAcknowledge',
  'downloads.cancel': 'next.tvTroubleshooting.downloadCancel',
  'downloads.pause': 'next.tvTroubleshooting.downloadPause',
  'downloads.prepare': 'next.tvTroubleshooting.downloadPrepare',
  'downloads.profile.cache_release': 'next.tvTroubleshooting.downloadProfileCacheRelease',
  'downloads.profile.revoke': 'next.tvTroubleshooting.downloadProfileRevoke',
  'downloads.remove': 'next.tvTroubleshooting.downloadRemove',
  'downloads.resume': 'next.tvTroubleshooting.downloadResume',
  'downloads.retry': 'next.tvTroubleshooting.downloadRetry',
  'downloads.revoke': 'next.tvTroubleshooting.downloadRevoke',
  'downloads.settings': 'next.tvTroubleshooting.downloadSettings',
  'job.admit': 'next.tvTroubleshooting.jobAdmit',
  'job.cancel': 'next.tvTroubleshooting.jobCancel',
  'job.pause': 'next.tvTroubleshooting.jobPause',
  'job.resume': 'next.tvTroubleshooting.jobResume',
  'job.retry': 'next.tvTroubleshooting.jobRetry',
  'optimization.cancel': 'next.tvTroubleshooting.optimizationCancel',
  'optimization.delete': 'next.tvTroubleshooting.optimizationDelete',
  'optimization.request': 'next.tvTroubleshooting.optimizationRequest',
  'optimization.retry': 'next.tvTroubleshooting.optimizationRetry',
  'schedule.apply': 'next.tvTroubleshooting.scheduleApply',
  'settings.apply': 'next.tvTroubleshooting.settingsApply',
};

/** TV39: the administrator's Troubleshooting page. It shows the latest eligible
 * maintenance events the server records for administrators, one reviewed
 * sentence each, and never a service-log message: full messages stay the
 * owner's. With nothing eligible it says so rather than inventing a row. */
export function TVTroubleshootingPanel({ports, runtime, lifetime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; lifetime: NativeScreenLifetime}) {
  const theme = useTheme(), t = runtime.text.t;
  const [state, setState] = useState<readonly AdminServerEvent[]>(), [error, setError] = useState<unknown>(), [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const api = createTVServerReader(ports.context, lifetime);
    setState(undefined); setError(undefined);
    void api.request<unknown>('/v1/admin/access/events', 'GET', undefined, abort.signal).then(parseAdminServerEvents).then(events => {
      if (!abort.signal.aborted && lifetime.current()) setState(events);
    }, failure => {if (!abort.signal.aborted && lifetime.current()) setError(failure);});
    const retire = () => {abort.abort(); setState(undefined); setError(undefined);};
    lifetime.signal.addEventListener('abort', retire, {once: true});
    return () => {abort.abort(); lifetime.signal.removeEventListener('abort', retire);};
  }, [ports, lifetime, revision]);
  if (error) return <StateView {...runtime.error(error, () => setRevision(value => value + 1))}/>;
  if (!state) return <StateView title={t('status.loading')}/>;
  if (!state.length) return <StateView title={t('next.tvTroubleshooting.empty')}/>;
  return <View>
    <Text accessibilityRole="header" style={[shellType(24, 700), {color: theme.colors.textSecondary, marginBottom: 12}]}>{t('next.tvTroubleshooting.title')}</Text>
    {state.map((event, index) => {
      const text = t(sentence[event.code]);
      return <Focusable key={`${event.at}:${event.code}:${index}`} focusId={`event:${index}`} focusKind="row" accessibilityRole="text" accessibilityLabel={text}
        style={{padding: 20, marginBottom: 6, borderRadius: 14, backgroundColor: theme.colors.raised, gap: 6}}>
        <Text style={[shellType(21, 600), {color: theme.colors.text}]}>{text}</Text>
        <Text style={[shellType(18), {color: theme.colors.textTertiary}]}>{new Intl.DateTimeFormat(runtime.text.locale ?? 'en-US', {hour: 'numeric', minute: '2-digit'}).format(new Date(event.at))}</Text>
      </Focusable>;
    })}
  </View>;
}
