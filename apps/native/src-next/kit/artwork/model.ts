import type {ArtworkPosition, ArtworkSource, CoverShape} from './types';

export const unit = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

/** Crop in the rendered box, independent of transport or item identity. */
export function artworkFrame(width: number, height: number, intrinsicWidth: number, intrinsicHeight: number, fit: 'cover' | 'contain', position: ArtworkPosition = {x: 0.5, y: 0.5}, zoom = 1) {
  const scale = (fit === 'contain' ? Math.min : Math.max)(width / intrinsicWidth, height / intrinsicHeight) * Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  const w = intrinsicWidth * scale, h = intrinsicHeight * scale;
  return {width: w, height: h, left: (width - w) * unit(position.x), top: (height - h) * unit(position.y)};
}

/** Headers stay on the native Image; scheduler identity never becomes a request URL. */
export function artworkAttemptSource(source: ArtworkSource, uri: string, attempt: number) {
  return {
    uri: attempt > 0 ? `${uri}${uri.includes('?') ? '&' : '?'}_artRetry=${attempt}` : uri,
    ...(source.headers ? {headers: {...source.headers}} : {}),
  };
}

export function boundedCovers(covers: readonly ArtworkSource[], maximum: number): readonly ArtworkSource[] {
  return covers.slice(0, maximum);
}
export const coverAspect = (shape: CoverShape): number => shape === 'square' ? 1 : shape === 'periodical' ? 3 / 4 : 2 / 3;

export function coverTitleScale(title: string): number {
  const longest = Math.max(1, ...(title.match(/\S+/gu) ?? []).map(word => Array.from(word).length));
  return longest <= 7 ? 0.155 : longest <= 9 ? 0.124 : longest <= 11 ? 0.12 : Math.max(0.086, 1.12 / longest);
}

export function mixColour(first: string, second: string, fraction: number): string {
  if (!/^#[a-f\d]{6}$/i.test(first) || !/^#[a-f\d]{6}$/i.test(second)) return first;
  const weight = unit(fraction);
  return '#' + [1, 3, 5].map(i => Math.round(parseInt(first.slice(i, i + 2), 16) * (1 - weight) + parseInt(second.slice(i, i + 2), 16) * weight).toString(16).padStart(2, '0')).join('');
}
