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
import {ownerAlertView, ownerHealthLine, ownerJobView, ownerStreamView, type OwnerSessionTotals} from '../../../screens/settings-live/owner-dashboard/model';

const t = defaultI18n.t;
const now = Date.now();

function session(kind: 'movie' | 'episode', title: string, year: number | undefined, viewer: {profile: string; user: string; device: string}, action: StreamAction, extra: Partial<AdminSession> = {}): AdminSession {
  return Object.freeze({
    id: `${viewer.user}-session`, user: viewer.user, profile: viewer.profile, device: viewer.device, title, kind: 'vod', state: 'playing', positionMs: 1_915_000, durationMs: 4_560_000,
    decision: {video: {action, reasons: []}, audio: {action: 'direct' as StreamAction, reasons: []}} as AdminSession['decision'], location: 'local', startedAt: new Date(now - 1_800_000).toISOString(),
    item: {id: `${viewer.user}-item`, kind, title, art: [], ...(kind === 'episode' ? {showId: 'show', showTitle: title === 'The Last of Us' ? 'The Last of Us' : title, seasonNumber: 1, episodeNumber: 3} : year === undefined ? {} : {year})} as AdminSession['item'],
    ...extra,
  });
}

const sessions: readonly AdminSession[] = [
  session('movie', 'Spirited Away', 2001, {profile: 'priya.n', user: 'priya.n', device: 'iPhone'}, 'transcode', {location: 'remote', quality: {mode: 'fixed', maxHeight: 1080, id: '1080p'}, bandwidthKbps: 8000, positionMs: 3_225_000, durationMs: 7_500_000}),
  session('episode', 'The Last of Us', undefined, {profile: 'Sam', user: 'sam_k', device: 'Living room TV'}, 'direct', {positionMs: 1_915_000, durationMs: 4_560_000}),
];

