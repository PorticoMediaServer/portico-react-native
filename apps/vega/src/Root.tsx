import React from 'react';
import App from '../../native/App';
import {DebugConsole} from './debug';
import {Canvas} from './shims/canvas';

/** The shared app, drawn on the television design canvas. */
export function Root(): React.ReactElement {
  return <Canvas><App /><DebugConsole /></Canvas>;
}
