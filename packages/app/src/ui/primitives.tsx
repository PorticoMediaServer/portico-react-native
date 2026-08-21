import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
  type ImageStyle,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  PorticoIcon,
  type PorticoIconId,
  type PorticoIconState,
} from '@portico-react-native/icons';
import {
  productMessage,
  type ProductMessageId,
  type ProductMessageVariables,
} from '@portico/client-core';
import type {PrototypePlatform} from '../ui-compat/contract';
import type {MediaCardRenderItem} from '../data/contracts';
import {serverImageSource} from '@portico-react-native/infrastructure';
import type {
  TVFocusDirection,
  TVLogicalFocusContainer,
  TVLogicalFocusNode,
} from '@portico-react-native/tv-focus';
import {color, fill, font, mobileType, radius, tvType} from './tokens';
import {safeProductCopy} from './productCopy';
import {
  mediaArtworkFailureCacheVersion,
  mediaArtworkFailureExpiresAt,
  rememberMediaArtworkFailure,
  subscribeMediaArtworkFailureCache,
} from './artworkFailureCache';

export type TVFocusNode = View & {requestTVFocus?: () => void};
interface ContentFocusRegistry {
  focused(
    node?: TVFocusNode,
    semanticId?: string,
    metadata?: TVFocusableLogicalMetadata,
  ): void;
  mounted(
    node: TVFocusNode,
    semanticId?: string,
    metadata?: TVFocusableLogicalMetadata,
  ): void;
  unmounted(
    node: TVFocusNode,
    semanticId?: string,
    metadata?: TVFocusableLogicalMetadata,
  ): void;
}
export interface TVFocusableLogicalMetadata extends Omit<
  TVLogicalFocusNode,
  'containerId' | 'id'
> {
  container: TVLogicalFocusContainer;
}
const LogicalFocusContainerContext = createContext<
  TVLogicalFocusContainer | undefined
>(undefined);
const ContentFocusContext = createContext<ContentFocusRegistry>({
  focused: () => undefined,
  mounted: () => undefined,
  unmounted: () => undefined,
});

let lastFocusedTVNode: TVFocusNode | undefined;

export function useTVModalFocusRestoration(active: boolean): {
  abandon(): void;
  onDismiss(): void;
} {
  const invoker = useRef<TVFocusNode | undefined>(undefined);
  const wasActive = useRef(false);
  const dismissFrame = useRef<number | undefined>(undefined);
  if (active && !wasActive.current) invoker.current = lastFocusedTVNode;
  wasActive.current = active;
  const onDismiss = React.useCallback(() => {
    const target = invoker.current;
    invoker.current = undefined;
    if (dismissFrame.current !== undefined)
      cancelAnimationFrame(dismissFrame.current);
    dismissFrame.current = requestAnimationFrame(() => {
      dismissFrame.current = undefined;
      target?.requestTVFocus?.();
    });
  }, []);
  const abandon = React.useCallback(() => {
    if (dismissFrame.current !== undefined)
      cancelAnimationFrame(dismissFrame.current);
    dismissFrame.current = undefined;
    invoker.current = undefined;
  }, []);
  useEffect(
    () => () => {
      if (wasActive.current) onDismiss();
      else abandon();
    },
    [abandon, onDismiss],
  );
  return {abandon, onDismiss};
}

export function TVModalFocusTrap({
  children,
  platform,
  style,
}: {
  children: React.ReactNode;
  platform: PrototypePlatform;
  style?: StyleProp<ViewStyle>;
}) {
  if (platform !== 'tv')
    return (
      <View accessibilityViewIsModal style={style}>
        {children}
      </View>
    );
  return (
    <TVFocusGuideView
      accessibilityViewIsModal
      autoFocus
      trapFocusDown
      trapFocusLeft
      trapFocusRight
      trapFocusUp
      style={style}
    >
      {children}
    </TVFocusGuideView>
  );
}