/** The busy server the frames draw at scale: forty-eight streams, three of them paused. */
const scaleTotals: OwnerSessionTotals = {streams: 48, paused: 3, converting: 6, bandwidthKbps: 312_000, people: 37, atHome: 30, away: 7};
type ScaleRow = Readonly<{
  user: string; profile: string; device: string; title: string; action: StreamAction;
  startedMinutes: number; paused?: boolean; problem?: 'buffering' | 'behind'; position: number; duration: number;
  year?: number; episode?: Readonly<{season: number; number: number; name: string}>; artist?: string; album?: string;
}>;
// The first ten are the frames' own order: a problem first, then the conversions newest first, then the most recent starts.
const scaleOrder: readonly ScaleRow[] = [
  {user: 'alex_m', profile: 'Alex', device: 'Pixel 8', title: 'Barbie', year: 2023, action: 'direct', startedMinutes: 0, problem: 'buffering', position: 4_390_000, duration: 6_900_000},
  {user: 'jordan', profile: 'Kids', device: 'Bedroom TV', title: 'Inside Out', year: 2015, action: 'transcode', startedMinutes: 1, position: 2_400_000, duration: 5_700_000},
  {user: 'dana', profile: 'Dana', device: 'Fire TV', title: 'Reacher', episode: {season: 2, number: 5, name: 'Burial'}, action: 'transcode', startedMinutes: 3, position: 620_000, duration: 3_000_000},
  {user: 'tomas.v', profile: 'Tomas', device: 'Galaxy Tab', title: 'The Dark Knight', year: 2008, action: 'transcode', startedMinutes: 4, position: 3_600_000, duration: 9_100_000},
  {user: 'priya.n', profile: 'priya.n', device: 'iPhone', title: 'Spirited Away', year: 2001, action: 'transcode', startedMinutes: 6, position: 3_225_000, duration: 7_500_000},
  {user: 'iris_h', profile: 'Iris', device: 'Chromecast', title: 'Avatar', year: 2009, action: 'transcode', startedMinutes: 10, position: 2_100_000, duration: 9_500_000},
  {user: 'kofi', profile: 'Kofi', device: 'Roku', title: 'Alien', year: 1979, action: 'transcode', startedMinutes: 14, position: 5_700_000, duration: 8_200_000},
  {user: 'sam_k', profile: 'Sam', device: 'Living room TV', title: 'The Last of Us', episode: {season: 1, number: 3, name: 'Long, Long Time'}, action: 'direct', startedMinutes: 5, position: 1_915_000, duration: 4_560_000},
  {user: 'demo', profile: 'demo', device: 'Firefox on a Mac', title: 'Come Together (2019 Mix)', artist: 'The Beatles', album: 'Abbey Road (2019 Mix)', action: 'direct', startedMinutes: 7, position: 190_000, duration: 260_000},
  {user: 'nana_r', profile: 'Nana', device: 'Kitchen iPad', title: 'World Tonight', action: 'direct', startedMinutes: 11, position: 3_800_000, duration: 7_600_000},
  {user: 'mira_s', profile: 'Mira', device: 'Apple TV', title: 'Back to the Future', year: 1985, action: 'direct', startedMinutes: 12, position: 2_400_000, duration: 6_900_000},
  {user: 'theo', profile: 'Theo', device: 'Chrome on a PC', title: 'Breaking Bad', episode: {season: 2, number: 4, name: 'Down'}, action: 'direct', startedMinutes: 13, paused: true, position: 1_200_000, duration: 2_800_000},
  {user: 'hana.k', profile: 'Hana', device: 'Safari on a Mac', title: 'The Office', episode: {season: 3, number: 7, name: 'Branch Closing'}, action: 'direct', startedMinutes: 15, position: 900_000, duration: 1_500_000},
];
const scaleNames = ['luis_p', 'ben_w', 'ayo', 'noor_a', 'finn', 'cleo_b', 'omar.h', 'ruth', 'yuki_t', 'eli_g', 'petra', 'ivan_d', 'zoe.m', 'hugo', 'lena_b', 'sasha', 'rafa_o', 'maya.j', 'cole', 'tess_n', 'arjun', 'bea_r', 'quinn', 'dev_s', 'wren', 'nico_f', 'amara', 'jonah_k', 'pia', 'seb_l', 'lucia.r', 'otto', 'dahlia_w', 'gus', 'rina_p'];
const scaleTitles: readonly Readonly<{title: string; year?: number; episode?: Readonly<{season: number; number: number; name: string}>; artist?: string; album?: string}>[] = [
  {title: 'Blade Runner', year: 1982}, {title: 'Game of Thrones', episode: {season: 1, number: 9, name: 'Baelor'}}, {title: 'Aliens', year: 1986},
  {title: 'Solo Leveling', episode: {season: 1, number: 5, name: 'A Pretty Good Day'}}, {title: 'Dark Matter', episode: {season: 1, number: 3, name: 'The Box'}},
  {title: 'One Piece', episode: {season: 20, number: 812, name: 'The Hero'}}, {title: '12 Angry Men', year: 1957}, {title: 'MobLand', episode: {season: 1, number: 2, name: 'The Line'}},
  {title: 'Avengers: Endgame', year: 2019}, {title: 'Attack on Titan', episode: {season: 2, number: 3, name: 'Southwestward'}}, {title: 'Lioness', episode: {season: 1, number: 5, name: 'Truth'}},
  {title: 'Dreams', artist: 'Fleetwood Mac', album: 'Rumours'}, {title: 'The Gentlemen', episode: {season: 1, number: 4, name: 'A Whole New World'}}, {title: 'Backrooms', year: 2026},
  {title: 'Baby Be Mine', artist: 'Michael Jackson', album: 'Thriller'}, {title: 'Severance', episode: {season: 1, number: 6, name: 'Hide and Seek'}}, {title: 'Hunter x Hunter', episode: {season: 2, number: 34, name: 'The End'}},
  {title: 'Alone Again', artist: 'The Weeknd', album: 'After Hours'},
];
const scaleDevices = ['iPhone', 'Living room TV', 'Apple TV', 'Pixel 8', 'Chrome on a PC', 'Safari on a Mac', 'Fire TV', 'Roku', 'Galaxy Tab', 'Kitchen iPad', 'Bedroom TV', 'Chromecast', 'Android TV', 'Firefox on a PC'];

