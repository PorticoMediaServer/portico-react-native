import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';
import type {NativePlaybackSubtitleUpload} from './subtitle-controls';

export type NativeSubtitlePickedFile = Readonly<{
  data: string; format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sup' | 'idx'; title: string; companion?: string;
}>;
export type NativeSubtitleFilePicker = Readonly<{pick: (signal: AbortSignal) => Promise<NativeSubtitlePickedFile | undefined>}>;
export type NativeSubtitleFileLifetime = Readonly<{signal: AbortSignal; isCurrent: () => boolean}>;
export type NativeSubtitleFileMetadata = Readonly<Pick<NativePlaybackSubtitleUpload, 'language' | 'rights' | 'scope' | 'offsetUs'>>;

/** A file picker borrows the existing current-source service. Neither a cancelled
 * native result nor a queued save may outlive its source or its calling sheet. */
export async function uploadPickedSubtitle(
  picker: NativeSubtitleFilePicker,
  save: (input: NativePlaybackSubtitleUpload, lifetime: NativeSubtitleFileLifetime) => Promise<void>,
  source: NativeSubtitleFileLifetime,
  caller: NativeSubtitleFileLifetime,
  metadata: NativeSubtitleFileMetadata,
): Promise<boolean> {
  const controller = new AbortController(), abort = () => controller.abort();
  const current = () => !controller.signal.aborted && source.isCurrent() && caller.isCurrent();
  source.signal.addEventListener('abort', abort, {once: true});
  caller.signal.addEventListener('abort', abort, {once: true});
  if (source.signal.aborted || caller.signal.aborted) controller.abort();
  const cancelled = Symbol('cancelled');
  let cancel!: () => void;
  const cancellation = new Promise<typeof cancelled>(resolve => {cancel = () => resolve(cancelled);});
  controller.signal.addEventListener('abort', cancel, {once: true});
  // Capture the caller's real language, rights, scope and correction before the
  // native await; no viewer defaults or synthetic file facts are introduced.
  const fields = Object.freeze({language: metadata.language, rights: metadata.rights, scope: metadata.scope, offsetUs: metadata.offsetUs});
  try {
    if (!current()) return false;
    const picked = await Promise.race([picker.pick(controller.signal), cancellation]);
    if (picked === cancelled || !picked || !current()) return false;
    const lifetime = {signal: controller.signal, isCurrent: current};
    await save({...fields, data: picked.data, format: picked.format, title: picked.title, ...(picked.companion === undefined ? {} : {companion: picked.companion})}, lifetime);
    if (!current()) return false;
    return true;
  } catch {
    if (!current()) return false;
    throw new Error(serviceText('player.subtitles.changeFailed'));
  } finally {
    source.signal.removeEventListener('abort', abort);
    caller.signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
    controller.abort();
  }
}