export function ContentFocusProvider({
  children,
  onContentFocus,
  onContentMount,
  onContentUnmount,
}: {
  children: React.ReactNode;
  onContentFocus(
    node?: TVFocusNode,
    semanticId?: string,
    metadata?: TVFocusableLogicalMetadata,
  ): void;
  onContentMount?(
    node: TVFocusNode,
    semanticId?: string,
    metadata?: TVFocusableLogicalMetadata,
  ): void;
  onContentUnmount?(
    node: TVFocusNode,
    semanticId?: string,
    metadata?: TVFocusableLogicalMetadata,
  ): void;
}) {
  const value = React.useMemo<ContentFocusRegistry>(
    () => ({
      focused: onContentFocus,
      mounted: (node, semanticId, metadata) =>
        onContentMount?.(node, semanticId, metadata),
      unmounted: (node, semanticId, metadata) =>
        onContentUnmount?.(node, semanticId, metadata),
    }),
    [onContentFocus, onContentMount, onContentUnmount],
  );
  return (
    <ContentFocusContext.Provider value={value}>
      {children}
    </ContentFocusContext.Provider>
  );
}

export function TVLogicalFocusContainerBoundary({
  children,
  container,
}: {
  children: React.ReactNode;
  container: TVLogicalFocusContainer;
}) {
  return (
    <LogicalFocusContainerContext.Provider value={container}>
      {children}
    </LogicalFocusContainerContext.Provider>
  );
}

export function useContentFocus(): (node?: TVFocusNode) => void {
  return useContext(ContentFocusContext).focused;
}

export function ArtworkScrim({
  platform,
  strong = false,
}: {
  platform: PrototypePlatform;
  strong?: boolean;
}) {
  const television = platform === 'tv';
  return (
    <View pointerEvents="none" style={fill}>
      <Svg height="100%" width="100%" style={fill}>
        <Defs>
          <LinearGradient id="porticoVertical" x1="0" x2="0" y1="0" y2="1">
            <Stop
              offset="0"
              stopColor={color.projector}
              stopOpacity={strong ? 0.28 : 0.1}
            />
            <Stop
              offset="0.5"
              stopColor={color.projector}
              stopOpacity={strong ? 0.46 : 0.12}
            />
            <Stop offset="1" stopColor={color.projector} stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="porticoHorizontal" x1="0" x2="1" y1="0" y2="0">
            <Stop
              offset="0"
              stopColor={color.projector}
              stopOpacity={television ? 0.94 : 0.28}
            />
            <Stop
              offset="0.48"
              stopColor={color.projector}
              stopOpacity={television ? 0.68 : 0.04}
            />
            <Stop
              offset="1"
              stopColor={color.projector}
              stopOpacity={television ? 0.08 : 0}
            />
          </LinearGradient>
        </Defs>
        <Rect fill="url(#porticoVertical)" height="100%" width="100%" />
        <Rect fill="url(#porticoHorizontal)" height="100%" width="100%" />
      </Svg>
    </View>
  );
}