function scaleSession(index: number): AdminSession {
  const row: ScaleRow = index < scaleOrder.length ? scaleOrder[index]! : (() => {
    const user = scaleNames[(index - scaleOrder.length) % scaleNames.length]!, pick = scaleTitles[(index * 7 + 3) % scaleTitles.length]!;
    return {user, profile: user, device: scaleDevices[(index * 5 + 2) % scaleDevices.length]!, action: 'direct' as StreamAction, startedMinutes: 16 + index, paused: index === 16 || index === 29, position: 600_000 + (index * 1_973_000) % 6_000_000, duration: 7_200_000, ...pick} as ScaleRow;
  })();
  const item = row.episode
    ? {id: `scale-item-${index}`, kind: 'episode', title: row.episode.name, showId: `show-${index}`, showTitle: row.title, seasonNumber: row.episode.season, episodeNumber: row.episode.number, art: []}
    : row.artist
      ? {id: `scale-item-${index}`, kind: 'song', title: row.title, artist: row.artist, album: row.album, art: []}
      : {id: `scale-item-${index}`, kind: 'movie', title: row.title, ...(row.year === undefined ? {} : {year: row.year}), art: []};
  return Object.freeze({
    id: `scale-${index}`, user: row.user, profile: row.profile, device: row.device, title: row.title, kind: row.artist ? 'audio' : 'vod', state: row.paused ? 'paused' : 'playing',
    problem: row.problem, positionMs: row.position, durationMs: row.duration, decision: {video: {action: row.action, reasons: []}, audio: {action: 'direct', reasons: []}} as AdminSession['decision'],
    location: index % 4 === 0 ? 'remote' : 'local', startedAt: new Date(now - row.startedMinutes * 60_000).toISOString(), item: item as AdminSession['item'],
  });
}
const scaleSessions: readonly AdminSession[] = Array.from({length: 48}, (_, index) => scaleSession(index));

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

function specimen(scale: boolean, expanded: boolean) {
  return function OwnerDashboardSpecimen() {
    const theme = useTheme(), env = {t, locale: defaultI18n.region.formatLocale}, health = ownerHealthLine(undefined, undefined, t);
    const list = scale ? scaleSessions : sessions;
    // The page is drawn edge to edge in the frames; the dev host's gutter is cancelled here, once.
    return <View style={{flex: 1, backgroundColor: theme.colors.ink, marginHorizontal: -theme.gutter}}>
      <ScrollView contentContainerStyle={{paddingBottom: 40}}>
        <OwnerDashboardPage t={t} role="owner" serverName="Portico demo" topInset={0}
          health={{degraded: false, status: health.status, line: 'Up for 6 days · 1.2 TB free · Database 412 MB'}} updated={t('next.dashboard.updatedNow')} loading={false}
          streams={list.slice(0, 10).map(value => ({view: ownerStreamView(value, env)}))} streamTotals={scale ? scaleTotals : {streams: 2, paused: 0, converting: 1, bandwidthKbps: 8000, people: 2, atHome: 1, away: 1}}
          expanded={expanded} allStreams={expanded ? list.map(value => ({view: ownerStreamView(value, env)})) : []}
          people={scale ? '37 people · 30 at home, 7 away' : '2 people · 1 at home, 1 away'}
          alerts={alerts.map(value => ownerAlertView(value, t, defaultI18n.has))} jobs={jobs.map(value => ownerJobView(value, t, defaultI18n.has))}
          telemetry={telemetry} healthWindow="1h" summary={summary} viewingPeriod="7d"
          onBack={() => {}} onRefresh={() => {}} onRetry={() => {}} onHealthWindow={() => {}} onViewingPeriod={() => {}} onAcknowledge={() => {}} onFixPermissions={() => {}} onJobMenu={() => {}} onStop={() => {}} onStreamMenu={() => {}}
          onShowAll={() => {}} onShowFewer={() => {}} onRetryAll={() => {}}/>
      </ScrollView>
    </View>;
  };
}

const galleries: readonly Gallery[] = [
  {id: 'shell-owner-dashboard', title: 'next.dashboard.title', render: specimen(false, false), platforms: ['phone', 'tablet']},
  {id: 'shell-owner-dashboard-busy', title: 'next.dashboard.title', render: specimen(true, false), platforms: ['phone', 'tablet']},
  {id: 'shell-owner-dashboard-all', title: 'next.dashboard.title', render: specimen(true, true), platforms: ['phone', 'tablet']},
];
export default galleries;
