import React from 'react';
import {PorticoApp} from '@portico-react-native/app';
import {GestureHandlerRootView} from 'react-native-gesture-handler';

function App() {
  return <GestureHandlerRootView style={{flex: 1}}><PorticoApp platform="mobile" /></GestureHandlerRootView>;
}

export default App;
