import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';

/** Scale the complete sprite sheet into display-tile coordinates before clipping. */
export function nativeTrickplayFrame(trickplay: PlaybackOptions['trickplay'], seconds: number, box: Readonly<{width: number; height: number}>) {
  if (!trickplay || ![trickplay.intervalMs, trickplay.tileWidth, trickplay.tileHeight, trickplay.columns, trickplay.rows, box.width, box.height]
    .every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(seconds)) return undefined;
  const index = Math.max(0, Math.floor(seconds * 1000 / trickplay.intervalMs));
  const column = index % trickplay.columns, row = Math.floor(index / trickplay.columns) % trickplay.rows;
  const scaleX = box.width / trickplay.tileWidth, scaleY = box.height / trickplay.tileHeight;
  return {width: trickplay.columns * trickplay.tileWidth * scaleX, height: trickplay.rows * trickplay.tileHeight * scaleY,
    left: -column * trickplay.tileWidth * scaleX, top: -row * trickplay.tileHeight * scaleY};
}