/** A quiet blue fallback for hero surfaces that do not have server artwork. */
export function AmbientArtworkGlow({platform}: {platform: PrototypePlatform}) {
  const television = platform === 'tv';
  return (
    <View pointerEvents="none" style={styles.artworkGlow}>
      <Svg
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        width="100%"
      >
        <Defs>
          <RadialGradient
            id="porticoAmbientBlue"
            cx={television ? '38%' : '54%'}
            cy="-8%"
            fx={television ? '34%' : '50%'}
            fy="-12%"
            r={television ? '88%' : '78%'}
          >
            <Stop
              offset="0"
              stopColor={color.screenBlueDeep}
              stopOpacity={television ? 0.2 : 0.18}
            />
            <Stop
              offset="0.38"
              stopColor={color.screenBlueDeep}
              stopOpacity={television ? 0.1 : 0.08}
            />
            <Stop
              offset="0.72"
              stopColor={color.screenBlueDeep}
              stopOpacity="0.025"
            />
            <Stop offset="1" stopColor={color.screenBlueDeep} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="porticoAmbientFade" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor={color.projector} stopOpacity="0" />
            <Stop
              offset="0.56"
              stopColor={color.projector}
              stopOpacity="0.22"
            />
            <Stop offset="1" stopColor={color.projector} stopOpacity="0.72" />
          </LinearGradient>
        </Defs>
        <Rect fill={color.recess} height="100" width="100" />
        <Rect fill="url(#porticoAmbientBlue)" height="100" width="100" />
        <Rect fill="url(#porticoAmbientFade)" height="100" width="100" />
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
  /**
   * Stable, route-local identity used to restore television focus after a
   * navigator detaches or remounts the native view. Test ids are used as a
   * safe fallback, but product surfaces should provide a semantic id when a
   * target can move or be virtualized.
   */
  tvFocusId?: string;
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
  tvFocusNeighbours?: TVLogicalFocusNode['neighbours'];
  tvFocusOrder?: number;
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
  testID,
  tvFocusId,
  tvFocusBoundaryDirections,
  tvFocusNeighbours,
  tvFocusOrder,
  ...props
}: FocusableProps) {
  const [focused, setFocused] = useState(false);
  const contentFocus = useContext(ContentFocusContext);
  const logicalContainer = useContext(LogicalFocusContainerContext);
  const logicalMetadata = React.useMemo<TVFocusableLogicalMetadata | undefined>(
    () =>
      logicalContainer
        ? {
            boundaryDirections: tvFocusBoundaryDirections,
            container: logicalContainer,
            disabled: Boolean(props.disabled),
            neighbours: tvFocusNeighbours,
            order: tvFocusOrder,
          }
        : undefined,
    [
      logicalContainer,
      props.disabled,
      tvFocusBoundaryDirections,
      tvFocusNeighbours,
      tvFocusOrder,
    ],
  );
  const nativeRef = useRef<TVFocusNode | null>(null);
  const setNativeRef = React.useCallback(
    (node: TVFocusNode | null) => {
      const previous = nativeRef.current;
      const semanticId = tvFocusId ?? testID;
      if (previous && previous !== node)
        contentFocus.unmounted(previous, semanticId, logicalMetadata);
      nativeRef.current = node;
      if (node?.requestTVFocus && previous !== node)
        contentFocus.mounted(node, semanticId, logicalMetadata);
    },
    [contentFocus, logicalMetadata, testID, tvFocusId],
  );

  return (
    <Pressable
      {...props}
      testID={testID}
      ref={node => setNativeRef(node as TVFocusNode | null)}
      onBlur={event => {
        setFocused(false);
        onFocusChange?.(false);
        onBlur?.(event);
      }}
      onFocus={event => {
        setFocused(true);
        if (platform === 'tv') {
          lastFocusedTVNode = nativeRef.current ?? undefined;
          contentFocus.focused(
            nativeRef.current?.requestTVFocus ? nativeRef.current : undefined,
            tvFocusId ?? testID,
            logicalMetadata,
          );
        }
        onFocusChange?.(true);
        onFocus?.(event);
      }}
      style={({pressed}) => [
        style,
        focused && focusedStyle,
        pressed && pressedStyle,
      ]}
    >
      {children}
    </Pressable>
  );
}

type LegacyIconComponent = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;
export type PorticoIconSource = PorticoIconId | LegacyIconComponent;

interface ControlButtonProps {
  accessibilityLabel?: string;
  compact?: boolean;
  dense?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: PorticoIconSource;
  label?: string;
  onPress(): void;
  onFocusChange?(focused: boolean): void;
  platform: PrototypePlatform;
  selected?: boolean;
  primary?: boolean;
  requestInitialTVFocus?: boolean;
  testID?: string;
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
  tvFocusNeighbours?: TVLogicalFocusNode['neighbours'];
}

