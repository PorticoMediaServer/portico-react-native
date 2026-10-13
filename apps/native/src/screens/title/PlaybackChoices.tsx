import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {PlayerOffersService, type PlayerOfferedStream} from '../../../../../packages/client-core/src/player-offers';
import {peekPendingTrackChoice, setPendingTrackChoice} from '../../../../../packages/client-core/src/pending-track-choice';
import {channelsLabel, codecLabel, resolutionLabel} from '../../../../../packages/client-core/src/presentation/index';
import {peekPendingVersion, setPendingVersion, versionPickOffered} from '../../app/pending-version';
import {viewerScope} from '../../app/content';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {Button, Menu, useTheme, type MenuItem} from '../../ui';
import {useLanguageName} from './language';

/**
 * Pick before play (Spec — Title Pages §1): Version, Audio and Subtitles under the credit lines,
 * preselected so the usual viewer never touches them. A title can hold several files; Version
 * names the one that plays (the server's best, unless another is picked) and is offered once the
 * player starts a title on the version picked here (`pending-version`). A control appears only
 * where there is a real choice; with none anywhere the row is absent. Each is a button that names its current
 * value and opens a short list — the same on iPhone, iPad and television (no text entry).
 *
 * The choice is left for the player (client-core `pending-track-choice`, and `pending-version`
 * for the version), which applies it when this item's session can honour it. Audio and subtitles
 * are those of the version chosen, so picking another version starts them afresh. Subtitles are the file's own tracks, picked by language;
 * untouched, the control reads "Automatic" (the viewer's subtitle preference decides).
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
  const source = useMemo(() => (data ? data.sources.find(x => x.id === (version || data.current?.sourceId)) ?? data.sources.find(x => x.available) ?? data.sources[0] : undefined), [data, version]);
  const versionChoice = versionPickOffered() && !!data && data.sources.length > 1;
  // The version travels to the player too; the one the server would play anyway sends nothing.
  useEffect(() => {
    setPendingVersion(versionChoice && version && version !== data?.current?.sourceId ? {itemId, versionId: version} : undefined);
  }, [itemId, version, versionChoice, data]);
  useEffect(() => () => { if (peekPendingVersion(itemId)) setPendingVersion(undefined); }, [itemId]);
  const audioStreams = useMemo(() => source?.streams.filter(x => x.type === 'audio' && x.enabled) ?? [], [source]);
  const subtitleLanguages = useMemo(() => [...new Set((source?.streams ?? []).filter(x => x.type === 'subtitle' && x.language && x.language !== 'und').map(x => x.language!))], [source]);
  // The choice travels to the player; an untouched control sends nothing.
  useEffect(() => {
    const chosen = audio !== undefined || subtitle !== '';
    setPendingTrackChoice(chosen ? {itemId, ...(audio !== undefined ? {audioStreamIndex: audio} : {}), ...(subtitle === '' ? {} : subtitle === 'off' ? {subtitle: 'off' as const} : {subtitle: {language: subtitle}})} : undefined);
  }, [itemId, audio, subtitle]);
  // Leaving the page takes an unplayed choice with it.
  useEffect(() => () => { if (peekPendingTrackChoice(itemId)) setPendingTrackChoice(undefined); }, [itemId]);
  if (!data || !source) return null;
  const t = (id: Parameters<typeof i18n.t>[0], values?: Parameters<typeof i18n.t>[1]) => i18n.t(id, values);
  const audioLabel = (x: PlayerOfferedStream, n: number) => [x.language && x.language !== 'und' ? name(x.language) : x.title ?? i18n.t('mediaInfo.track', {number: n}), x.codec ? codecLabel(x.codec) : undefined, channelsLabel({channels: x.channels, channelLayout: x.channelLayout}, t)].filter(Boolean).join(' · ');
  const currentAudio = audioStreams.find(x => x.index === audio) ?? audioStreams.find(x => x.default) ?? audioStreams[0];
  const audios: MenuItem[] = audioStreams.map((x, i) => ({id: String(x.index), label: audioLabel(x, i + 1), selected: x.index === currentAudio?.index}));
  const subtitles: MenuItem[] = [
    {id: '', label: i18n.t('title.subtitlesAutomatic'), selected: subtitle === ''},
    {id: 'off', label: i18n.t('title.subtitlesOff'), selected: subtitle === 'off'},
    ...subtitleLanguages.map(code => ({id: code, label: name(code), selected: subtitle === code})),
  ];
  const versionLabel = (x: (typeof data.sources)[number]) => [x.height ? resolutionLabel(x.height, t) : undefined, x.videoCodec ? codecLabel(x.videoCodec) : undefined, x.container ? x.container.toUpperCase() : undefined].filter(Boolean).join(' · ');
  // Two copies that read the same are told apart by their place in the list (best first).
  const versions: MenuItem[] = versionChoice ? data.sources.map((x, i, all) => { const label = versionLabel(x); const same = !label || all.some((other, n) => n !== i && versionLabel(other) === label); return {id: x.id, label: same ? [i18n.t('mediaInfo.version', {number: i + 1}), label].filter(Boolean).join(' · ') : label, selected: x.id === source.id}; }) : [];
  const versionValue = versions.find(x => x.selected)?.label ?? '';
  // One control is noise; the row appears when there is a choice to make somewhere.
  if (versions.length < 2 && audios.length < 2 && !subtitleLanguages.length) return null;
  const size = isTV ? 'md' : 'sm';
  const subtitleValue = subtitle === '' ? i18n.t('title.subtitlesAutomatic') : subtitle === 'off' ? i18n.t('title.subtitlesOff') : name(subtitle);
  return (
    <View accessibilityLabel={i18n.t('title.playbackChoices')} style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs}}>
      {versions.length > 1 ? <Button variant="secondary" size={size} icon="film" trailingIcon="chevronUpDown" label={versionValue} accessibilityLabel={`${i18n.t('title.version')}: ${versionValue}`} onPress={() => setOpen('version')} /> : null}
      {audios.length > 1 && currentAudio ? <Button variant="secondary" size={size} icon="audio" trailingIcon="chevronUpDown" label={audioLabel(currentAudio, audioStreams.indexOf(currentAudio) + 1)} accessibilityLabel={`${i18n.t('title.audio')}: ${audioLabel(currentAudio, audioStreams.indexOf(currentAudio) + 1)}`} onPress={() => setOpen('audio')} /> : null}
      {subtitleLanguages.length ? <Button variant="secondary" size={size} icon="subtitles" trailingIcon="chevronUpDown" label={subtitleValue} accessibilityLabel={`${i18n.t('title.subtitles')}: ${subtitleValue}`} onPress={() => setOpen('subtitles')} /> : null}
      <Menu open={open === 'version'} onClose={() => setOpen(null)} title={i18n.t('title.version')} items={versions} onSelect={id => { setVersion(id); setAudio(undefined); setSubtitle(''); }} />
      <Menu open={open === 'audio'} onClose={() => setOpen(null)} title={i18n.t('title.audio')} items={audios} onSelect={id => setAudio(Number(id))} />
      <Menu open={open === 'subtitles'} onClose={() => setOpen(null)} title={i18n.t('title.subtitles')} items={subtitles} onSelect={setSubtitle} />
    </View>
  );
}
