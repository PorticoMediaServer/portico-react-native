import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {
  Animated,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {
  AlertTriangle,
  ChevronRight,
  ImageOff,
  Play,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react-native';
import type {MediaItem, PrototypePlatform} from '@portico-prototypes/contract';
import {color, fill, font, mobileType, radius, tvType} from './tokens';
import {useReducedMotion} from './useReducedMotion';

const ContentFocusContext = createContext<() => void>(() => undefined);

export function ContentFocusProvider({children, onContentFocus}: {children: React.ReactNode; onContentFocus(): void}) {
  return <ContentFocusContext.Provider value={onContentFocus}>{children}</ContentFocusContext.Provider>;
}

export function useContentFocus(): () => void {
  return useContext(ContentFocusContext);
}

export function PageTransition({children, transitionKey}: {children: React.ReactNode; transitionKey: string}) {
  const reducedMotion = useReducedMotion();
  const animateRoute = !Platform.isTV && !reducedMotion;
  const translateRoute = animateRoute;
  const opacity = useRef(new Animated.Value(animateRoute ? 0 : 1)).current;
  const translateY = useRef(new Animated.Value(translateRoute ? 8 : 0)).current;

  useEffect(() => {
    opacity.stopAnimation();
    translateY.stopAnimation();
    opacity.setValue(animateRoute ? 0 : 1);
    translateY.setValue(translateRoute ? 8 : 0);
    Animated.parallel([
      Animated.timing(opacity, {duration: animateRoute ? 180 : 0, toValue: 1, useNativeDriver: true}),
      Animated.timing(translateY, {duration: translateRoute ? 180 : 0, toValue: 0, useNativeDriver: true}),
    ]).start();
  }, [animateRoute, opacity, transitionKey, translateRoute, translateY]);

  return <Animated.View style={[styles.flex, {opacity, transform: [{translateY}]}]}>{children}</Animated.View>;
}

export function ArtworkScrim({platform, strong = false}: {platform: PrototypePlatform; strong?: boolean}) {
  const television = platform === 'tv';
  return (
    <View pointerEvents="none" style={fill}>
      <Svg height="100%" width="100%" style={fill}>
        <Defs>
          <LinearGradient id="porticoVertical" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={color.projector} stopOpacity={strong ? 0.28 : 0.1} />
            <Stop offset="0.5" stopColor={color.projector} stopOpacity={strong ? 0.46 : 0.12} />
            <Stop offset="1" stopColor={color.projector} stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="porticoHorizontal" x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor={color.projector} stopOpacity={television ? 0.94 : 0.28} />
            <Stop offset="0.48" stopColor={color.projector} stopOpacity={television ? 0.68 : 0.04} />
            <Stop offset="1" stopColor={color.projector} stopOpacity={television ? 0.08 : 0} />
          </LinearGradient>
        </Defs>
        <Rect fill="url(#porticoVertical)" height="100%" width="100%" />
        <Rect fill="url(#porticoHorizontal)" height="100%" width="100%" />
      </Svg>
    </View>
  );
}

interface FocusableProps extends Omit<PressableProps, 'style'> {
  children?: React.ReactNode;
  platform: PrototypePlatform;
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  onFocusChange?(focused: boolean): void;
}

export function Focusable({
  children,
  focusedStyle,
  onBlur,
  onFocus,
  onFocusChange,
  platform,
  pressedStyle,
  style,
  ...props
}: FocusableProps) {
  const [focused, setFocused] = useState(false);
  const onContentFocus = useContentFocus();

  return (
    <Pressable
      {...props}
      onBlur={event => {
        setFocused(false);
        onFocusChange?.(false);
        onBlur?.(event);
      }}
      onFocus={event => {
        setFocused(true);
        if (platform === 'tv') {
          onContentFocus();
        }
        onFocusChange?.(true);
        onFocus?.(event);
      }}
      style={({pressed}) => [style, focused && focusedStyle, pressed && pressedStyle]}>
      {children}
    </Pressable>
  );
}

interface ControlButtonProps {
  accessibilityLabel?: string;
  compact?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  label?: string;
  onPress(): void;
  onFocusChange?(focused: boolean): void;
  platform: PrototypePlatform;
  primary?: boolean;
  requestInitialTVFocus?: boolean;
  selected?: boolean;
  testID?: string;
}

export function ControlButton({
  accessibilityLabel,
  compact,
  disabled,
  icon: Icon,
  label,
  onPress,
  onFocusChange,
  platform,
  primary,
  requestInitialTVFocus,
  selected,
  testID,
}: ControlButtonProps) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={disabled}
      hasTVPreferredFocus={television && requestInitialTVFocus}
      onFocusChange={onFocusChange}
      onPress={onPress}
      platform={platform}
      style={[
        styles.control,
        television ? styles.controlTv : styles.controlMobile,
        compact && (television ? styles.controlCompactTv : styles.controlCompactMobile),
        primary && styles.controlPrimary,
        selected && styles.controlSelected,
        disabled && styles.controlDisabled,
      ]}
      focusedStyle={styles.controlFocused}
      pressedStyle={styles.controlPressed}
      testID={testID}>
      {Icon ? (
        <Icon
          color={primary ? color.projector : selected ? color.screenBlueStrong : color.silver}
          size={television ? 26 : 19}
          strokeWidth={2.1}
        />
      ) : null}
      {label ? (
        <Text
          numberOfLines={1}
          style={[
            television ? styles.controlLabelTv : styles.controlLabelMobile,
            primary && styles.controlLabelPrimary,
            selected && styles.controlLabelSelected,
          ]}>
          {label}
        </Text>
      ) : null}
    </Focusable>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onPress,
  platform,
  selected,
}: {
  icon: LucideIcon;
  label: string;
  onPress(): void;
  platform: PrototypePlatform;
  selected?: boolean;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      platform={platform}
      style={[styles.iconButton, television ? styles.iconButtonTv : styles.iconButtonMobile, selected && styles.iconButtonSelected]}
      focusedStyle={styles.controlFocused}
      pressedStyle={styles.controlPressed}>
      <Icon color={selected ? color.screenBlueStrong : color.silver} size={television ? 29 : 21} strokeWidth={2} />
    </Focusable>
  );
}