export function ControlButton({
  accessibilityLabel,
  compact,
  dense,
  disabled,
  busy,
  icon,
  label,
  onPress,
  onFocusChange,
  platform,
  primary,
  requestInitialTVFocus,
  selected,
  testID,
  tvFocusBoundaryDirections,
  tvFocusNeighbours,
}: ControlButtonProps) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{busy, disabled: Boolean(disabled || busy), selected}}
      disabled={disabled || busy}
      hasTVPreferredFocus={television && requestInitialTVFocus}
      onFocusChange={onFocusChange}
      onPress={onPress}
      platform={platform}
      style={[
        styles.control,
        television ? styles.controlTv : styles.controlMobile,
        compact &&
          (television ? styles.controlCompactTv : styles.controlCompactMobile),
        dense && !television && styles.controlDenseMobile,
        primary && styles.controlPrimary,
        selected && styles.controlSelected,
        (disabled || busy) && styles.controlDisabled,
      ]}
      focusedStyle={styles.controlFocused}
      pressedStyle={styles.controlPressed}
      testID={testID}
      tvFocusBoundaryDirections={tvFocusBoundaryDirections}
      tvFocusId={
        testID ??
        ((accessibilityLabel ?? label)
          ? `control:${accessibilityLabel ?? label}`
          : undefined)
      }
      tvFocusNeighbours={tvFocusNeighbours}
    >
      {icon
        ? renderIcon(
            icon,
            primary
              ? color.projector
              : selected
                ? color.screenBlueStrong
                : color.silver,
            television ? 26 : dense ? 16 : 19,
            selected ? 'selected' : disabled || busy ? 'disabled' : 'default',
          )
        : null}
      {label ? (
        <Text
          numberOfLines={platform === 'tv' ? 1 : undefined}
          style={[
            television ? styles.controlLabelTv : styles.controlLabelMobile,
            dense && !television && styles.controlLabelDenseMobile,
            primary && styles.controlLabelPrimary,
            selected && styles.controlLabelSelected,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Focusable>
  );
}

export function IconButton({
  busy,
  disabled,
  icon,
  label,
  onPress,
  platform,
  selected,
  tvFocusBoundaryDirections,
  tvFocusNeighbours,
  tvFocusOrder,
}: {
  busy?: boolean;
  disabled?: boolean;
  icon: PorticoIconSource;
  label: string;
  onPress(): void;
  platform: PrototypePlatform;
  selected?: boolean;
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
  tvFocusNeighbours?: TVLogicalFocusNode['neighbours'];
  tvFocusOrder?: number;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy, disabled: Boolean(disabled || busy), selected}}
      disabled={disabled || busy}
      onPress={onPress}
      platform={platform}
      style={[
        styles.iconButton,
        television ? styles.iconButtonTv : styles.iconButtonMobile,
        selected && styles.iconButtonSelected,
      ]}
      focusedStyle={styles.controlFocused}
      pressedStyle={styles.controlPressed}
      tvFocusBoundaryDirections={tvFocusBoundaryDirections}
      tvFocusId={`action:${label}`}
      tvFocusNeighbours={tvFocusNeighbours}
      tvFocusOrder={tvFocusOrder}
    >
      {renderIcon(
        icon,
        selected ? color.screenBlueStrong : color.silver,
        television ? 29 : 21,
        selected ? 'selected' : disabled || busy ? 'disabled' : 'default',
      )}
    </Focusable>
  );
}

