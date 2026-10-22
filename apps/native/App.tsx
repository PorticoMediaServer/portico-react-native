import React from 'react';
import NativeApp, {type NativeAppProps} from './src-next/App';
import {useMenuKey} from './src-next/platform/menu-key';

export default function App(props: NativeAppProps) {
  useMenuKey();
  return <NativeApp {...props} />;
}
