import React from 'react';
import {Image, Text, View} from 'react-native';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';

/** The five-picture strip frame 2 draws above the seek bar. Real trickplay
 * sheets supply each frame; a sheet the server has not published leaves the
 * tile dark rather than inventing a picture. The middle tile is the one the
 * viewer would land on. */
export type NativeTrickplayStripProps = Readonly<{
  trickplay?: PlaybackOptions['trickplay'];
  /** The landing time in seconds; the strip is centred on it. */
  seconds: number;
  start: number;
  end: number;
}>;

const SMALL = {width: 256, height: 144}, LARGE = {width: 480, height: 270};
const SLOTS = [-2, -1, 0, 1, 2] as const;

function Tile({trickplay, seconds, large}: {trickplay?: PlaybackOptions['trickplay']; seconds: number; large: boolean}) {
  const box = large ? LARGE : SMALL;
  const frame = trickplay && trickplay.intervalMs > 0 && trickplay.tileWidth > 0 && trickplay.tileHeight > 0 && trickplay.columns > 0 && trickplay.rows > 0
    ? (() => {
      const index = Math.max(0, Math.floor(seconds * 1000 / trickplay.intervalMs));
      return {column: index % trickplay.columns, row: Math.floor(index / trickplay.columns) % trickplay.rows,
        width: trickplay.columns * trickplay.tileWidth, height: trickplay.rows * trickplay.tileHeight};
    })()
    : undefined;
  return <View style={{width: box.width, height: box.height, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0b1822', opacity: large ? 1 : .78,
    borderWidth: 1.5, borderColor: large ? '#edf5fa4d' : '#edf5fa29', shadowColor: '#000', shadowOpacity: large ? .95 : .9,
    shadowRadius: large ? 35 : 25, shadowOffset: {width: 0, height: large ? 30 : 24}}}>
    {frame && <Image source={{uri: trickplay!.url}} resizeMode="stretch" style={{position: 'absolute', width: frame.width, height: frame.height,
      left: -frame.column * trickplay!.tileWidth, top: -frame.row * trickplay!.tileHeight}}/>}
    <View style={{position: 'absolute', bottom: large ? 14 : 10, alignSelf: 'center', paddingHorizontal: large ? 14 : 10, paddingVertical: large ? 5 : 3, borderRadius: 8, backgroundColor: '#071018c7'}}>
      <Text style={{fontFamily: 'Manrope-Bold', fontSize: large ? 30 : 18, fontWeight: '800', color: large ? '#edf5fa' : '#c9d9e3', fontVariant: ['tabular-nums']}}>{clockText(seconds)}</Text>
    </View>
  </View>;
}

/** Strip height 270; the small tiles sit on the same bottom line. It hangs
 * 12 above the bar (tv-player 2), which is the top 40 of the timeline box. */
export function NativeTrickplayStrip({trickplay, seconds, start, end}: NativeTrickplayStripProps) {
  const step = trickplay && trickplay.intervalMs > 0 ? trickplay.intervalMs / 1000 : 10;
  return <View pointerEvents="none" style={{position: 'absolute', bottom: 92, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-end', gap: 20}}>
    {SLOTS.map(slot => <Tile key={slot} trickplay={trickplay} large={slot === 0} seconds={Math.max(start, Math.min(end, seconds + slot * step))}/>)}
  </View>;
}