export function UnderlineTabs({
  active,
  onChange,
  onTabLayout,
  platform,
  tabs,
}: {
  active: string;
  onChange(value: string): void;
  onTabLayout?(tab: string, x: number, width: number): void;
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
            onLayout={event =>
              onTabLayout?.(
                tab,
                event.nativeEvent.layout.x,
                event.nativeEvent.layout.width,
              )
            }
            onPress={() => onChange(tab)}
            platform={platform}
            style={[styles.tab, television ? styles.tabTv : styles.tabMobile]}
            focusedStyle={styles.tabFocused}
            pressedStyle={styles.tabPressed}
            tvFocusId={`pivot:${tab}`}
          >
            <Text
              style={[
                television ? styles.tabLabelTv : styles.tabLabelMobile,
                selected && styles.tabLabelSelected,
              ]}
            >
              {tab}
            </Text>
            <View
              style={[
                television ? styles.tabRule : styles.tabRuleMobile,
                selected && styles.tabRuleSelected,
              ]}
            />
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
  selected = false,
  shape = item.shape ?? 'poster',
  tvFocusId,
  tvFocusBoundaryDirections,
  width,
}: {
  artworkFailure?: boolean;
  item: MediaCardRenderItem;
  onFocus?(): void;
  onPress(): void;
  platform: PrototypePlatform;
  selected?: boolean;
  shape?: MediaCardShape;
  tvFocusId?: string;
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
  width?: number;
}) {
  const television = platform === 'tv';
  useSyncExternalStore(
    subscribeMediaArtworkFailureCache,
    mediaArtworkFailureCacheVersion,
    mediaArtworkFailureCacheVersion,
  );
  const cardWidth =
    width ??
    (television
      ? shape === 'landscape'
        ? 320
        : 214
      : shape === 'landscape'
        ? 208
        : 126);
  const artworkHeight =
    shape === 'landscape'
      ? cardWidth * 0.5625
      : shape === 'square'
        ? cardWidth
        : cardWidth * 1.5;
  const source = artworkFailure
    ? undefined
    : serverImageSource(shape === 'landscape' ? item.backdrop : item.poster);
  const sourceUri = source?.uri;
  // The failure cache owns the single expiry timer for each viewer-scoped
  // source. The card only subscribes to cache changes; it never creates a
  // second retry timer from an image callback.
  const showFallback = !source || mediaArtworkFailureExpiresAt(sourceUri) > 0;

  return (
    <Focusable
      accessibilityLabel={`${item.title}${item.subtitle ? `. ${item.subtitle}` : ''}`}
      accessibilityRole="button"
      accessibilityState={{selected}}
      onFocus={onFocus}
      onPress={onPress}
      platform={platform}
      style={[
        styles.mediaCard,
        selected && styles.mediaCardSelected,
        {width: cardWidth},
      ]}
      focusedStyle={styles.mediaCardFocused}
      pressedStyle={styles.mediaCardPressed}
      tvFocusBoundaryDirections={tvFocusBoundaryDirections}
      tvFocusId={tvFocusId ?? `media:${item.id}`}
    >
      <View style={[styles.mediaArtworkFrame, {height: artworkHeight}]}>
        {showFallback ? (
          <View style={styles.artworkFallback}>
            <PorticoIcon
              color={color.mutedSilver}
              id="status.artwork-unavailable"
              size={television ? 40 : 24}
              strokeWidth={1.6}
            />
          </View>
        ) : (
          <Image
            onError={() => {
              rememberMediaArtworkFailure(sourceUri);
            }}
            resizeMode="cover"
            source={source}
            style={styles.mediaArtwork}
          />
        )}
        {typeof item.progress === 'number' ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressValue,
                {width: `${Math.max(4, item.progress)}%`},
              ]}
            />
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={television ? styles.mediaTitleTv : styles.mediaTitleMobile}
      >
        {item.title}
      </Text>
      <Text
        numberOfLines={1}
        style={television ? styles.mediaMetaTv : styles.mediaMetaMobile}
      >
        {item.kind === 'episode' && item.subtitle
          ? item.subtitle
          : (item.year ?? item.subtitle ?? titleCase(item.kind))}
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
      <Text
        style={[
          television ? tvType.section : mobileType.section,
          styles.sectionTitle,
        ]}
      >
        {title}
      </Text>
      {action && onAction ? (
        <Focusable
          accessibilityLabel={`${action} ${title}`}
          accessibilityRole="button"
          onPress={onAction}
          platform={platform}
          style={styles.sectionAction}
          focusedStyle={styles.sectionActionFocused}
          pressedStyle={styles.sectionActionPressed}
          tvFocusId={`section:${title}:${action}`}
        >
          <Text
            style={
              television
                ? styles.sectionActionLabelTv
                : styles.sectionActionLabelMobile
            }
          >
            {action}
          </Text>
          <PorticoIcon
            color={color.dimSilver}
            id="navigation.disclosure"
            size={television ? 26 : 18}
          />
        </Focusable>
      ) : null}
    </View>
  );
}

