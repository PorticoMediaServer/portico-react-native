import type {NativeShellBootstrapContext} from '../../../../../../native/src-next/shell/bootstrap';
import {bindNativeTVTogether as sharedBinding} from '../../../../../../native/src-next/screens/settings-live/together-playback';
import {bindVegaSystemMedia} from '../../../../bridge/system-media-consumer';
export * from '../../../../../../native/src-next/screens/settings-live/together-playback';

/** Keep the original decorated adapter and its authority lifetime; never copy a screen. */
export function bindNativeTVTogether(context: NativeShellBootstrapContext): () => void {
  const offTogether = sharedBinding(context);
  let offSystem: () => void;
  try {offSystem = bindVegaSystemMedia(context);}
  catch (error) {offTogether(); throw error;}
  return () => {try {offSystem();} finally {offTogether();}};
}
