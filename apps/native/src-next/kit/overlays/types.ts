import type React from 'react';
import type {PressableProps, StyleProp, TextStyle, View, ViewStyle} from 'react-native';
import type {TypeStyle} from '@portico/design';
import type {IconName} from '../Icon';

export type OverlayReason = 'close-button' | 'outside' | 'escape' | 'back' | 'action' | 'gesture';
export type FocusTarget = {focus?: () => void; requestTVFocus?: () => void};
export type FocusRef = React.RefObject<FocusTarget | null>;
export type SurfaceProps = {
  open: boolean;
  onOpenChange: (open: boolean, reason: OverlayReason) => void;
  title: React.ReactNode;
  headerContext?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  initialFocusRef?: FocusRef;
  returnFocusRef?: FocusRef;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Replaces the title's complete type style, including normal line-height handling. */
  titleType?: TypeStyle;
  titleTextStyle?: StyleProp<TextStyle>;
  descriptionTextStyle?: StyleProp<TextStyle>;
  /** BottomSheet backdrop alpha; defaults to .64 unless a composition opts in. */
  backdropOpacity?: number;
};
export type DialogProps = SurfaceProps & {
  size?: 'sm' | 'md' | 'lg';
  width?: number;
  placement?: 'center' | 'side';
  dismissOnOutsidePress?: boolean;
  dismissOnBack?: boolean;
  dismissOnGesture?: boolean;
  showClose?: boolean;
};
export type SidePanelProps = SurfaceProps & {
  topInset?: number;
  width?: number;
  closeOnOutsidePress?: boolean;
  dismissOnBack?: boolean;
  showClose?: boolean;
};
export type BottomSheetProps = SurfaceProps & {
  /** Visible heights in points, sorted by the component. The controlled detent is an index. */
  detents?: readonly number[];
  width?: number;
  detent?: number;
  defaultDetent?: number;
  onDetentChange?: (index: number) => void;
  dismissOnOutsidePress?: boolean;
  dismissOnBack?: boolean;
  dismissOnGesture?: boolean;
  scrollable?: boolean;
  showClose?: boolean;
  fitContent?: boolean;
  /** Text-entry sheets move content and footer together above the native keyboard. */
  keyboardAvoiding?: boolean;
  /** Authored footer padding; bottom includes the actual safe area minimum. */
  footerPadding?: {top: number; bottom: number; keyboardBottom: number};
  headerAction?: React.ReactNode;
  /** Replaces only the standard heading row; context and sheet gestures remain. */
  headerContent?: React.ReactNode;
};
export type PopoverProps = SurfaceProps & {
  anchorRef: React.RefObject<View | null>;
  width?: number;
  modal?: boolean;
  /** Native focus containment can hold an in-window TV menu independently of window modality. */
  holdFocus?: boolean;
  showTitle?: boolean;
  backdropOpacity?: number;
  placement?: 'bottom-start' | 'bottom-center' | 'bottom-end' | 'top-start' | 'top-center' | 'top-end';
  offset?: number;
  dismissOnOutsidePress?: boolean;
};
export type MenuAction = {
  id: string;
  label: React.ReactNode;
  icon?: IconName;
  description?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  tone?: 'default' | 'owner';
  /** A nested picker can replace the menu without closing it. */
  closeOnSelect?: boolean;
  onSelect: () => void;
};
export type MenuEntry = MenuAction | {id: string; separator: true} | {id: string; section: true; label: React.ReactNode; tone?: 'default' | 'owner'};
export type MenuProps = Omit<SurfaceProps, 'children' | 'headerContext'> & {
  items: readonly MenuEntry[];
  anchorRef?: React.RefObject<View | null>;
  width?: number;
  presentation?: 'anchored' | 'sheet' | 'sideSheet';
  initialFocusId?: string;
  secondaryTitle?: React.ReactNode;
  context?: React.ReactNode;
};
export type MenuRowProps = Omit<PressableProps, 'children'> & {
  focusId?: string;
  label: React.ReactNode;
  icon?: IconName;
  description?: React.ReactNode;
  selected?: boolean;
  destructive?: boolean;
  tone?: 'default' | 'owner';
  trailing?: React.ReactNode;
  variant?: 'compact' | 'grouped' | 'tv';
  onMenu?: () => void;
};
export type ToastMessage = {
  id: string;
  message: React.ReactNode;
  accessibilityLabel?: string;
  icon?: IconName;
  leading?: React.ReactNode;
  action?: {label: string; onPress: () => void};
  durationMs?: number;
};
export type ToastDismissReason = 'timeout' | 'gesture' | 'action' | 'accessibility';
export type ToastProps = ToastMessage & {
  onDismiss: (id: string, reason: ToastDismissReason) => void;
  onPauseChange?: (paused: boolean, reason?: 'touch' | 'focus' | 'gesture') => void;
  testID?: string;
};
export type ToastHostProps = {
  toast: ToastMessage | null;
  onDismiss: (id: string, reason: ToastDismissReason) => void;
  /** Height of tab bar or dock, excluding the safe-area inset. */
  bottomOffset?: number;
  topOffset?: number;
  testID?: string;
};
export type BannerProps = {
  message: React.ReactNode;
  accessibilityLabel?: string;
  variant?: 'quiet' | 'notice';
  tone?: 'info' | 'warning' | 'error' | 'success';
  icon?: IconName;
  action?: {label: string; onPress: () => void};
  visible?: boolean;
  topInset?: number;
  testID?: string;
};