export function InlineNotice({
  actionLabel,
  icon,
  kind = 'info',
  message,
  onAction,
  platform,
}: {
  actionLabel?: string;
  icon?: PorticoIconId;
  kind?: 'info' | 'success' | 'warning' | 'error';
  message: string;
  onAction?(): void;
  platform: PrototypePlatform;
}) {
  const television = platform === 'tv';
  const noticeColor =
    kind === 'error'
      ? color.record
      : kind === 'warning'
        ? color.tunerAmber
        : kind === 'success'
          ? color.healthy
          : color.screenBlue;
  const noticeIcon =
    icon ??
    (kind === 'error'
      ? 'status.error'
      : kind === 'warning'
        ? 'status.warning'
        : kind === 'success'
          ? 'status.success'
          : 'status.info');
  return (
    <View
      style={[
        styles.notice,
        television && styles.noticeTv,
        {borderLeftColor: noticeColor},
      ]}
    >
      <PorticoIcon
        color={noticeColor}
        id={noticeIcon}
        size={television ? 28 : 19}
      />
      <Text
        style={[
          television ? styles.noticeTextTv : styles.noticeTextMobile,
          styles.noticeText,
        ]}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <ControlButton
          compact
          label={actionLabel}
          onPress={onAction}
          platform={platform}
        />
      ) : null}
    </View>
  );
}

export function EmptyState({
  actionLabel,
  actionIcon = 'action.retry',
  icon = 'status.empty',
  kind = 'neutral',
  message,
  onAction,
  platform,
  title,
}: {
  actionLabel?: string;
  actionIcon?: PorticoIconId;
  icon?: PorticoIconId;
  kind?: 'neutral' | 'loading' | 'warning' | 'error';
  message: string;
  onAction?(): void;
  platform: PrototypePlatform;
  title: string;
}) {
  const television = platform === 'tv';
  const iconColor =
    kind === 'error'
      ? color.record
      : kind === 'warning'
        ? color.tunerAmber
        : color.dimSilver;
  return (
    <View style={[styles.emptyState, television && styles.emptyStateTv]}>
      <View style={[styles.emptyIcon, television && styles.emptyIconTv]}>
        <PorticoIcon
          color={iconColor}
          id={icon}
          size={television ? 42 : 26}
          strokeWidth={1.7}
        />
      </View>
      <Text
        style={[
          television ? tvType.section : mobileType.section,
          styles.emptyTitle,
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          television ? tvType.supporting : mobileType.body,
          styles.emptyMessage,
        ]}
      >
        {message}
      </Text>
      {actionLabel && onAction ? (
        <ControlButton
          icon={actionIcon}
          label={actionLabel}
          onPress={onAction}
          platform={platform}
          primary
        />
      ) : null}
    </View>
  );
}

export function ProductEmptyState({
  id,
  onAction,
  platform,
  variables = {},
}: {
  id: ProductMessageId;
  onAction?(): void;
  platform: PrototypePlatform;
  variables?: ProductMessageVariables;
}) {
  const presentation = productMessage(id, variables);
  const actionId = presentation.actions?.[0]?.id;
  const action = actionId ? productMessage(actionId, variables) : undefined;
  return (
    <EmptyState
      actionIcon={productIconId(actionId)}
      actionLabel={safeProductCopy(
        action?.text ?? action?.title ?? action?.body,
      )}
      icon={productIconId(presentation.icon)}
      kind={
        presentation.tone === 'error'
          ? 'error'
          : presentation.tone === 'warning'
            ? 'warning'
            : presentation.icon === 'status.loading'
              ? 'loading'
              : 'neutral'
      }
      message={safeProductCopy(presentation.body ?? presentation.text)}
      onAction={onAction}
      platform={platform}
      title={safeProductCopy(presentation.title ?? presentation.text)}
    />
  );
}

const productIconIds: Readonly<Record<string, PorticoIconId>> = {
  'action.retry': 'action.retry',
  'action.search': 'navigation.search',
  'status.error': 'status.error',
  'status.library': 'library.collection',
  'status.library-channel': 'device.tv',
  'status.live-tv': 'media.live-tv',
  'status.loading': 'status.loading',
  'status.offline': 'status.offline',
  'status.playback': 'playback.play',
  'status.success': 'status.success',
  'status.warning': 'status.warning',
};

function productIconId(id: string | undefined): PorticoIconId {
  if (!id) return 'status.empty';
  const resolved = productIconIds[id];
  if (!resolved)
    throw new Error(
      `Product icon '${id}' is not registered with the Portico icon contract.`,
    );
  return resolved;
}

