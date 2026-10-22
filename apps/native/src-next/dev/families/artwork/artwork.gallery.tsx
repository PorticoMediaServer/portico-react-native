import React, {useState} from 'react';
import {Text, View} from 'react-native';
import type {Gallery} from '../../gallery-registry';
import {defaultI18n} from '../../../../../../packages/i18n/src/index';
import {Artwork, AmbientArt, ArtistCircle, ChannelMark, ColourBackdrop, CoverFan, CoverMosaic, GeneratedArt, GeneratedCover, MediaArt, PersonCircle, ProfilePicker, type AmbientArtSource, type ArtworkSource, type ArtworkPalette, type ProfileOption} from '../../../kit/artwork/index';
import {Button} from '../../../kit/controls/index';
import {useTheme} from '../../../kit/theme';

const t = defaultI18n.t;
// Reference-only static assets. Production components never import this module or these URLs.
const reference = (name: string): ArtworkSource => ({uri: `http://100.120.50.24:8787/assets/${name}`, cacheKey: `approved-reference:${name}`});
const albums = [reference('sq-afterhours.jpg'), reference('sq-1989.jpg'), reference('sq-wall.jpg'), reference('sq-thriller.jpg')];
const posters = [reference('p-tlou.jpg'), reference('p-sev.jpg'), reference('p-jjk.jpg')];
const backdrop = reference('bd-sev.jpg');
const palette = {first: '#2f86bb', second: '#1e5b52'};
const ochre = {first: '#a8892a', second: '#5a3a1a'};

/** Capture supplies real current-authority transport sources; static JPEGs never impersonate ambient-v1. */
type EvidenceSources = {foreground?: ArtworkSource; ambient?: AmbientArtSource; palette?: ArtworkPalette; logo?: ArtworkSource; failedLogo?: ArtworkSource};
const suppliedEvidence = () => (globalThis as {__porticoArtworkEvidence?: EvidenceSources}).__porticoArtworkEvidence;

function ColourCase({shape}: {shape: 'side' | 'round' | 'top'}) {
  const theme = useTheme();
  return <View testID={`artwork-colour-${shape}`} style={{marginLeft: -theme.gutter, width: theme.isTV ? 1920 : 390, height: theme.isTV ? 1080 : shape === 'top' ? 560 : 844, overflow: 'hidden'}}><ColourBackdrop shape={shape} fill/></View>;
}
function ColourSideCase() {return <ColourCase shape="side"/>;}
function ColourRoundCase() {return <ColourCase shape="round"/>;}
function ColourTopCase() {return <ColourCase shape="top"/>;}

function HeroCase() {
  const theme = useTheme();
  const real = suppliedEvidence();
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  return <View style={{gap: 20}}>
    <View testID="artwork-hero" style={{marginLeft: theme.isTV ? 0 : -theme.gutter, width: theme.isTV ? 1500 : 390, height: theme.isTV ? 900 : 560, overflow: 'hidden'}}>
      <AmbientArt foreground={real?.foreground ?? reference('bd-spirited.jpg')} source={real?.ambient} palette={real?.palette ?? palette}
        treatment={theme.isTV ? 'hero' : 'phone'} visible={visible} priority onReady={() => setReady(true)}/>
    </View>
    <Button variant="glass" onPress={() => {setReady(false); setVisible(value => !value);}}>{t(visible ? 'action.close' : 'action.refresh')}</Button>
    {ready ? <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('next.artwork.native.backdrop')}</Text> : null}
  </View>;
}

function FallbackCases() {
  const theme = useTheme();
  const real = suppliedEvidence();
  const w = theme.isTV ? 858 : 350;
  return <View style={{gap: 20}}>
    <View testID="artwork-fallback-backdrop" style={{width: w, height: 236, borderRadius: 14, overflow: 'hidden'}}><AmbientArt foreground={real?.foreground ?? backdrop} source={real?.ambient} palette={real?.palette ?? palette}/></View>
    <View testID="artwork-fallback-poster" style={{width: w, height: 236, borderRadius: 14, overflow: 'hidden'}}>
      <AmbientArt source={real?.ambient} palette={real?.palette ?? palette} treatment="cover"/>
      <Artwork source={posters[2]} width={184 * 2 / 3} height={184} style={{position: 'absolute', right: 44, top: 26, borderRadius: 10}}/>
    </View>
    <View testID="artwork-fallback-generated" style={{width: w, height: 236, borderRadius: 14, overflow: 'hidden'}}><GeneratedArt glyph="L"/></View>
  </View>;
}

function CircleCases() {
  const theme = useTheme();
  const size = theme.isTV ? 214 : 172;
  const real = suppliedEvidence();
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 28}}>
    {[1, 2, 3, 4].map(count => <ArtistCircle key={count} covers={albums.slice(0, count)} size={size}/>)
    <PersonCircle initials="JK" size={size} covers={albums.slice(0, 2)} ambientCovers={real?.ambient ? [real.ambient] : undefined} palette={palette}/>
    <PersonCircle initials="MF" size={96}/>
  </View>;
}

function CoverCases() {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 20}}>
    {[40, 80, 108, 170, 300].map(width => <GeneratedCover key={width} title={t('next.artwork.native.timeMachine')} author={t('next.artwork.native.wells')} tint={ochre} width={width}/>)
    <GeneratedCover title={t('next.artwork.native.metamorphosis')} author={t('next.artwork.native.kafka')} tint={{first: '#8f2e24', second: '#3f2150'}} width={108}/>
    <GeneratedCover title={t('next.artwork.native.warOfWorlds')} author={t('next.artwork.native.wells')} tint={{first: '#2e6a6f', second: '#1f4f7a'}} width={170}/>
    <MediaArt kind="book" source={undefined} width={108} fallback={<GeneratedCover title={t('next.artwork.native.dracula')} author={t('next.artwork.native.stoker')} tint={{first: '#8f2e24', second: '#3f2150'}}/>}/>
    <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('next.artwork.native.noArtwork')}</Text>
  </View>;
}

