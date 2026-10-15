import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {PlayerOffersService, type PlayerOfferedStream} from '../../../../../packages/client-core/src/player-offers';
import {peekPendingTrackChoice, preplaySubtitles, setPendingTrackChoice} from '../../../../../packages/client-core/src/pending-track-choice';
import {PlaybackOptionsClient, type MediaVersion} from '../../../../../packages/client-core/src/playback-v1/index';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {channelsLabel, codecLabel} from '../../../../../packages/client-core/src/presentation/index';
import {peekPendingVersion, setPendingVersion} from '../../app/pending-version';
import {viewerScope} from '../../app/content';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {Button, Menu, useTheme, type MenuItem} from '../../ui';
import {useLanguageName} from './language';

/**
 * Pick before play (Spec — Title Pages §1): Version, Audio and Subtitles under the credit lines,
 * preselected so the usual viewer never touches them. A title can hold several files; Version
 * names the one that plays (the one the server would choose for this device, unless another is
 * picked), from the title's playback options, so a title in several parts is one version and an
 * edition is named. A control appears only where there is a real choice; with none anywhere the
 * row is absent. Each is a button that names its current
 * value and opens a short list — the same on iPhone, iPad and television (no text entry).
 *
 * The choice is left for the player (client-core `pending-track-choice`, and `pending-version`
 * for the version), which applies it when this item's session can honour it. Audio and subtitles
 * are those of the version chosen, so picking another version starts them afresh. Subtitles are the
 * version's own tracks as the server lists them (playback options), one entry per track: two in
 * one language, a track with no language, SDH and forced tracks are each their own choice, picked
 * by the track's identity, never by its language. Untouched, the control reads "Automatic" (the
 * viewer's subtitle preference decides). When the server is applying the profile's last choice
 * for this show or film, the menu can forget it.
 */