function renderIcon(
  icon: PorticoIconSource,
  iconColor: string,
  size: number,
  state: PorticoIconState,
): React.ReactNode {
  if (typeof icon === 'string')
    return (
      <PorticoIcon
        color={iconColor}
        id={icon}
        size={size}
        state={state}
        strokeWidth={2.1}
      />
    );
  const LegacyIcon = icon;
  return <LegacyIcon color={iconColor} size={size} strokeWidth={2.1} />;
}

export function IconGlyph({
  color: iconColor,
  icon,
  size,
  state = 'default',
}: {
  color: string;
  icon: PorticoIconSource;
  size: number;
  state?: PorticoIconState;
}) {
  return <>{renderIcon(icon, iconColor, size, state)}</>;
}

export function Skeleton({
  height,
  style,
  width,
}: {
  height: number;
  style?: StyleProp<ViewStyle>;
  width?: number | `${number}%`;
}) {
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
          <Skeleton
            height={television ? 22 : 14}
            style={
              television ? styles.skeletonTitleTv : styles.skeletonTitleMobile
            }
            width="78%"
          />
        </View>
      ))}
    </View>
  );
}

export function HeroPlayButton({
  label,
  onFocusChange,
  onPress,
  platform,
  requestInitialTVFocus,
  testID,
  tvFocusBoundaryDirections,
}: {
  label: string;
  onFocusChange?(focused: boolean): void;
  onPress(): void;
  platform: PrototypePlatform;
  requestInitialTVFocus?: boolean;
  testID?: string;
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
}) {
  return (
    <ControlButton
      icon="playback.play"
      label={label}
      onFocusChange={onFocusChange}
      onPress={onPress}
      platform={platform}
      primary
      requestInitialTVFocus={requestInitialTVFocus}
      testID={testID}
      tvFocusBoundaryDirections={tvFocusBoundaryDirections}
    />
  );
}

