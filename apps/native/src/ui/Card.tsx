import React from 'react';
import {View, type ImageSourcePropType, type StyleProp, type ViewStyle} from 'react-native';
import {Artwork, ProgressLine, artworkRatio, type ArtworkShape} from './Artwork';
import {FocusHalo} from './FocusHalo';
import {Focusable, type FocusableProps} from './Focusable';
import {Icon, type IconName} from './Icon';
import {Text} from './Text';
import {alpha, useTheme} from './theme';

export type CardProps = Omit<FocusableProps, 'children' | 'style' | 'radius'> & {
  title: string;
  subtitle?: string;
  source?: ImageSourcePropType;
  shape?: ArtworkShape;
  width?: number;
  /** 0–1 resume progress drawn along the artwork edge. */
  progress?: number;
  badge?: string;
  /** Finished: a check in the artwork's corner. There is no mark for "not watched yet". */
  watched?: boolean;
  /** Lines the title may take (books run long: two). */
  titleLines?: number;
  /** Placeholder icon when no artwork exists (library family). */
  icon?: IconName;
  /** Hide the caption block (dense grids, hero rows). */
  captionless?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Media card: artwork + two-line caption. Shape decides the ratio (poster
 * for film/TV, landscape for episodes/live, square for music/books, circle
 * for people). The caption sits outside the artwork so focus scaling never
 * clips the title, and the focus halo is drawn around the artwork only.
 */
/** Memoised; pays off once the list passes stable handlers. */
export const Card = React.memo(function Card({title, subtitle, source, shape = 'poster', width, progress = 0, badge, watched, titleLines = 1, icon, captionless, style, ...rest}: CardProps) {
  const {metrics, space, colors, isTV} = useTheme();
  const w = width ?? (shape === 'landscape' ? metrics.landscapeWidth : shape === 'poster' ? metrics.posterWidth : metrics.squareWidth);
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} radius={metrics.radius.card} ring={false} style={[{width: w}, style]} {...rest}>
      {({focused, hovered}) => (
        <View>
          <FocusHalo active={focused} width={w} height={w / artworkRatio[shape]} radius={metrics.radius.card} />
          <View style={{borderRadius: metrics.radius.card, overflow: 'hidden'}}>
            <Artwork source={source} shape={shape} width={w} title={title} icon={icon} />
            <ProgressLine value={progress} />
            {badge ? (
              <View style={{position: 'absolute', top: space.sm, left: space.sm, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: metrics.radius.small, backgroundColor: alpha(colors.ink, 0.82)}}>
                <Text variant="micro">{badge}</Text>
              </View>
            ) : null}
            {watched ? (
              <View pointerEvents="none" style={{position: 'absolute', top: space.sm, right: space.sm, width: isTV ? 30 : 20, height: isTV ? 30 : 20, borderRadius: isTV ? 15 : 10, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(colors.ink, 0.82)}}>
                <Icon name="check" size={isTV ? 18 : 12} color={colors.white} />
              </View>
            ) : null}
            {(focused || hovered) && !isTV ? <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: alpha(colors.white, 0.06)}} /> : null}
          </View>
          {!captionless ? (
            <View style={{paddingTop: space.sm, paddingHorizontal: 2, minHeight: isTV ? 60 : 38}}>
              <Text variant="captionStrong" lines={titleLines} style={focused ? {color: colors.white} : undefined}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="micro" tone="tertiary" lines={1} style={{marginTop: 1}}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </Focusable>
  );
});

/** Circular person card for cast/crew rows. */
export function PersonCard({name, subtitle, source, width, ...rest}: {name: string; subtitle?: string; source?: ImageSourcePropType; width?: number} & Omit<FocusableProps, 'children' | 'style'>) {
  const {space, colors, isTV} = useTheme();
  const size = width ?? (isTV ? 150 : 84);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    // TV-DETAIL-01: no ring around the whole card (it cut through the name); the halo hugs the portrait only.
    <Focusable accessibilityRole="button" accessibilityLabel={subtitle ? `${name}, ${subtitle}` : name} radius={size / 2} ring={false} style={{width: size + space.sm}} {...rest}>
      {({focused}) => (
      <View style={{alignItems: 'center'}}>
        <View style={{width: size, height: size}}>
          <FocusHalo active={focused} width={size} height={size} radius={size / 2} />
          <View style={{width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: colors.raisedHigh, alignItems: 'center', justifyContent: 'center'}}>
            {/* The initials are the portrait's placeholder too: a portrait that is slow or missing never leaves an empty circle. */}
            {source ? <Artwork source={source} shape="circle" width={size} placeholder={<Text variant={isTV ? 'heading' : 'subheading'} tone="secondary">{initials}</Text>} /> : <Text variant={isTV ? 'heading' : 'subheading'} tone="secondary">{initials}</Text>}
          </View>
        </View>
        <Text variant="captionStrong" lines={1} align="center" style={{marginTop: space.sm, maxWidth: size + space.sm}}>
          {name}
        </Text>
        {subtitle ? (
          <Text variant="micro" tone="tertiary" lines={1} align="center" style={{maxWidth: size + space.sm}}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      )}
    </Focusable>
  );
}

/** Hero-row landscape tile with title overlaid (Continue Watching, Live). */
export function BannerCard({title, subtitle, source, width, progress = 0, style, ...rest}: CardProps) {
  const {metrics, space, colors} = useTheme();
  const w = width ?? metrics.landscapeWidth * 1.4;
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={title} radius={metrics.radius.card} ring={false} style={[{width: w}, style]} {...rest}>
      {({focused}) => (<>
      <FocusHalo active={focused} width={w} height={w / artworkRatio.landscape} radius={metrics.radius.card} />
      <View style={{borderRadius: metrics.radius.card, overflow: 'hidden'}}>
        <Artwork source={source} shape="landscape" width={w} title={title} />
        <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.md, backgroundColor: alpha(colors.ink, 0.55)}}>
          <Text variant="captionStrong" lines={1}>{title}</Text>
          {subtitle ? <Text variant="micro" tone="secondary" lines={1}>{subtitle}</Text> : null}
        </View>
        <ProgressLine value={progress} />
        <View style={{position: 'absolute', top: space.sm, right: space.sm}}>
          <Icon name="play" size={metrics.iconSmall} color={colors.white} />
        </View>
      </View>
      </>)}
    </Focusable>
  );
}
