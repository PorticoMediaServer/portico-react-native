import React, {forwardRef, useState} from 'react';
import {Image, View, type ImageSourcePropType} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useI18n} from '../../app/i18n';
import {Artwork, Backdrop, BackdropFade, Button, Focusable, ProgressBar, Sheet, Skeleton, Text, sourceKey, spec, useNavTitle, useScrolledPast, useBackdropFade, useSpecPlatform, useTheme, type ArtworkShape, type FocusableHandle, type IconName} from '../../ui';
import {heroLayout} from './layout';

export type HeroAction = {
  icon: IconName;
  /** Full name, read by VoiceOver and shown on TV while focused ("Add to My List"). */
  label: string;
  /** Short visible label on iPhone/iPad ("My List"). */
  short?: string;
  selected?: boolean;
  /** iPhone/iPad: the glyph alone (heart, check, ⋯), as on the web row; the name is still read out. */
  iconOnly?: boolean;
  onPress: () => void;
};

export type TitleHeroProps = {
  backdrop?: ImageSourcePropType;
  /** Poster, square or circle art (spec §1 "Artwork"): beside the identity on wide layouts. `mosaic` is the 2×2 collection/playlist mosaic and wins over `source`. */
  art?: {source?: ImageSourcePropType; shape: ArtworkShape; icon?: IconName; mosaic?: readonly (ImageSourcePropType | undefined)[]};
  /** Above the title: the kind, the show an episode belongs to, the artist of an album. */
  eyebrow?: string;
  /** Makes the eyebrow a link (an album's artist), in the title's own colour so it reads on any backdrop. */
  onEyebrow?: () => void;
  title?: string;
  /** The original title when it differs: a quiet line under the title. */
  originalTitle?: string;
  /** The title's logo art: drawn in place of the title text when it loads (the title stays the accessible name). */
  logo?: ImageSourcePropType;
  /** Type-specific, `·`-separated (spec §1 table). */
  facts?: readonly (string | number | undefined | null | false)[];
  /** The title's genres, shown at the end of the facts line; each opens its library filtered to it (touch; television reaches them in Details). */
  genres?: Readonly<{names: readonly string[]; onPress: (name: string) => void}>;
  /** Content rating, drawn as a chip. */
  rating?: string;
  /** Provider scores at the end of the facts line ("TMDB 7.8/10"), at most three. */
  scores?: readonly Readonly<{provider: string; value: string}>[];
  /** The title's tagline: a line of its own above the synopsis, never run into it. */
  tagline?: string;
  synopsis?: string;
  /** Short credit lines under the synopsis ("Directed by …", "Starring …"). */
  credits?: readonly string[];
  /** Pick before play: the version, audio and subtitle controls, between the credits and the actions. */
  choices?: React.ReactNode;
  primary?: {label: string; icon?: IconName; progress?: number; onPress: () => void; preferFocus?: boolean};
  secondary?: readonly HeroAction[];
  onMore?: () => void;
  loading?: boolean;
};

/**
 * TitleHero (Spec — Title Pages §1): the one fixture every title page opens with, filled per
 * type. Its height doesn't change between types on the same device, with or without a backdrop:
 * television 60 % of the screen; iPad 54 % of the height, between 440 and 580; iPhone a 16:9
 * backdrop with the identity below it. With no backdrop it is the compact hero: the title's art
 * over a blurred, darkened version of itself (or a quiet tint), in the same geometry (beside the
 * identity on iPad and TV, in the middle of the band on iPhone), melting into the page like a backdrop.
 *
 * Pages put it first in a `Page`/list whose content has no top padding: the hero owns the
 * safe-area inset so its backdrop runs under the status bar.
 */
