import React, {type ReactNode} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Svg, {Text as SvgText} from 'react-native-svg';
import type {FactPart} from '../../../../../packages/client-core/src/presentation/kit-model/index';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {MediaArt, CircleArt, PersonCircle, type ArtworkProps, type ArtworkSource, type CircleArtProps, type PersonCircleProps} from '../artwork/index';
import {SelectionCircle} from '../selection/index';
import {useTheme} from '../theme';
import {ArtFrame, Badge, Caption, CardAction, CardFrame, Parts, Progress, Scrim, titleStyle, type CardProps} from './primitives';

type Media = Readonly<{
  artwork?: ArtworkSource | null;
  artworkFallback?: ReactNode;
  artworkProps?: Omit<ArtworkProps, 'source' | 'fallback' | 'width' | 'height'>;
  progress?: number;
  watched?: boolean;
  isNew?: boolean;
}>;
export type PosterCardProps = CardProps & Media & {titleLines?: 1 | 2};
export type WideCardProps = CardProps & Media;
export type SquareCardProps = CardProps & Media;
export type CircleCardProps = CardProps & ({art: CircleArtProps; person?: false} | {art: PersonCircleProps; person: true});
export type CoverCardProps = PosterCardProps & {kind?: 'book' | 'periodical' | 'newspaper'; next?: boolean};

/** SelectionCircle belongs to the selection family; cards only position the actual control. */
function Overlays({props, hovered, height, playSize = 40, centered = false, pause}: {props: CardProps; hovered: boolean; height: number; playSize?: number; centered?: boolean; pause?: () => void}) {
  const t = useTheme(), {selection, onPlay, onMore, title} = props;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, {height}]}>
    {selection?.active && <View style={{position: 'absolute', left: t.isTV ? 12 : 6, top: t.isTV ? 12 : 6}}>
      <SelectionCircle selected={selection.selected} onPress={selection.onToggle} accessibilityLabel={defaultI18n.t('card.select', {title})} focusable={false} />
    </View>}
    {!t.isTV && !selection?.active && hovered && (onPlay || pause) && <CardAction name={pause ? 'i-pause' : 'i-play'} label={pause ? defaultI18n.t('next.cards.pause') : defaultI18n.t('card.play', {title})} onPress={pause ?? onPlay!} size={playSize}
      style={centered ? {position: 'absolute', left: '50%', top: height / 2 - playSize / 2, marginLeft: -playSize / 2} : {position: 'absolute', bottom: 10, right: 10}} />}
    {!t.isTV && !selection?.active && (hovered || props.menuVisibility === 'always') && onMore && <CardAction name="i-more" label={defaultI18n.t('card.more', {title})} onPress={onMore} color={t.colors.text}
      style={{position: 'absolute', right: 4, top: 4, backgroundColor: t.colors.scrim}} />}
  </View>;
}

function Marks({progress, watched, isNew}: Media) {
  const t = useTheme(), inset = t.spec.card.badge.inset[t.platform];
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {isNew && <View style={{position: 'absolute', left: inset, top: inset}}><Badge kind="new">{defaultI18n.t('next.kit.new')}</Badge></View>}
    {watched && <View accessibilityLabel={defaultI18n.t('card.watched')} style={{position: 'absolute', right: inset, top: inset}}><Badge kind="watched" /></View>}
    <Progress value={progress} style={{position: 'absolute', left: 0, right: 0, bottom: 0}} />
  </View>;
}

function Portrait({kind = 'poster', next, titleLines = 1, ...props}: PosterCardProps & {kind?: 'poster' | 'book' | 'periodical' | 'newspaper'; next?: boolean}) {
  const t = useTheme(), width = props.width ?? t.spec.card.width.poster[t.platform], height = width / (kind === 'periodical' || kind === 'newspaper' ? 3 / 4 : 2 / 3);
  return <CardFrame {...props} width={width} overlay={state => <Overlays props={props} hovered={state.hovered} height={height} />}>
    {state => <>
      <ArtFrame height={height} focused={state.focused} hovered={state.hovered} selected={props.selection?.selected || next}>
        <MediaArt {...props.artworkProps} source={props.artwork} fallback={props.artworkFallback} kind={kind} width={width} height={height} />
        <Marks {...props} />
      </ArtFrame>
      <Caption {...props} selected={props.selection?.selected} lines={titleLines} />
    </>}
  </CardFrame>;
}

