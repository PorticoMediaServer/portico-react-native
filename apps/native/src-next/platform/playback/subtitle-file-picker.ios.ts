import {NativeModules, Platform} from 'react-native';
import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';

type PickedFile = Readonly<{data: string; format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sup' | 'idx'; title: string; companion?: string}>;
type PickerBridge = {pick: (requestId: string) => Promise<unknown>; cancel: (requestId: string) => Promise<unknown>};
const bridge = NativeModules.PorticoSubtitleFiles as Partial<PickerBridge> | undefined;
const ids = NativeModules.PorticoRuntime as {newRequestId?: () => Promise<unknown>} | undefined;
const failure = () => new Error(serviceText('player.subtitles.changeFailed'));
const formats = ['srt', 'vtt', 'ass', 'ssa', 'sup', 'idx'] as const;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytes(value: unknown, limit: number): number {
  if (typeof value !== 'string' || !value.length || value.length % 4 || value.length > Math.ceil(limit / 3) * 4) throw failure();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = value.length - padding;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, end)) || padding === 2 && alphabet.indexOf(value[end - 1]!) % 16 !== 0 || padding === 1 && alphabet.indexOf(value[end - 1]!) % 4 !== 0) throw failure();
  const size = value.length / 4 * 3 - padding;
  if (size < 1 || size > limit) throw failure();
  return size;
}

function selected(value: unknown): PickedFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['data', 'format', 'title', 'companion'].includes(key)) || !formats.includes(row.format as PickedFile['format']) || typeof row.title !== 'string' || !row.title.length || row.title.length > 160) throw failure();
  const format = row.format as PickedFile['format'];
  const size = bytes(row.data, format === 'sup' ? 32 * 1024 * 1024 : 4 * 1024 * 1024);
  if (format === 'idx') bytes(row.companion, 32 * 1024 * 1024 - size);
  else if (row.companion !== undefined) throw failure();
  return Object.freeze({data: row.data as string, format, title: row.title, ...(format === 'idx' ? {companion: row.companion as string} : {})});
}

/** This is the Apple bridge port only. The current playback source owns upload,
 * service authority, language/rights and its complete before/after fence. */
export const appleSubtitleFilePicker = Platform.OS === 'ios' && !Platform.isTV && typeof bridge?.pick === 'function' && typeof bridge.cancel === 'function' && typeof ids?.newRequestId === 'function' ? Object.freeze({
  async pick(signal: AbortSignal): Promise<PickedFile | undefined> {
    if (signal.aborted) return;
    let requestId: string | undefined, started = false;
    let cancelled!: (value: {cancelled: true}) => void;
    const aborted = new Promise<{cancelled: true}>(resolve => {cancelled = resolve;});
    const abort = () => {
      cancelled({cancelled: true});
      if (started && requestId) {
        try { void Promise.resolve(bridge.cancel!(requestId)).catch(() => {}); } catch {}
      }
    };
    signal.addEventListener('abort', abort, {once: true});
    try {
      if (signal.aborted) return;
      const identity = await Promise.race([Promise.resolve(ids.newRequestId!()).then(value => ({value})), aborted]);
      if ('cancelled' in identity || signal.aborted) return;
      if (typeof identity.value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(identity.value)) throw failure();
      requestId = identity.value; started = true;
      const result = await Promise.race([Promise.resolve(bridge.pick!(requestId)).then(value => ({value})), aborted]);
      if ('cancelled' in result || signal.aborted) return;
      return selected(result.value);
    } catch (error) {
      if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'cancelled') return;
      throw failure();
    } finally {
      signal.removeEventListener('abort', abort);
    }
  },
}) : undefined;
