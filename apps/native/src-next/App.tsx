import React, {useMemo, type ComponentType} from 'react';
import {Platform, StatusBar, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ThemeProvider, useTheme} from './kit/theme';
import {NativeShell, type NativeShellRuntime} from './shell';
import {RestoredShell} from './shell/RestoredShell';

if (!Platform.isTV) {
  require('./screens/downloads/register');
  require('./screens/library/register');
  require('./screens/read/register');
  const {registerNativeWatch, createNativeWatchBindings} = require('./screens/watch') as typeof import('./screens/watch');
  registerNativeWatch(createNativeWatchBindings);
}
require('./screens/home/CustomizeRoute');
require('./screens/home/SeeAllRoute');
require('./screens/settings-live/LiveRoute');
require('./screens/settings-live/TogetherRoute');
const TVRoot: ComponentType | undefined = Platform.isTV ? require('./tv/register').TVRoot : undefined;

const KitHost: ComponentType<{shell?: ComponentType}> | undefined = __DEV__ ? require('./dev/Kit').KitHost : undefined;
export type NativeAppProps = {phoneShell?: ComponentType; tvShell?: ComponentType; runtime?: NativeShellRuntime; reduceMotion?: boolean; textScale?: number};

function NativeRoot({phoneShell, tvShell, runtime}: NativeAppProps) {
  const {colors} = useTheme();
  const RuntimeShell = useMemo(() => runtime ? function BoundNativeShell() {return <NativeShell runtime={runtime}/>;} : undefined, [runtime]);
  const Shell = RuntimeShell ?? (Platform.isTV ? tvShell ?? TVRoot : phoneShell) ?? RestoredShell;
  return <View testID="native-root" style={{flex: 1, backgroundColor: colors.ink}}><StatusBar barStyle="light-content" />{KitHost ? <KitHost shell={Shell} /> : Shell ? <Shell /> : null}</View>;
}

/** The product restores its actual native session; test/dev hosts may inject an owned runtime. */
export default function App(props: NativeAppProps) {
  return <GestureHandlerRootView style={{flex: 1}}><SafeAreaProvider><ThemeProvider reduceMotion={props.reduceMotion} textScale={props.textScale}><NativeRoot {...props} /></ThemeProvider></SafeAreaProvider></GestureHandlerRootView>;
}
