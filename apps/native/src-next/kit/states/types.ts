import type React from 'react';
import type {PressableProps, StyleProp, View, ViewStyle} from 'react-native';
import type {IconName} from '../Icon';

export type StateTone = 'neutral' | 'warning' | 'error' | 'accent';
export type StateAction = Readonly<{
  id: string;
  label: React.ReactNode;
  onPress: NonNullable<PressableProps['onPress']>;
  icon?: IconName;
  trailingIcon?: IconName;
  iconSize?: number;
  accessibilityLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  hasTVPreferredFocus?: boolean;
  accessibilityState?: PressableProps['accessibilityState'];
  ref?: React.Ref<View>;
  testID?: string;
}>;
export type StateContentProps = Readonly<{
  title: React.ReactNode;
  body?: React.ReactNode;
  icon?: IconName;
  tone?: StateTone;
  primaryAction?: StateAction;
  secondaryAction?: StateAction;
  additionalActions?: readonly StateAction[];
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;