export function PosterCard(props: PosterCardProps) {return <Portrait {...props} />;}
export function CoverCard(props: CoverCardProps) {
  const t = useTheme();
  if (t.isTV) return null;
  return <Portrait {...props} kind={props.kind ?? 'book'} />;
}

export function SquareCard(props: SquareCardProps) {
  const t = useTheme(), width = props.width ?? t.spec.card.width.square[t.platform];
  return <CardFrame {...props} width={width} overlay={s => <Overlays props={props} hovered={s.hovered} height={width} />}>
    {s => <><ArtFrame height={width} focused={s.focused} hovered={s.hovered} selected={props.selection?.selected}>
      <MediaArt {...props.artworkProps} kind="square" source={props.artwork} fallback={props.artworkFallback} width={width} height={width} />
      <Scrim start={0.55} opacity={0.75} /><Marks watched={props.watched} isNew={props.isNew} />
      <Progress value={props.progress} height={t.isTV ? 6 : 3} style={{position: 'absolute', left: 8, right: 8, bottom: 8}} />
    </ArtFrame><Caption {...props} selected={props.selection?.selected} /></>}
  </CardFrame>;
}

export function WideCard(props: WideCardProps) {
  const t = useTheme(), width = props.width ?? t.spec.card.width.wide[t.platform], height = width * 9 / 16;
  return <CardFrame {...props} width={width} overlay={s => <Overlays props={props} hovered={s.hovered} height={height} playSize={52} centered />}>
    {s => <ArtFrame height={height} focused={s.focused} hovered={s.hovered} selected={props.selection?.selected}>
      <MediaArt {...props.artworkProps} kind="wide" source={props.artwork} fallback={props.artworkFallback} width={width} height={height} />
      <Scrim />
      <View style={{position: 'absolute', left: t.spec.card.wide.insetX[t.platform], right: t.spec.card.wide.insetX[t.platform], bottom: t.spec.card.wide.insetBottom[t.platform]}}>
        <Text numberOfLines={1} style={[t.type.wideTitle, {color: props.selection?.selected ? t.colors.accentStrong : t.colors.text}]}>{props.title}</Text>
        <View style={{marginTop: t.isTV ? 4 : 2}}><Parts parts={props.caption} style={{color: t.colors.textSecondary}} /></View>
        {!t.isTV && <Parts parts={props.detail} style={{color: t.colors.textSecondary}} />}
        <Progress value={props.progress} style={{marginTop: t.spec.card.progress.marginTop[t.platform]}} />
      </View>
    </ArtFrame>}
  </CardFrame>;
}

export function CircleCard(props: CircleCardProps) {
  const t = useTheme(), width = props.width ?? (t.isTV ? t.spec.card.width.artist.tv : 104);
  return <CardFrame {...props} width={width} overlay={s => <Overlays props={props} hovered={s.hovered} height={width} />}>
    {s => <><ArtFrame height={width} focused={s.focused} hovered={s.hovered} selected={props.selection?.selected} circle>
      {props.person ? <PersonCircle {...props.art} size={width} /> : <CircleArt {...props.art} size={width} />}
    </ArtFrame><View style={{marginTop: t.isTV ? 0 : 1}}><Caption {...props} titleTextStyle={[titleStyle(t.isTV ? 22 : 14, 700), props.titleTextStyle]} captionTextStyle={[titleStyle(t.isTV ? 20 : 12.5, 600), props.captionTextStyle]} centered selected={props.selection?.selected} /></View></>}
  </CardFrame>;
}

