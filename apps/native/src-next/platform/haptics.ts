import {NativeModules, Platform} from 'react-native';

/** True means the OS admitted the feedback request, never proof that hardware vibrated. */
export async function selectionHaptic(enabled = true): Promise<boolean> {
  if (!enabled || Platform.isTV || (Platform.OS !== 'android' && Platform.OS !== 'ios')) return false;
  const bridge = NativeModules.PorticoHaptics as {selection?: () => Promise<boolean>} | undefined;
  if (typeof bridge?.selection !== 'function') return false;
  try { return await bridge.selection() === true; } catch { return false; }
}
