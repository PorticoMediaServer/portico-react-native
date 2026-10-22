import React, {type ComponentType} from 'react';
import {Platform, StatusBar, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ThemeProvider, useTheme} from './kit/theme';

const KitHost: ComponentType<{shell?: ComponentType}> | undefined = __DEV__ ? require('./dev/Kit').KitHost : undefined;
export type NativeAppProps = {phoneShell?: ComponentType; tvShell?: ComponentType; reduceMotion?: boolean; textScale?: number};

function NativeRoot({phoneShell, tvShell}: NativeAppProps) {
  const {colors} = useTheme();
  const Shell = Platform.isTV ? tvShell : phoneShell;
  return <View testID="native-root" style={{flex: 1, backgroundColor: colors.ink}}><StatusBar barStyle="light-content" />{KitHost ? <KitHost shell={Shell} /> : Shell ? <Shell /> : null}</View>;
}

/** Shell lanes supply their real roots here; the scaffold ships no sample product content. */
export default function App(props: NativeAppProps) {
  return <GestureHandlerRootView style={{flex: 1}}><SafeAreaProvider><ThemeProvider reduceMotion={props.reduceMotion} textScale={props.textScale}><NativeRoot {...props} /></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>;
}
