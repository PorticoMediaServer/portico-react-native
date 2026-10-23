import type {MediaVersion, PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import type {TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';

export type NativeVersionRowText = Readonly<{primary: string; secondary: string}>;
export type NativeVersionRow = NativeVersionRowText & Readonly<{id: string}>;
/** The canonical formatter supplies only ruling 21's edition/picture and
 * resolution/HDR/main-audio/size lines. Generic version labels are not rows. */
export type NativeVersionPresentation = Readonly<{
  title: string;
  row: (version: MediaVersion, text: TextEnvironment) => NativeVersionRowText;
}>;

/** Options owns grouped IDs and their order, shared by the real File info
 * projection. Failure exclusion is independent of More-menu >=2 eligibility. */
export function nativeVersionChoices(options: PlaybackOptions, itemId: string, text: TextEnvironment, presentation: NativeVersionPresentation, excludeVersionId?: string, minimum = 2): readonly NativeVersionRow[] {
  if (options.itemId !== itemId || options.versions.length < minimum || new Set(options.versions.map(version => version.id)).size !== options.versions.length) return [];
  const rows = options.versions.filter(version => version.id !== excludeVersionId).map(version => {
    const lines = presentation.row(version, text);
    return Object.freeze({id: version.id, primary: lines.primary, secondary: lines.secondary});
  });
  return rows.every(row => typeof row.primary === 'string' && !!row.primary.trim() && typeof row.secondary === 'string') ? Object.freeze(rows) : [];
}