export function UnderlineTabs({
  active,
  onChange,
  platform,
  tabs,
}: {
  active: string;
  onChange(value: string): void;
  platform: PrototypePlatform;
  tabs: readonly string[];
}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.tabs, television && styles.tabsTv]}>
      {tabs.map(tab => {
        const selected = tab === active;
        return (
          <Focusable
            accessibilityRole="tab"
            accessibilityState={{selected}}
            key={tab}
            onPress={() => onChange(tab)}
            platform={platform}
            style={[styles.tab, television ? styles.tabTv : styles.tabMobile]}
            focusedStyle={styles.tabFocused}
            pressedStyle={styles.tabPressed}>
            <Text style={[television ? styles.tabLabelTv : styles.tabLabelMobile, selected && styles.tabLabelSelected]}>{tab}</Text>
            <View style={[styles.tabRule, selected && styles.tabRuleSelected]} />
          </Focusable>
        );
      })}
    </View>
  );
}

export type MediaCardShape = 'poster' | 'landscape' | 'square';

export function MediaCard({
  artworkFailure,
  item,
  onFocus,
  onPress,
  platform,
  shape = item.shape ?? 'poster',
  width,
}: {
  artworkFailure?: boolean;
  item: MediaItem;
  onFocus?(): void;
  onPress(): void;
  platform: PrototypePlatform;
  shape?: MediaCardShape;
  width?: number;
}) {
  const television = platform === 'tv';
  const [imageFailed, setImageFailed] = useState(false);
  const cardWidth = width ?? (television ? (shape === 'landscape' ? 320 : 214) : shape === 'landscape' ? 208 : 126);
  const artworkHeight = shape === 'landscape' ? cardWidth * 0.5625 : shape === 'square' ? cardWidth : cardWidth * 1.5;
  const source = artworkFailure ? undefined : {uri: shape === 'landscape' ? item.backdrop : item.poster};
  const showFallback = !source || imageFailed;

  return (
    <Focusable
      accessibilityLabel={`${item.title}${item.subtitle ? `. ${item.subtitle}` : ''}`}
      accessibilityRole="button"
      onFocus={onFocus}
      onPress={onPress}
      platform={platform}
      style={[styles.mediaCard, {width: cardWidth}]}
      focusedStyle={styles.mediaCardFocused}
      pressedStyle={styles.mediaCardPressed}>
      <View style={[styles.mediaArtworkFrame, {height: artworkHeight}]}>
        {showFallback ? (
          <View style={styles.artworkFallback}>
            <ImageOff color={color.mutedSilver} size={television ? 40 : 24} strokeWidth={1.6} />
          </View>
        ) : (
          <Image onError={() => setImageFailed(true)} resizeMode="cover" source={source} style={styles.mediaArtwork} />
        )}
        {typeof item.progress === 'number' ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressValue, {width: `${Math.max(4, item.progress)}%`}]} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={television ? styles.mediaTitleTv : styles.mediaTitleMobile}>{item.title}</Text>
      <Text numberOfLines={1} style={television ? styles.mediaMetaTv : styles.mediaMetaMobile}>
        {item.kind === 'episode' && item.subtitle ? item.subtitle : item.year ?? item.subtitle ?? titleCase(item.kind)}
      </Text>
    </Focusable>
  );
}