function ArrangementCases() {
  return <View style={{gap: 26}}>
    <CoverFan covers={posters} shape="poster" variant="library"/>
    <CoverFan covers={albums} shape="square" variant="library"/>
    <CoverFan covers={posters} shape="poster" variant="series"/>
    <CoverFan covers={albums} shape="square" variant="music"/>
    <CoverMosaic covers={albums} shape="square" width={180}/>
    <CoverMosaic covers={posters} shape="poster" width={120}/>
  </View>;
}

function MediaCases() {
  const theme = useTheme();
  const [visible, setVisible] = useState(true);
  return <View style={{gap: 20}}>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 16}}>
      <MediaArt kind="poster" source={posters[0]} width={118} visible={visible}/>
      <MediaArt kind="wide" source={backdrop} width={262} visible={visible}/>
      <MediaArt kind="square" source={albums[0]} width={132} visible={visible}/>
      <MediaArt kind="still" source={backdrop} backdropFallback width={262} visible={visible}/>
      {!theme.isTV ? <>
        <MediaArt kind="book" source={reference('read/covers/great-gatsby.jpg')} width={108} visible={visible}/>
        <MediaArt kind="periodical" source={reference('read/magazines/strand-1891-07.jpg')} width={108} visible={visible}/>
        <MediaArt kind="newspaper" source={reference('read/newspapers/nyt-1918-10-21-page.jpg')} width={108} visible={visible}/>
      </> : null}
    </View>
    <Button variant="glass" onPress={() => setVisible(value => !value)}>{t(visible ? 'action.close' : 'action.refresh')}</Button>
  </View>;
}

function ChannelCases() {
  const real = suppliedEvidence();
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: 24}}>
    <ChannelMark mark={{sourceId: 'approved-reference', id: 'northwind-news-24', text: 'N24', seed: 'northwind-news-24'}}/>
    <ChannelMark mark={{sourceId: 'approved-reference', id: 'summit-sports-extra', text: 'SSE', seed: 'summit-sports-extra'}} tint="#32796d"/>
    <ChannelMark mark={{sourceId: 'approved-reference', id: 'logo', text: 'N24', seed: 'logo'}} source={real?.logo}/>
    <ChannelMark mark={{sourceId: 'approved-reference', id: 'logo-error', text: 'N24', seed: 'logo-error'}} source={real?.failedLogo}/>
  </View>;
}

const profiles: readonly ProfileOption[] = [
  {id: 'demo', name: 'Demo', initial: 'D', color: 'blue', primary: true},
  {id: 'alex', name: 'Alex', initial: 'A', color: 'violet', pinRequired: true},
  {id: 'kids', name: 'Kids', initial: 'K', color: 'mint'},
  {id: 'sam', name: 'Sam', initial: 'S', color: 'slate', unavailableReason: 'restricted'},
  {id: 'jules', name: 'Jules', initial: 'J', color: 'coral', unavailableReason: 'not-shared'},
];
function PickerCase() {
  const theme = useTheme();
  const [selected, setSelected] = useState<string>();
  const [items, setItems] = useState(profiles);
  const [managing, setManaging] = useState(false);
  return <View style={{width: theme.isTV ? 1640 : theme.platform === 'phone' ? 346 : 1100, gap: 24}}>
    <ProfilePicker profiles={items} selectedId={selected} preferredProfileId="alex" onSelect={setSelected}
      onAdd={() => {setItems(value => [...value, {id: `added-${value.length}`, name: t('profile.add'), initial: '+', color: 'sky'}]);}}
      onManage={() => setManaging(value => !value)}/>
    {selected || managing ? <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t(managing ? 'profiles.title' : 'profile.current')}{selected ? ` ${items.find(item => item.id === selected)?.name ?? ''}` : ''}</Text> : null}
  </View>;
}

const gallery: readonly Gallery[] = [
  {id: 'artwork-colour-side', title: 'next.artwork.native.galleryTitle', render: ColourSideCase},
  {id: 'artwork-colour-round', title: 'next.artwork.native.galleryTitle', render: ColourRoundCase},
  {id: 'artwork-colour-top', title: 'next.artwork.native.galleryTitle', render: ColourTopCase},
  {id: 'artwork-hero', title: 'next.artwork.native.backdrop', render: HeroCase},
  {id: 'artwork-fallbacks', title: 'next.artwork.native.noArtwork', render: FallbackCases},
  {id: 'artwork-circles', title: 'next.artwork.native.galleryTitle', render: CircleCases},
  {id: 'artwork-generated-covers', title: 'next.artwork.native.noArtwork', render: CoverCases, platforms: ['phone', 'tablet']},
  {id: 'artwork-arrangements', title: 'next.artwork.native.posterOnly', render: ArrangementCases},
  {id: 'artwork-media', title: 'next.artwork.native.backdrop', render: MediaCases},
  {id: 'artwork-channels', title: 'next.artwork.native.galleryTitle', render: ChannelCases},
  {id: 'artwork-profiles', title: 'next.artwork.native.manageProfiles', render: PickerCase},
];
export default gallery;