export function PlaybackChoices({libraryId, itemId}: {libraryId: string; itemId: string}) {
  const {api, session} = useSession();
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const name = useLanguageName();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new PlayerOffersService({api, scope: {serverId: scope.serverId, viewerId: scope.viewerId}}), [api, scope.serverId, scope.viewerId]);
  const snapshot = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => {
    void service.select({libraryId, itemId}).catch(() => {});
    return () => { try { service.cancel(); } catch { /* disposed */ } };
  }, [service, libraryId, itemId]);
  const [audio, setAudio] = useState<number | undefined>();
  const [subtitle, setSubtitle] = useState('');
  const [version, setVersion] = useState('');
  const [open, setOpen] = useState<'version' | 'audio' | 'subtitles' | null>(null);
  useEffect(() => { setVersion(''); setAudio(undefined); setSubtitle(''); }, [itemId]);
  const data = snapshot.data && snapshot.data.scope.itemId === itemId ? snapshot.data : null;
  // The title's versions, and the one a start that names nothing would play. An older server, or
  // a read that fails, simply offers no version to choose.
  const [options, setOptions] = useState<{itemId: string; versions: readonly MediaVersion[]; preferred?: string}>();
  const optionsClient = useMemo(() => new PlaybackOptionsClient(localV1Http(api)), [api]);
  useEffect(() => {
    let live = true;
    setOptions(undefined);
    void optionsClient.options(itemId).then(o => { if (live) setOptions({itemId, versions: o.versions, preferred: o.preferred?.versionId}); }, () => {});
    return () => { live = false; };
  }, [optionsClient, itemId]);
  const currentOptions = options?.itemId === itemId ? options : undefined;
  const versionList = currentOptions && currentOptions.versions.length > 1 ? currentOptions.versions : [];
  const playing = versionList.length ? version || options?.preferred || versionList[0]!.id : '';
  // A version's first file is what the offers list it under: its tracks are the ones to choose from.
  const source = useMemo(() => (data ? data.sources.find(x => x.id === (playing || data.current?.sourceId)) ?? data.sources.find(x => x.available) ?? data.sources[0] : undefined), [data, playing]);
  // The version travels to the player too (it starts the title on it); the one the server would play anyway sends nothing.
  useEffect(() => {
    setPendingVersion(versionList.length && version && version !== options?.preferred ? {itemId, versionId: version} : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, version, versionList.length, options?.preferred]);
  useEffect(() => () => { if (peekPendingVersion(itemId)) setPendingVersion(undefined); }, [itemId]);
  const audioStreams = useMemo(() => source?.streams.filter(x => x.type === 'audio' && x.enabled) ?? [], [source]);
  // The version's subtitle tracks from the playback options (by resource id); without them, the
  // file's own tracks by language as before, the only list there is.
  const optionVersion = currentOptions ? currentOptions.versions.find(x => x.id === (playing || currentOptions.preferred)) ?? currentOptions.versions[0] : undefined;
  const subtitleTracks = useMemo(() => (optionVersion ? preplaySubtitles(optionVersion.subtitles, i18n.t, i18n.locale) : []), [optionVersion, i18n]);
  const subtitleLanguages = useMemo(() => (optionVersion ? [] : [...new Set((source?.streams ?? []).filter(x => x.type === 'subtitle' && x.language && x.language !== 'und').map(x => x.language!))]), [source, optionVersion]);
  // The choice travels to the player; an untouched control sends nothing.
  useEffect(() => {
    const chosen = audio !== undefined || subtitle !== '';
    setPendingTrackChoice(chosen ? {itemId, ...(audio !== undefined ? {audioStreamIndex: audio} : {}), ...(subtitle === '' ? {} : subtitle === 'off' ? {subtitle: 'off' as const} : subtitle.startsWith('lang:') ? {subtitle: {language: subtitle.slice(5)}} : {subtitle: {resourceId: subtitle}})} : undefined);
  }, [itemId, audio, subtitle]);
  // Leaving the page takes an unplayed choice with it.
  useEffect(() => () => { if (peekPendingTrackChoice(itemId)) setPendingTrackChoice(undefined); }, [itemId]);
  if (!data || !source) return null;
  const t = (id: Parameters<typeof i18n.t>[0], values?: Parameters<typeof i18n.t>[1]) => i18n.t(id, values);
  const audioLabel = (x: PlayerOfferedStream, n: number) => [x.language && x.language !== 'und' ? name(x.language) : x.title ?? i18n.t('mediaInfo.track', {number: n}), x.codec ? codecLabel(x.codec) : undefined, channelsLabel({channels: x.channels, channelLayout: x.channelLayout}, t)].filter(Boolean).join(' · ');
  const currentAudio = audioStreams.find(x => x.index === audio) ?? audioStreams.find(x => x.default) ?? audioStreams[0];
  const audios: MenuItem[] = audioStreams.map((x, i) => ({id: String(x.index), label: audioLabel(x, i + 1), selected: x.index === currentAudio?.index}));
  const subtitleChoices = subtitleTracks.length ? subtitleTracks.map(x => ({id: x.id, label: x.label})) : subtitleLanguages.map(code => ({id: 'lang:' + code, label: name(code)}));
  const subtitles: MenuItem[] = [
    {id: '', label: i18n.t('title.subtitlesAutomatic'), selected: subtitle === ''},
    {id: 'off', label: i18n.t('title.subtitlesOff'), selected: subtitle === 'off'},
    ...subtitleChoices.map(x => ({...x, selected: subtitle === x.id})),
  ];
  // Named as the player's own Version menu names them: the server's label, the edition, the picture's height and the container.
  const versionLabel = (x: MediaVersion) => [x.label, x.edition && x.edition !== x.label ? x.edition : '', x.video[0]?.height ? i18n.t('quality.height', {height: x.video[0].height}) : '', x.container?.toUpperCase() ?? ''].filter(Boolean).join(' · ');
  // Two copies that read the same are told apart by their place in the list (best first).
  const versions: MenuItem[] = versionList.map((x, i, all) => { const label = versionLabel(x); const same = !label || all.some((other, n) => n !== i && versionLabel(other) === label); return {id: x.id, label: same ? [i18n.t('mediaInfo.version', {number: i + 1}), label].filter(Boolean).join(' · ') : label, selected: x.id === playing}; });
  const versionValue = versions.find(x => x.selected)?.label ?? '';
  // One control is noise; the row appears when there is a choice to make somewhere.
  if (versions.length < 2 && audios.length < 2 && !subtitleChoices.length) return null;
  const size = isTV ? 'md' : 'sm';
  const subtitleValue = subtitle === '' ? i18n.t('title.subtitlesAutomatic') : subtitle === 'off' ? i18n.t('title.subtitlesOff') : subtitleChoices.find(x => x.id === subtitle)?.label ?? i18n.t('title.subtitlesAutomatic');
  return (
    <View accessibilityLabel={i18n.t('title.playbackChoices')} style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs}}>
      {versions.length > 1 ? <Button variant="secondary" size={size} icon="film" trailingIcon="chevronUpDown" label={versionValue} accessibilityLabel={`${i18n.t('title.version')}: ${versionValue}`} onPress={() => setOpen('version')} /> : null}
      {audios.length > 1 && currentAudio ? <Button variant="secondary" size={size} icon="audio" trailingIcon="chevronUpDown" label={audioLabel(currentAudio, audioStreams.indexOf(currentAudio) + 1)} accessibilityLabel={`${i18n.t('title.audio')}: ${audioLabel(currentAudio, audioStreams.indexOf(currentAudio) + 1)}`} onPress={() => setOpen('audio')} /> : null}
      {subtitleChoices.length ? <Button variant="secondary" size={size} icon="subtitles" trailingIcon="chevronUpDown" label={subtitleValue} accessibilityLabel={`${i18n.t('title.subtitles')}: ${subtitleValue}`} onPress={() => setOpen('subtitles')} /> : null}
      <Menu open={open === 'version'} onClose={() => setOpen(null)} title={i18n.t('title.version')} items={versions} onSelect={id => { setVersion(id); setAudio(undefined); setSubtitle(''); }} />
      <Menu open={open === 'audio'} onClose={() => setOpen(null)} title={i18n.t('title.audio')} items={audios} onSelect={id => setAudio(Number(id))} />
      <Menu open={open === 'subtitles'} onClose={() => setOpen(null)} title={i18n.t('title.subtitles')} items={subtitles} onSelect={id => setSubtitle(id)} />
    </View>
  );
}