export const TitleHero = forwardRef<FocusableHandle, TitleHeroProps>(function TitleHero({backdrop: givenBackdrop, art, eyebrow, onEyebrow, title, originalTitle, logo, facts, genres, rating, scores, tagline, synopsis, credits, choices, primary, secondary = [], onMore, loading}, ref) {
  const {space, isTV, window, colors, metrics, backdrops} = useTheme();
  // "Show backdrops" off: the title has no backdrop here, so it gets the compact hero (its own art beside the identity).
  const backdrop = backdrops ? givenBackdrop : undefined;
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  const platform = useSpecPlatform();
  const h = spec.hero;
  // Layout follows the window (an iPad in a narrow split view lays out like a phone); measurements follow the device.
  const phone = !isTV && window.width < 700;
  const p = phone ? 'phone' : platform;
  const [expanded, setExpanded] = useState(false);
  const [reading, setReading] = useState(false);
  const [focusedAction, setFocusedAction] = useState<string>();
  const tablet = h.height.tablet;
  const band = phone ? Math.round(window.width / h.height.phone.backdropAspect) + insets.top : isTV ? Math.round(window.height * h.height.tv.viewportFraction) : Math.min(Math.max(Math.round(window.height * tablet.viewportFraction), tablet.min), tablet.max);
  const sized = sizedBackdrop(backdrop, h.backdropWidth[p]);
  // M26: no backdrop means the compact hero, never the tall empty band.
  const compact = heroLayout({backdropUrl: sourceKey(backdrop) || undefined, loading}) === 'compact';
  const factLine = (facts ?? []).filter(part => part !== undefined && part !== null && part !== false && part !== '').join(' · ');
  // Beside the identity on wide layouts; on iPhone the art sits in the band instead.
  const showArt = !!art && !phone;
  const artWidth = art?.shape === 'poster' ? h.artwork.poster[p] || h.artwork.posterMin : h.artwork.square[p] || h.artwork.posterMin;
  // iPhone without a backdrop (a compact hero, or one still loading): the title's own art sits in
  // the middle of the same 16:9 band a film's backdrop fills, so an album opens the way a film does.
  const bandArt = phone && !sized && art && art.shape !== 'landscape' ? art : undefined;
  const bandArtSize = Math.round((band - insets.top) * 0.72);
  const size = h.actions.size[p];
  const synopsisMax = h.synopsis.maxWidth[p] || undefined;
  const moreLabel = i18n.t('title.moreActions');
  const actions: HeroAction[] = onMore ? [...secondary, {icon: 'more', label: moreLabel, iconOnly: true, onPress: onMore}] : [...secondary];
  const identity = (
    <View style={{flex: 1, minWidth: 0, gap: h.identity.gap[p] / 2}}>
      {eyebrow ? (onEyebrow ? <Focusable ring={false} radius={metrics.radius.small} accessibilityRole="link" accessibilityLabel={eyebrow} onPress={onEyebrow} style={{alignSelf: 'flex-start'}}>{({focused}) => <Text variant="captionStrong" lines={1} style={{textDecorationLine: focused ? 'underline' : 'none'}}>{eyebrow}</Text>}</Focusable> : <Text variant="label" tone="tertiary" lines={1}>{eyebrow}</Text>) : loading ? <Skeleton height={12} width={120} /> : null}
      {title ? (logo ? <HeroLogo source={logo} title={title} fallback={<Text variant={h.identity.title[p]} lines={h.identity.titleLines}>{title}</Text>} /> : <Text variant={h.identity.title[p]} lines={h.identity.titleLines}>{title}</Text>) : <Skeleton height={metrics.iconLarge} width="60%" />}
      {title && originalTitle ? <Text variant="caption" tone="secondary" lines={1}>{originalTitle}</Text> : null}
      {factLine || genres?.names.length || rating || scores?.length ? (
        <View style={{flexDirection: 'row', alignItems: 'center', gap: h.facts.gap[p], flexWrap: 'wrap'}}>
          {factLine || genres?.names.length ? (
            <Text variant={h.facts.role} tone="secondary" lines={1} style={{flexShrink: 1}}>
              {factLine}{factLine && genres?.names.length ? ' · ' : ''}
              {genres?.names.map((name, i) => <Text key={name} variant={h.facts.role} tone="secondary" onPress={isTV ? undefined : () => genres.onPress(name)} accessibilityRole={isTV ? undefined : 'link'}>{i ? ', ' : ''}{name}</Text>)}
            </Text>
          ) : null}
          {rating ? (
            <View style={{height: h.facts.badge.height[p], justifyContent: 'center', borderWidth: 1, borderColor: colors[h.facts.badge.border], borderRadius: metrics.radius.small, paddingHorizontal: h.facts.badge.paddingX[p]}}>
              <Text variant={h.facts.badge.role}>{rating}</Text>
            </View>
          ) : null}
          {scores?.slice(0, 3).map(score => (
            <Text key={score.provider} variant={h.facts.role} tone="secondary" lines={1}><Text variant="captionStrong" tone="tertiary">{score.provider} </Text>{score.value}</Text>
          ))}
        </View>
      ) : null}
      {tagline ? <Text variant={h.synopsis.role} lines={2} style={{maxWidth: synopsisMax, fontStyle: 'italic'}}>{tagline}</Text> : null}
      {synopsis ? (
        <View style={{maxWidth: synopsisMax, alignItems: 'flex-start'}}>
          <Text variant={h.synopsis.role} tone="secondary" lines={expanded ? undefined : h.synopsis.lines}>{synopsis}</Text>
          {synopsis.length > (isTV ? 160 : phone ? 100 : 160) && !expanded ? (
            <Button variant="link" size="sm" label={i18n.t('title.more')} accessibilityLabel={i18n.t('title.synopsis')} onPress={() => (isTV ? setReading(true) : setExpanded(true))} style={{marginLeft: -space.sm}} />
          ) : null}
        </View>
      ) : loading ? <Skeleton height={14} width="80%" /> : null}
      {credits?.length ? (
        <View style={{maxWidth: synopsisMax, gap: space.xxs}}>
          {credits.map(line => <Text key={line} variant="caption" tone="tertiary" lines={isTV ? 1 : 2}>{line}</Text>)}
        </View>
      ) : null}
      {choices}
      {primary || actions.length ? (
        // One action group: stacked on iPhone (full-width primary), one row on iPad and TV.
        <View style={{gap: h.actions.gap[p], marginTop: space.md, ...(phone ? null : {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start'})}}>
          {primary ? (
            <View style={{alignSelf: phone ? 'stretch' : 'flex-start'}}>
              <Button ref={ref} variant="primary" icon={primary.icon ?? 'play'} label={primary.label} size={size} fullWidth={phone} hasTVPreferredFocus={primary.preferFocus} focusKey="action:primary" onPress={primary.onPress} />
              {primary.progress && primary.progress > 0 ? <ProgressBar value={primary.progress} height={h.actions.progress.height} style={{marginTop: space.xs, marginHorizontal: h.actions.progress.insetX}} /> : null}
            </View>
          ) : null}
          {actions.length ? (
            isTV ? (
              // Television: icon buttons; the focused one's name shows beside the row.
              // CON-13: no round (round is for transport and avatars only).
              <View style={{flexDirection: 'row', alignItems: 'center', gap: h.actions.gap[p]}}>
                {actions.map(a => (
                  <Button key={a.icon + a.label} variant="secondary" icon={a.icon} size={size} selected={a.selected} accessibilityLabel={a.label} focusKey={`action:${a.icon}`} onPress={a.onPress} onFocus={() => setFocusedAction(a.label)} onBlur={() => setFocusedAction(v => (v === a.label ? undefined : v))} />
                ))}
                <Text variant="caption" tone="secondary" lines={1} style={{marginLeft: space.sm, opacity: focusedAction ? 1 : 0}}>{focusedAction ?? ' '}</Text>
              </View>
            ) : (
              // iPhone/iPad: one row, as on the web — the first actions keep their words (touch has no hover,
              // APL-DETAIL-02); the heart, the check and ⋯ are glyphs everyone reads. The full name is for VoiceOver.
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
                {actions.map(a => (
                  <Button key={a.icon + a.label} variant="secondary" size={size} icon={a.icon} label={a.iconOnly ? undefined : a.short ?? a.label} accessibilityLabel={a.label} selected={a.selected} focusKey={`action:${a.icon}`} onPress={a.onPress} />
                ))}
              </View>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
  return (
    // TV-SHOW-01: focus anywhere in the hero brings the page back to its top, title included.
    <View {...(isTV ? ({scrollSnapOffset: 0} as object) : null)}>
      {sized ? <Backdrop source={sized} height={phone ? band : band + space.xl} align={phone ? 'top' : 'right'} opacity={h.backdropOpacity[p]} /> : compact ? <CompactBackground source={art?.source} phone={phone} height={phone ? band : undefined} /> : <Tint height={phone ? band : band + space.xl} />}
      {bandArt ? (
        <View pointerEvents="none" style={{position: 'absolute', top: insets.top, left: 0, right: 0, height: band - insets.top, alignItems: 'center', justifyContent: 'center'}}>
          <HeroArt art={bandArt} title={title} width={bandArt.shape === 'poster' ? Math.round(bandArtSize * 2 / 3) : bandArtSize} />
        </View>
      ) : null}
      {phone ? (
        // iPhone: the 16:9 band (a backdrop, or the art over its own blur), then the identity, for every title.
        <>
          <View style={{height: band}} />
          <View style={{paddingHorizontal: h.paddingX.phone, paddingTop: space.md, paddingBottom: h.paddingBottom.phone}}>{identity}</View>
        </>
      ) : (
        // iPad leaves room at the top for the floating Back (StatusBarScrim). A compact hero keeps
        // the same band as a backdrop hero, so a film and an album open the same way.
        <View style={{height: band, paddingTop: isTV ? space.xl : insets.top + space.xxxl + space.lg, paddingHorizontal: h.paddingX[p], paddingBottom: h.paddingBottom[p]}}>
          <View style={{flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: h.gap[p]}}>
            {showArt && art ? <HeroArt art={art} title={title} width={artWidth} /> : null}
            {identity}
          </View>
        </View>
      )}
      {isTV && synopsis ? (
        <Sheet open={reading} onClose={() => setReading(false)} title={title} kind="picker" placement="center">
          <Text variant="body" tone="secondary" style={{paddingHorizontal: space.md}}>{synopsis}</Text>
        </Sheet>
      ) : null}
    </View>
  );
});

/** The hero's art: a 2×2 mosaic, an initial circle, or the single artwork. */
/**
 * The title's logo in place of its text (web parity): a band of fixed height, as wide as the
 * logo's own aspect allows (capped), left-aligned. Until it loads the band is reserved; if it
 * fails, the title text shows instead.
 */
function HeroLogo({source, title, fallback}: {source: ImageSourcePropType; title: string; fallback: React.ReactNode}) {
  const {isTV} = useTheme();
  const [aspect, setAspect] = useState(3);
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  const height = isTV ? 120 : 64;
  return (
    <Image
      source={source}
      accessible
      accessibilityRole="header"
      accessibilityLabel={title}
      resizeMode="contain"
      onLoad={e => { const s = e.nativeEvent.source; if (s?.width && s?.height) setAspect(Math.min(6, Math.max(1, s.width / s.height))); }}
      onError={() => setFailed(true)}
      style={{height, width: height * aspect, maxWidth: '85%'}}
    />
  );
}

function HeroArt({art, title, width}: {art: NonNullable<TitleHeroProps['art']>; title?: string; width: number}) {
  const {space} = useTheme();
  const mosaic = art.mosaic?.filter(s => !!s);
  // One path is single art, not a mosaic with three empty tiles.
  if (mosaic?.length === 1) return <Artwork source={mosaic[0]} shape={art.shape} width={width} title={title} icon={art.icon} priority />;
  if (mosaic && mosaic.length > 1) {
    const tile = Math.max(24, Math.floor((width - space.sm) / 2));
    return (
      <View style={{width, flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {[mosaic[0], mosaic[1], mosaic[2], mosaic[3]].map((source, i) => (
          <Artwork key={i} source={source} shape="poster" width={tile} title={title} icon={source ? undefined : art.icon} priority />
        ))}
      </View>
    );
  }
  // An artist (or person) without an image: the Avatar pattern at hero size —
  // a neutral circle with the initial, never a generic glyph.
  if (art.shape === 'circle' && !art.source) return <InitialCircle name={title} size={width} />;
  return <Artwork source={art.source} shape={art.shape} width={width} title={title} icon={art.icon} priority />;
}

function InitialCircle({name, size}: {name?: string; size: number}) {
  const {colors} = useTheme();
  return (
    <View style={{width: size, height: size, borderRadius: size / 2, backgroundColor: colors.raisedHigh, alignItems: 'center', justifyContent: 'center'}}>
      <Text variant="title" tone="secondary">{(name ?? '').slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/**
 * M26 compact background: the blurred, darkened art full-bleed, or a quiet tint with no art. It is
 * a backdrop of the art softened (its scrims, the phone's on iPhone, and its fade into the page),
 * so it melts into the page instead of ending on an edge. On iPhone it fills the band only
 * (`height`), as a backdrop does; elsewhere it fades out by the foot of the hero.
 */
function CompactBackground({source, phone, height}: {source?: ImageSourcePropType; phone: boolean; height?: number}) {
  const {colors} = useTheme();
  // The art at 0.55 under a quarter of ink, as before: 0.55 × 0.75 over the ink.
  return <Backdrop source={source} height={height} align={phone ? 'top' : 'right'} blur={32} opacity={0.41} tint={colors[spec.hero.fallback.to]} />;
}

/** Backdrops use the server's long-edge variants: 1920 on television and iPad, 800 on phones. */
function sizedBackdrop(source: ImageSourcePropType | undefined, width: number): ImageSourcePropType | undefined {
  const uri = sourceKey(source);
  if (!uri || typeof source !== 'object' || Array.isArray(source) || /[?&]w=/.test(uri)) return source;
  return {...(source as object), uri: `${uri}${uri.includes('?') ? '&' : '?'}w=${width}`} as ImageSourcePropType;
}

/** No backdrop: a quiet tinted gradient in its place (spec §1), never an empty box. */
function Tint({height}: {height: number}) {
  const {colors} = useTheme();
  const tail = useBackdropFade();
  return (
    <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: 0, height: height + tail}}>
      {/* Sized by percentage (see Backdrop); then faded into the page, never an edge. */}
      <Svg width="100%" height={height}>
        <Defs>
          <LinearGradient id="tint" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors[spec.hero.fallback.from]} stopOpacity={1} />
            <Stop offset="1" stopColor={colors[spec.hero.fallback.to]} stopOpacity={1} />
          </LinearGradient>
          <LinearGradient id="glow" x1="0" y1="0" x2="0.6" y2="1">
            <Stop offset="0" stopColor={colors[spec.hero.fallback.glow]} stopOpacity={spec.hero.fallback.glowAlpha} />
            <Stop offset="1" stopColor={colors[spec.hero.fallback.glow]} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.6" stopColor={colors.ink} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.ink} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#tint)" />
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#glow)" />
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#fade)" />
      </Svg>
      <BackdropFade />
    </View>
  );
}

/**
 * iPhone/iPad: a dark band behind the status bar, so the clock never sits on scrolled text
 * (IOS-HOME-01 on title pages), and a Back button that stays put while the page scrolls (the
 * hero scrolls away, so a Back inside it would too). Place it after the page's scroller.
 * Television has neither: the remote's Back is the way back (APL-SET-04).
 */
export function StatusBarScrim({onBack, title}: {onBack?: () => void; /** The page's title, for the navigation bar that takes over once the hero has scrolled away. */ title?: string}) {
  const {colors, isTV, window, space} = useTheme();
  const i18n = useI18n();
  const insets = useSafeAreaInsets();
  // The hero's backdrop on a phone is 16:9 under the status bar; the bar takes over as it leaves.
  const after = Math.max(120, Math.round(Math.min(window.width, 700) / spec.hero.height.phone.backdropAspect) + insets.top - 60);
  useNavTitle(title, onBack, after);
  const past = useScrolledPast(after);
  if (isTV || (past && title && onBack)) return null;
  const height = insets.top + 12;
  return (
    <>
    <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: 0, height}}>
      <Svg width={window.width} height={height}>
        <Defs>
          <LinearGradient id="statusScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.ink} stopOpacity={0.85} />
            <Stop offset="0.7" stopColor={colors.ink} stopOpacity={0.6} />
            <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={window.width} height={height} fill="url(#statusScrim)" />
      </Svg>
    </View>
    {onBack ? (
      <View style={{position: 'absolute', top: insets.top + space.sm, left: space.page - space.xs}}>
        <Button variant="secondary" round size="sm" icon="back" accessibilityLabel={i18n.t('action.back')} onPress={onBack} />
      </View>
    ) : null}
    </>
  );
}