export type EpisodeTileProps = CardProps & Media & {
  backdropFallback?: boolean;
  /** Canonical episodeLabel/cardText parts, including show context only where shows mix. */
  label: readonly FactPart[];
  length?: string;
  status?: string;
  synopsis?: string;
  layout?: 'tile' | 'row';
};

export function EpisodeTile(props: EpisodeTileProps) {
  const t = useTheme(), row = props.layout === 'row' || (!t.isTV && props.layout !== 'tile');
  const width = props.width ?? (row ? 350 : t.spec.episode.width[t.platform]), artWidth = row ? 136 : width, height = artWidth * 9 / 16;
  const art = (focused: boolean, hovered: boolean) => <ArtFrame width={artWidth} height={height} radius={row ? 8 : undefined} focused={focused} hovered={hovered} hoverScale={t.spec.card.hover.episodeScale} selected={props.selection?.selected}>
    <MediaArt {...props.artworkProps} kind="still" backdropFallback={props.backdropFallback} source={props.artwork} fallback={props.artworkFallback} width={artWidth} height={height} />
    {props.length && !row && <View style={{position: 'absolute', right: t.spec.episode.duration.inset[t.platform], top: t.spec.episode.duration.inset[t.platform]}}><Badge>{props.length}</Badge></View>}
    {props.status && !row && <View style={{position: 'absolute', left: t.isTV ? 16 : 8, top: t.isTV ? 14 : 8}}><Badge kind="new">{props.status}</Badge></View>}
    <Marks watched={props.watched} progress={props.progress} />
  </ArtFrame>;
  const text = <View style={{flex: row ? 1 : undefined, minWidth: 0, marginTop: row ? 0 : t.spec.episode.titleMargin[t.platform], gap: 3}}>
    <Text numberOfLines={1} style={[row ? titleStyle(15) : t.type.episodeTitle, {color: props.selection?.selected ? t.colors.accentStrong : t.colors.text}]}>{props.title}</Text>
    <Parts parts={props.label} style={row ? titleStyle(12.5, 600) : undefined} />
    {row && props.length && <Text style={[titleStyle(12.5, 600), {color: t.colors.textTertiary}]}>{props.length}</Text>}
    <Parts parts={props.caption} /><Parts parts={props.detail} />
  </View>;
  return <CardFrame {...props} width={width} overlay={s => <Overlays props={{...props, menuVisibility: row ? 'always' : props.menuVisibility}} hovered={s.hovered} height={height} playSize={48} centered />}>
    {s => <><View style={{flexDirection: row ? 'row' : 'column', gap: row ? 14 : 0, alignItems: row ? 'center' : undefined}}>{art(s.focused, s.hovered)}{text}</View>
      {props.synopsis && <Text numberOfLines={row ? 2 : 3} style={[row ? titleStyle(13, 600) : t.type.episodeBody, {color: t.colors.textSecondary, marginTop: row ? 9 : 8, lineHeight: row ? 18.85 : undefined}]}>{props.synopsis}</Text>}
    </>}
  </CardFrame>;
}

export type RankedCardProps = PosterCardProps & {rank: number};
export function RankedCard({rank, width, ...props}: RankedCardProps) {
  const t = useTheme(), numberWidth = t.isTV ? 120 : 70, posterWidth = t.isTV ? 214 : 116, numberHeight = t.isTV ? 321 : 172;
  return <View style={{width: width ?? (t.isTV ? 318 : 186), flexDirection: 'row', alignItems: 'flex-start'}}>
    <Svg accessible={false} width={numberWidth} height={numberHeight} style={{marginRight: -16}}><SvgText x={numberWidth} y={numberHeight - 2} textAnchor="end" fontFamily={t.type.rank.fontFamily} fontSize={t.isTV ? 190 : 120} letterSpacing={(t.isTV ? 190 : 120) * -0.08} fill={t.colors.ink} stroke={t.colors.lineStrong} strokeWidth={2}>{rank}</SvgText></Svg>
    <PosterCard {...props} width={posterWidth} />
  </View>;
}

export {Overlays as CardOverlays};