export function SectionHeading({
  action,
  onAction,
  platform,
  title,
}: {
  action?: string;
  onAction?(): void;
  platform: PrototypePlatform;
  title: string;
}) {
  const television = platform === 'tv';
  return (
    <View style={styles.sectionHeading}>
      <Text style={[television ? tvType.section : mobileType.section, styles.sectionTitle]}>{title}</Text>
      {action && onAction ? (
        <Focusable
          accessibilityLabel={`${action} ${title}`}
          accessibilityRole="button"
          onPress={onAction}
          platform={platform}
          style={styles.sectionAction}
          focusedStyle={styles.sectionActionFocused}
          pressedStyle={styles.sectionActionPressed}>
          <Text style={television ? styles.sectionActionLabelTv : styles.sectionActionLabelMobile}>{action}</Text>
          <ChevronRight color={color.dimSilver} size={television ? 26 : 18} strokeWidth={2} />
        </Focusable>
      ) : null}
    </View>
  );
}

export function InlineNotice({
  actionLabel,
  kind = 'info',
  message,
  onAction,
  platform,
}: {
  actionLabel?: string;
  kind?: 'info' | 'warning' | 'error';
  message: string;
  onAction?(): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const noticeColor = kind === 'error' ? color.record : kind === 'warning' ? color.tunerAmber : color.screenBlue;
  return (
    <View style={[styles.notice, television && styles.noticeTv, {borderLeftColor: noticeColor}]}>
      <AlertTriangle color={noticeColor} size={television ? 28 : 19} strokeWidth={2} />
      <Text style={[television ? styles.noticeTextTv : styles.noticeTextMobile, styles.noticeText]}>{message}</Text>
      {actionLabel && onAction ? (
        <ControlButton compact label={actionLabel} onPress={onAction} platform={platform} />
      ) : null}
    </View>
  );
}

export function EmptyState({
  actionLabel,
  message,
  onAction,
  platform,
  title,
}: {
  actionLabel?: string;
  message: string;
  onAction?(): void;
  platform: PrototypePlatform;
  title: string;
}) {
  const television = platform === 'tv';
  return (
    <View style={[styles.emptyState, television && styles.emptyStateTv]}>
      <View style={[styles.emptyIcon, television && styles.emptyIconTv]}>
        <AlertTriangle color={color.dimSilver} size={television ? 42 : 26} strokeWidth={1.7} />
      </View>
      <Text style={[television ? tvType.section : mobileType.section, styles.emptyTitle]}>{title}</Text>
      <Text style={[television ? tvType.supporting : mobileType.body, styles.emptyMessage]}>{message}</Text>
      {actionLabel && onAction ? <ControlButton icon={RefreshCw} label={actionLabel} onPress={onAction} platform={platform} primary /> : null}
    </View>
  );
}

export function Skeleton({height, style, width}: {height: number; style?: StyleProp<ViewStyle>; width?: number | `${number}%`}) {
  return <View style={[styles.skeleton, {height, width}, style]} />;
}

export function PosterSkeletonGrid({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  const width = television ? 214 : 116;
  return (
    <View style={[styles.skeletonGrid, television && styles.skeletonGridTv]}>
      {Array.from({length: television ? 12 : 9}, (_, index) => (
        <View key={index} style={{width}}>
          <Skeleton height={width * 1.5} width={width} />
          <Skeleton height={television ? 22 : 14} style={television ? styles.skeletonTitleTv : styles.skeletonTitleMobile} width="78%" />
        </View>
      ))}
    </View>
  );
}

export function HeroPlayButton({label, onFocusChange, onPress, platform, requestInitialTVFocus, testID}: {label: string; onFocusChange?(focused: boolean): void; onPress(): void; platform: PrototypePlatform; requestInitialTVFocus?: boolean; testID?: string}) {
  return <ControlButton icon={Play} label={label} onFocusChange={onFocusChange} onPress={onPress} platform={platform} primary requestInitialTVFocus={requestInitialTVFocus} testID={testID} />;
}

export function titleCase(value: string): string {
  return value.replace(/-/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  control: {alignItems: 'center', borderColor: color.lineSoft, borderRadius: radius.control, borderWidth: 3, flexDirection: 'row', justifyContent: 'center'},
  controlMobile: {gap: 8, height: 48, paddingHorizontal: 14},
  controlTv: {gap: 12, height: 64, paddingHorizontal: 22},
  controlCompactMobile: {height: 44, paddingHorizontal: 12},
  controlCompactTv: {height: 56, paddingHorizontal: 18},
  controlPrimary: {backgroundColor: color.silver, borderColor: color.silver},
  controlSelected: {backgroundColor: color.brightSlate, borderColor: color.lineStrong},
  controlFocused: {borderColor: color.focus, borderWidth: 3},
  controlPressed: {backgroundColor: color.brightSlate},
  controlDisabled: {opacity: 0.38},
  controlLabelMobile: {color: color.silver, fontFamily: font.demi, fontSize: 14, lineHeight: 18},
  controlLabelTv: {color: color.silver, fontFamily: font.demi, fontSize: 21, lineHeight: 27},
  controlLabelPrimary: {color: color.projector},
  controlLabelSelected: {color: color.screenBlueStrong},
  iconButton: {alignItems: 'center', backgroundColor: color.scrim, borderColor: color.lineSoft, borderRadius: radius.round, borderWidth: 3, justifyContent: 'center'},
  iconButtonMobile: {height: 48, width: 48},
  iconButtonTv: {height: 64, width: 64},
  iconButtonSelected: {backgroundColor: color.brightSlate, borderColor: color.lineStrong},
  tabs: {borderBottomColor: color.lineSoft, borderBottomWidth: 1, flexDirection: 'row'},
  tabsTv: {gap: 12},
  tab: {alignItems: 'center', justifyContent: 'flex-end'},
  tabMobile: {height: 49, marginRight: 24},
  tabTv: {height: 68, marginRight: 24, paddingHorizontal: 8},
  tabFocused: {backgroundColor: color.raisedSlate},
  tabPressed: {backgroundColor: color.brightSlate},
  tabLabelMobile: {color: color.dimSilver, fontFamily: font.demi, fontSize: 14, lineHeight: 18},
  tabLabelTv: {color: color.dimSilver, fontFamily: font.demi, fontSize: 22, lineHeight: 28},
  tabLabelSelected: {color: color.silver},
  tabRule: {backgroundColor: color.transparent, height: 3, marginTop: 10, width: '100%'},
  tabRuleSelected: {backgroundColor: color.screenBlue},
  mediaCard: {borderColor: color.transparent, borderRadius: radius.surface, borderWidth: 3, padding: 3},
  mediaCardFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  mediaCardPressed: {backgroundColor: color.brightSlate, opacity: 0.82},
  mediaArtworkFrame: {backgroundColor: color.recess, borderRadius: radius.artwork, overflow: 'hidden', width: '100%'},
  mediaArtwork: {height: '100%', width: '100%'} as ImageStyle,
  artworkFallback: {alignItems: 'center', backgroundColor: color.slate, flex: 1, justifyContent: 'center'},
  progressTrack: {backgroundColor: 'rgba(244,247,250,0.28)', bottom: 5, height: 4, left: 5, position: 'absolute', right: 5},
  progressValue: {backgroundColor: color.screenBlueStrong, height: 4},
  mediaTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 14, lineHeight: 18, marginTop: 7},
  mediaTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 21, lineHeight: 26, marginTop: 11},
  mediaMetaMobile: {color: color.dimSilver, fontFamily: font.regular, fontSize: 12, lineHeight: 16, marginTop: 1},
  mediaMetaTv: {color: color.dimSilver, fontFamily: font.regular, fontSize: 18, lineHeight: 23, marginTop: 2},
  sectionHeading: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between'},
  sectionTitle: {color: color.silver},
  sectionAction: {alignItems: 'center', borderColor: color.transparent, borderRadius: radius.control, borderWidth: 2, flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 4},
  sectionActionFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  sectionActionPressed: {backgroundColor: color.brightSlate},
  sectionActionLabelMobile: {color: color.dimSilver, fontFamily: font.medium, fontSize: 13},
  sectionActionLabelTv: {color: color.dimSilver, fontFamily: font.medium, fontSize: 19},
  notice: {alignItems: 'center', backgroundColor: color.slate, borderLeftWidth: 3, flexDirection: 'row', gap: 10, minHeight: 48, paddingHorizontal: 13, paddingVertical: 10},
  noticeTv: {gap: 16, minHeight: 66, paddingHorizontal: 18},
  noticeText: {color: color.softSilver, flex: 1},
  noticeTextMobile: {fontFamily: font.regular, fontSize: 13, lineHeight: 18},
  noticeTextTv: {fontFamily: font.regular, fontSize: 19, lineHeight: 26},
  emptyState: {alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 420, paddingHorizontal: 28},
  emptyStateTv: {minHeight: 660, paddingHorizontal: 80},
  emptyIcon: {alignItems: 'center', backgroundColor: color.slate, borderRadius: radius.round, height: 54, justifyContent: 'center', marginBottom: 18, width: 54},
  emptyIconTv: {height: 82, marginBottom: 24, width: 82},
  emptyTitle: {color: color.silver, textAlign: 'center'},
  emptyMessage: {color: color.dimSilver, marginBottom: 24, marginTop: 8, maxWidth: 640, textAlign: 'center'},
  skeleton: {backgroundColor: color.raisedSlate, borderRadius: radius.artwork},
  skeletonGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  skeletonGridTv: {columnGap: 24, rowGap: 32},
  skeletonTitleMobile: {marginTop: 8},
  skeletonTitleTv: {marginTop: 12},
});
