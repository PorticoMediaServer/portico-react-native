import React, {useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {PlaySummary} from '../../../../../../packages/client-core/src/play-history';
import type {TelemetryReading} from '../../../../../../packages/client-core/src/telemetry';
import {Button, Focusable} from '../../../kit/controls';
import {Icon} from '../../../kit/Icon';
import {BlurView} from '../../../platform/native-blur';
import {ServerBand} from '../../../kit/shell';
import {useTheme} from '../../../kit/theme';
import {alpha, shellType} from '../../../kit/shell/visual';
import type {OwnerAlertView, OwnerJobView, Translate} from './model';
import {OwnerAlertCard, OwnerCalm, OwnerJobGroup, OwnerJobRow, OwnerSection, OwnerSubheading} from './parts';
import {OwnerHealthSection} from './health';
import {OwnerStatisticsSection} from './statistics';
import {OwnerNowPlaying, type OwnerStreamEntry} from './streams';
import type {OwnerHealthWindow, OwnerStreamView, OwnerViewingPeriod} from './model';

export type OwnerDashboardPageProps = Readonly<{
  t: Translate;
  role: 'owner' | 'administrator';
  serverName: string;
  topInset: number;
  health: Readonly<{degraded: boolean; status: string; line: string; uptimeSeconds?: number}>;
  updated?: string;
  loading: boolean;
  error?: unknown;
  streams: readonly OwnerStreamEntry[];
  people?: string;
  alerts: readonly OwnerAlertView[];
  jobs: readonly OwnerJobView[];
  telemetry?: TelemetryReading;
  telemetryError?: unknown;
  healthWindow: OwnerHealthWindow;
  healthNote?: string;
  summary?: PlaySummary;
  statisticsError?: unknown;
  viewingPeriod: OwnerViewingPeriod;
  onBack: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onHealthWindow: (window: OwnerHealthWindow) => void;
  onViewingPeriod: (period: OwnerViewingPeriod) => void;
  onAcknowledge: (alert: OwnerAlertView) => void;
  onFixPermissions?: (alert: OwnerAlertView) => void;
  onJobMenu: (job: OwnerJobView) => void;
  onStop: (stream: OwnerStreamView) => void;
  onStreamMenu: (stream: OwnerStreamView) => void;
}>;

/** One page for every width of the owner Dashboard's phone layout (owner-dashboard.html frames 2–8). */
export function OwnerDashboardPage(props: OwnerDashboardPageProps) {
  const {t, role} = props, theme = useTheme(), [scrolled, setScrolled] = useState(false), bar = props.topInset + 48;
  const owner = role === 'owner';
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ServerBand viewerRole={role} audience="administrators" height={400}/>
    <ScrollView scrollEventThrottle={16} onScroll={event => setScrolled(event.nativeEvent.contentOffset.y > 56)} contentContainerStyle={{paddingTop: bar + 8, paddingBottom: 80}}>
      <OwnerHeader {...props}/>
      {props.error !== undefined && props.streams.length ? <View style={{paddingHorizontal: 16}}><OwnerCalm icon="i-warn" tone="error" title={t('next.shell.activityError')} action={{label: t('next.shell.tryAgain'), onPress: props.onRetry}}/></View> : null}
      <OwnerNowPlaying streams={props.streams} people={props.people} loading={props.loading} error={props.error} onRetry={props.onRetry} onStop={props.onStop} onMenu={props.onStreamMenu} t={t}/>
      {owner ? <>
        <OwnerSection title={t('next.dashboard.alerts')} sub={props.alerts.length ? String(props.alerts.length) : undefined}>
          {props.alerts.length ? props.alerts.map((alert, index) => <View key={alert.id} style={{marginTop: index ? 12 : 0}}><OwnerAlertCard alert={alert} t={t} onAcknowledge={() => props.onAcknowledge(alert)} {...(props.onFixPermissions ? {onFixPermissions: () => props.onFixPermissions!(alert)} : {})}/></View>)
            : <OwnerCalm icon="i-check" tone="good" title={t('web.overview.noAlerts')}/>}
        </OwnerSection>
        <OwnerSection title={t('settings.server.activity')}>
          {props.jobs.length ? <>
            {props.jobs.some(job => job.scan) ? <><OwnerSubheading first>{t('next.shell.libraryScans')}</OwnerSubheading><OwnerJobGroup>{props.jobs.filter(job => job.scan).map(job => <OwnerJobRow key={job.id} job={job} onMenu={() => props.onJobMenu(job)}/>)}</OwnerJobGroup></> : null}
            {props.jobs.some(job => !job.scan) ? <><OwnerSubheading first={!props.jobs.some(job => job.scan)}>{t('next.dashboard.tasks')}</OwnerSubheading><OwnerJobGroup>{props.jobs.filter(job => !job.scan).map(job => <OwnerJobRow key={job.id} job={job} onMenu={() => props.onJobMenu(job)}/>)}</OwnerJobGroup></> : null}
          </> : <OwnerCalm icon="i-clock" title={t('web.activity.noTasks')} body={t('web.activity.noTasksBody')}/>}
        </OwnerSection>
        <OwnerHealthSection reading={props.telemetry} error={props.telemetryError} window={props.healthWindow} onWindow={props.onHealthWindow} note={props.healthNote} onRetry={props.onRetry} t={t}/>
        <OwnerStatisticsSection summary={props.summary} error={props.statisticsError} period={props.viewingPeriod} onPeriod={props.onViewingPeriod} onRetry={props.onRetry} t={t}/>
      </> : null}
    </ScrollView>
    <View style={{position: 'absolute', top: 0, left: 0, right: 0, height: bar, paddingTop: props.topInset, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', zIndex: 20, backgroundColor: scrolled ? alpha(theme.colors.ink, .84) : 'transparent', borderBottomWidth: scrolled ? 1 : 0, borderBottomColor: alpha(theme.colors.text, .07)}}>
      {scrolled ? <BlurView pointerEvents="none" style={{position: 'absolute', inset: 0}} blurType="dark" blurAmount={24} reducedTransparencyFallbackColor={theme.colors.ink}/> : null}
      <Focusable testID="owner-dashboard-back" accessibilityRole="button" accessibilityLabel={t('action.back')} onPress={props.onBack} focusRadius={20} style={{width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'}}>
        <Icon name="i-left" size={22} color={theme.colors.text}/>
      </Focusable>
      {scrolled ? <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: props.topInset, height: 48, alignItems: 'center', justifyContent: 'center'}}>
        <Text numberOfLines={1} style={[shellType(16.5, 800, 'normal', -.015), {color: theme.colors.text}]}>{t('next.dashboard.title')}</Text>
        <Text numberOfLines={1} style={[shellType(12, 600), {color: theme.colors.accentStrong}]}>{props.serverName}</Text>
      </View> : null}
    </View>
  </View>;
}

function OwnerHeader({t, role, serverName, health, updated, loading, onRefresh}: OwnerDashboardPageProps) {
  const theme = useTheme();
  const audience = role === 'owner' ? t('next.shell.serverVisibility.ownerShared') : t('next.shell.serverVisibility.administrator');
  return <View style={{paddingHorizontal: 20}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
      <View style={{height: 28, flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 8, paddingRight: 11, borderRadius: 8, backgroundColor: alpha(theme.colors.ink, .55)}}>
        <Icon name="i-server" size={15} color={theme.colors.text}/>
        <Text style={[shellType(12.5, 700), {color: theme.colors.text}]}>{t('next.shell.server')}</Text>
      </View>
      <Text numberOfLines={1} style={[shellType(12.5, 600), {color: theme.colors.textTertiary, flexShrink: 1}]}>{audience}</Text>
    </View>
    <Text accessibilityRole="header" style={[shellType(40, 800, 'normal', -.04), {color: theme.colors.text, marginTop: 14}]}>{t('next.dashboard.title')}</Text>
    <View style={{flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 14, marginTop: 14}}>
      <Text style={[shellType(19, 800, 'normal', -.02), {color: theme.colors.text}]}>{serverName}</Text>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: health.degraded ? theme.colors.amber : theme.colors.healthy}}/>
        <Text style={[shellType(14, 700), {color: theme.colors.text}]}>{health.status}</Text>
      </View>
    </View>
    {health.line ? <Text style={[shellType(13.5, 400), {color: theme.colors.textSecondary, marginTop: 6}]}>{health.line}</Text> : null}
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10}}>
      {updated ? <Text numberOfLines={1} style={[shellType(12.5, 600), {color: theme.colors.textTertiary, flexShrink: 1}]}>{updated}</Text> : null}
      <View style={{marginLeft: 'auto'}}><Button testID="owner-dashboard-refresh" variant="glass" size="xs" icon="i-refresh" iconSize={16} loading={loading} onPress={onRefresh}>{t('web.selection.refresh')}</Button></View>
    </View>
  </View>;
}
