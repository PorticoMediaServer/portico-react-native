import React from 'react';
import {ScrollView, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {AdminSession, StreamAction} from '../../../../../../packages/client-core/src/playback-v1/types';
import type {Alert, Job} from '../../../../../../packages/client-core/src/console';
import type {PlaySummary} from '../../../../../../packages/client-core/src/play-history';
import type {TelemetryReading} from '../../../../../../packages/client-core/src/telemetry';
import type {Gallery} from '../../gallery-registry';
import {useTheme} from '../../../kit/theme';
import {OwnerDashboardPage} from '../../../screens/settings-live/owner-dashboard/page';
import {ownerAlertView, ownerHealthLine, ownerJobView, ownerStreamView} from '../../../screens/settings-live/owner-dashboard/model';

const t = defaultI18n.t;
const now = Date.now();

function session(kind: 'movie' | 'episode', title: string, year: number | undefined, viewer: {profile: string; user: string; device: string}, action: StreamAction, extra: Partial<AdminSession> = {}): AdminSession {
  return Object.freeze({
    id: `${viewer.user}-session`, user: viewer.user, profile: viewer.profile, device: viewer.device, title, kind: 'vod', state: 'playing', positionMs: 1_915_000, durationMs: 4_560_000,
    decision: {video: {action, reasons: []}, audio: {action: 'direct', reasons: []}}, location: 'local', startedAt: new Date(now - 1_800_000).toISOString(),
    item: {id: `${viewer.user}-item`, kind, title, art: [], ...(kind === 'episode' ? {showId: 'show', showTitle: title === 'The Last of Us' ? 'The Last of Us' : title, seasonNumber: 1, episodeNumber: 3} : year === undefined ? {} : {year})} as AdminSession['item'],
    ...extra,
  });
}

const sessions: readonly AdminSession[] = [
  session('movie', 'Spirited Away', 2001, {profile: 'priya.n', user: 'priya.n', device: 'iPhone'}, 'transcode', {location: 'remote', quality: {mode: 'fixed', maxHeight: 1080, id: '1080p'}, bandwidthKbps: 8000, positionMs: 3_225_000, durationMs: 7_500_000}),
  session('episode', 'The Last of Us', undefined, {profile: 'Sam', user: 'sam_k', device: 'Living room TV'}, 'direct', {positionMs: 1_915_000, durationMs: 4_560_000}),
];

const alerts: readonly Alert[] = [
  {id: 'alert-storage', code: 'low_storage', severity: 'critical', status: 'open', params: {}, firstAt: now - 7_200_000, lastAt: now - 120_000, occurrences: 2, revision: 1},
  {id: 'alert-upload', code: 'upload-budget-exhausted', severity: 'warning', status: 'open', params: {}, firstAt: now - 3_600_000, lastAt: now - 600_000, occurrences: 3, revision: 1},
];

const jobs: readonly Job[] = [
  {id: 'job-scan', kind: 'library_scan', resource: 'Movies', trigger: 'manual', state: 'running', phase: 'scanning', revision: 1, attempt: 1, createdAt: now - 600_000, updatedAt: now - 1_000, nextAt: now, settingsRevision: 1, lane: 'scan', actions: ['pause', 'cancel'], processed: 51, total: 80},
  {id: 'job-pictures', kind: 'trickplay', resource: 'TV Shows', trigger: 'auto', state: 'queued', phase: 'waiting', revision: 1, attempt: 1, createdAt: now - 300_000, updatedAt: now - 1_000, nextAt: now, settingsRevision: 1, lane: 'background', actions: ['cancel']},
];

const series = (base: number, wobble: number, seed: number) => Array.from({length: 30}, (_, index) => ({t: now - (29 - index) * 120_000, v: Math.max(0, base + Math.sin(index / 4 + seed) * wobble)}));
const telemetry: TelemetryReading = {
  period: '1h', timeZone: 'UTC', from: new Date(now - 3_600_000).toISOString(), until: new Date(Math.floor(now / 900_000) * 900_000).toISOString(), buckets: [],
  window: '1h', observedAt: now,
  status: {cpu: {status: 'available', value: 18}, memory: {status: 'available', value: 41}, netOut: {status: 'available', value: 14_000_000}, diskRead: {status: 'available', value: 21_000_000}, gpuUsage: {status: 'available', value: 9}, gpuEncoder: {status: 'available', value: 12}} as TelemetryReading['status'],
  series: {cpu: series(18, 6, 1), memory: series(41, 3, 2), netOut: series(14_000_000, 4_000_000, 3), diskRead: series(21_000_000, 8_000_000, 4), gpuUsage: series(9, 2, 5), gpuEncoder: series(12, 3, 6)} as TelemetryReading['series'],
};
const summary: PlaySummary = {
  period: '7d', timeZone: 'UTC', from: new Date(now - 604_800_000).toISOString(), until: new Date(Math.floor(now / 900_000) * 900_000).toISOString(), buckets: [],
  plays: 46, people: 4, watchedMs: 31 * 3_600_000, converted: 7,
  mostPlayed: [{name: 'The Last of Us', plays: 12}, {name: 'Severance', plays: 9}, {name: 'Spirited Away', plays: 6}],
  mostActive: [{name: 'sam_k', plays: 18}, {name: 'demo', plays: 14}, {name: 'priya.n', plays: 9}],
};

function OwnerDashboardSpecimen() {
  const theme = useTheme(), env = {t, locale: defaultI18n.region.formatLocale}, health = ownerHealthLine(undefined, undefined, t);
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ScrollView contentContainerStyle={{paddingBottom: 40}}>
      <OwnerDashboardPage t={t} role="owner" serverName="Portico demo" topInset={0}
        health={{degraded: false, status: health.status, line: 'Up for 6 days · 1.2 TB free · Database 412 MB'}} updated={t('next.dashboard.updatedNow')} loading={false}
        streams={sessions.map(value => ({view: ownerStreamView(value, env)}))} people="2 people · 1 at home, 1 away"
        alerts={alerts.map(value => ownerAlertView(value, t, defaultI18n.has))} jobs={jobs.map(value => ownerJobView(value, t, defaultI18n.has))}
        telemetry={telemetry} healthWindow="1h" summary={summary} viewingPeriod="7d"
        onBack={() => {}} onRefresh={() => {}} onRetry={() => {}} onHealthWindow={() => {}} onViewingPeriod={() => {}} onAcknowledge={() => {}} onFixPermissions={() => {}} onJobMenu={() => {}} onStop={() => {}} onStreamMenu={() => {}}/>
    </ScrollView>
  </View>;
}

const galleries: readonly Gallery[] = [
  {id: 'shell-owner-dashboard', title: 'next.dashboard.title', render: OwnerDashboardSpecimen, platforms: ['phone', 'tablet']},
];
export default galleries;