export function titleCase(value: string): string {
  return value
    .replace(/-/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  artworkGlow: {
    backgroundColor: color.recess,
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  control: {
    alignItems: 'center',
    borderColor: color.lineSoft,
    borderRadius: radius.control,
    borderWidth: 3,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  controlMobile: {gap: 8, height: 48, paddingHorizontal: 14},
  controlTv: {gap: 12, height: 64, paddingHorizontal: 22},
  controlCompactMobile: {height: 44, paddingHorizontal: 12},
  controlDenseMobile: {
    borderWidth: 2,
    gap: 5,
    height: 36,
    paddingHorizontal: 8,
  },
  controlCompactTv: {height: 56, paddingHorizontal: 18},
  controlPrimary: {backgroundColor: color.silver, borderColor: color.silver},
  controlSelected: {
    backgroundColor: color.brightSlate,
    borderColor: color.lineStrong,
  },
  controlFocused: {borderColor: color.focus, borderWidth: 3},
  controlPressed: {backgroundColor: color.brightSlate},
  controlDisabled: {opacity: 0.38},
  controlLabelMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 14,
    lineHeight: 18,
  },
  controlLabelDenseMobile: {fontSize: 12, lineHeight: 16},
  controlLabelTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 21,
    lineHeight: 27,
  },
  controlLabelPrimary: {color: color.projector},
  controlLabelSelected: {color: color.screenBlueStrong},
  iconButton: {
    alignItems: 'center',
    backgroundColor: color.scrim,
    borderColor: color.lineSoft,
    borderRadius: radius.round,
    borderWidth: 3,
    justifyContent: 'center',
  },
  iconButtonMobile: {height: 48, width: 48},
  iconButtonTv: {height: 64, width: 64},
  iconButtonSelected: {
    backgroundColor: color.brightSlate,
    borderColor: color.lineStrong,
  },
  tabs: {
    borderBottomColor: color.lineSoft,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  tabsTv: {gap: 12},
  tab: {alignItems: 'center', justifyContent: 'flex-end'},
  tabMobile: {
    alignSelf: 'stretch',
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    marginRight: 20,
    minHeight: 49,
    paddingHorizontal: 4,
    position: 'relative',
  },
  tabTv: {
    borderColor: color.transparent,
    borderRadius: 8,
    borderWidth: 3,
    height: 68,
    marginRight: 18,
    paddingHorizontal: 8,
  },
  tabFocused: {borderColor: color.focus},
  tabPressed: {backgroundColor: color.brightSlate},
  tabLabelMobile: {
    color: color.dimSilver,
    fontFamily: font.demi,
    fontSize: 14,
    lineHeight: 18,
  },
  tabLabelTv: {
    color: color.dimSilver,
    fontFamily: font.demi,
    fontSize: 22,
    lineHeight: 28,
  },
  tabLabelSelected: {color: color.silver},
  tabRule: {
    backgroundColor: color.transparent,
    height: 3,
    marginTop: 10,
    width: '100%',
  },
  tabRuleMobile: {
    backgroundColor: color.transparent,
    bottom: 0,
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  tabRuleSelected: {backgroundColor: color.screenBlue},
  mediaCard: {
    borderColor: color.transparent,
    borderRadius: radius.surface,
    borderWidth: 3,
    padding: 3,
  },
  mediaCardSelected: {
    backgroundColor: color.raisedSlate,
    borderColor: color.screenBlue,
  },
  mediaCardFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  mediaCardPressed: {backgroundColor: color.brightSlate, opacity: 0.82},
  mediaArtworkFrame: {
    backgroundColor: color.recess,
    borderRadius: radius.artwork,
    overflow: 'hidden',
    width: '100%',
  },
  mediaArtwork: {height: '100%', width: '100%'} as ImageStyle,
  artworkFallback: {
    alignItems: 'center',
    backgroundColor: color.slate,
    flex: 1,
    justifyContent: 'center',
  },
  progressTrack: {
    backgroundColor: 'rgba(244,247,250,0.28)',
    bottom: 5,
    height: 4,
    left: 5,
    position: 'absolute',
    right: 5,
  },
  progressValue: {backgroundColor: color.screenBlueStrong, height: 4},
  mediaTitleMobile: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 14,
    lineHeight: 18,
    marginTop: 7,
  },
  mediaTitleTv: {
    color: color.silver,
    fontFamily: font.demi,
    fontSize: 21,
    lineHeight: 26,
    marginTop: 11,
  },
  mediaMetaMobile: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1,
  },
  mediaMetaTv: {
    color: color.dimSilver,
    fontFamily: font.regular,
    fontSize: 18,
    lineHeight: 23,
    marginTop: 2,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {color: color.silver},
  sectionAction: {
    alignItems: 'center',
    borderColor: color.transparent,
    borderRadius: radius.control,
    borderWidth: 2,
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  sectionActionFocused: {
    backgroundColor: color.raisedSlate,
    borderColor: color.focus,
  },
  sectionActionPressed: {backgroundColor: color.brightSlate},
  sectionActionLabelMobile: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 13,
  },
  sectionActionLabelTv: {
    color: color.dimSilver,
    fontFamily: font.medium,
    fontSize: 19,
  },
  notice: {
    alignItems: 'center',
    backgroundColor: color.slate,
    borderLeftWidth: 3,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  noticeTv: {gap: 16, minHeight: 66, paddingHorizontal: 18},
  noticeText: {color: color.softSilver, flex: 1},
  noticeTextMobile: {fontFamily: font.regular, fontSize: 13, lineHeight: 18},
  noticeTextTv: {fontFamily: font.regular, fontSize: 19, lineHeight: 26},
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 420,
    paddingHorizontal: 28,
  },
  emptyStateTv: {minHeight: 660, paddingHorizontal: 80},
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: color.slate,
    borderRadius: radius.round,
    height: 54,
    justifyContent: 'center',
    marginBottom: 18,
    width: 54,
  },
  emptyIconTv: {height: 82, marginBottom: 24, width: 82},
  emptyTitle: {color: color.silver, textAlign: 'center'},
  emptyMessage: {
    color: color.dimSilver,
    marginBottom: 24,
    marginTop: 8,
    maxWidth: 640,
    textAlign: 'center',
  },
  skeleton: {backgroundColor: color.raisedSlate, borderRadius: radius.artwork},
  skeletonGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  skeletonGridTv: {columnGap: 24, rowGap: 32},
  skeletonTitleMobile: {marginTop: 8},
  skeletonTitleTv: {marginTop: 12},
});
