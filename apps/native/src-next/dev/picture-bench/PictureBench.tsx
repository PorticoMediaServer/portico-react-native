// Spike-only (P2-70 LIB-1, never merged). A heavy poster grid drawn three ways from one release build:
// `rn` is React Native's Image exactly as artwork uses it today (display-size decode, no prefetch),
// `rn-tuned` adds prefetch of the next screens, `expo` is expo-image (memory-disk cache, prefetch).
// The mode is chosen once per process; to compare, force-stop and relaunch. Pictures come from
// picsum.photos so the bench needs no server or sign-in. All copy here is a developer tool.
/* lint-strings-allow-file */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, Image, PixelRatio, Pressable, Text, View, useWindowDimensions} from 'react-native';
import {Picture} from '../../kit/artwork/Picture';
import {setPictureEngine} from '../../platform/picture-engine';

type Mode = 'rn' | 'rn-tuned' | 'expo';
type Size = 'sized' | 'originals';
const COUNT = 900, COLUMNS = 3, GAP = 6;
// picsum ids 0–1084; a few are missing, which the bench counts as errors.
const uri = (index: number, width: number, height: number) => `https://picsum.photos/id/${index % 1085}/${width}/${height}.jpg`;

type Stats = {loads: number[]; errors: number; frames: number; dropped: number; longest: number};

export function PictureBench() {
  const [run, setRun] = useState<{mode: Mode; size: Size}>();
  if (!run) return <View style={{flex: 1, backgroundColor: '#0b0d12', padding: 24, paddingTop: 80, gap: 12}}>
    <Text style={{color: 'white', fontSize: 22, fontWeight: '700'}}>Picture bench</Text>
    <Text style={{color: '#aab'}}>One mode per launch. Force-stop the app before the next mode.</Text>
    {(['rn', 'rn-tuned', 'expo'] as const).flatMap(mode => (['sized', 'originals'] as const).map(size =>
      <Pressable key={mode + size} testID={`bench-${mode}-${size}`} onPress={() => {if (mode === 'expo') setPictureEngine('expo'); setRun({mode, size});}}
        style={{padding: 14, borderRadius: 10, backgroundColor: '#1d2230'}}>
        <Text style={{color: 'white', fontSize: 16}}>{mode} · {size}</Text>
      </Pressable>))}
  </View>;
  return <Grid mode={run.mode} size={run.size}/>;
}

function Grid({mode, size}: {mode: Mode; size: Size}) {
  const {width, height} = useWindowDimensions(), scale = PixelRatio.get();
  const cell = Math.floor((width - GAP * (COLUMNS + 1)) / COLUMNS), cellHeight = Math.round(cell * 1.5);
  // `sized` asks for 2× the painted size, as Portico's server renditions do; `originals` asks for
  // 1000×1500 so decode cost dominates.
  const request = size === 'sized' ? {w: Math.round(cell * Math.min(scale, 2)), h: Math.round(cellHeight * Math.min(scale, 2))} : {w: 1000, h: 1500};
  const list = useRef<FlatList<number>>(null);
  const stats = useRef<Stats>({loads: [], errors: 0, frames: 0, dropped: 0, longest: 0});
  const [summary, setSummary] = useState('');
  const prefetched = useRef(new Set<number>());
  const prefetch = useCallback((from: number) => {
    if (mode === 'rn') return;
    const urls: string[] = [];
    for (let index = from; index < Math.min(COUNT, from + COLUMNS * 12); index++) {
      if (prefetched.current.has(index)) continue;
      prefetched.current.add(index); urls.push(uri(index, request.w, request.h));
    }
    if (!urls.length) return;
    if (mode === 'expo') void (require('expo-image') as {Image: {prefetch(urls: string[], policy: string): Promise<boolean>}}).Image.prefetch(urls, 'memory-disk').catch(() => {});
    else for (const url of urls) void Image.prefetch(url).catch(() => {});
  }, [mode, request.w, request.h]);

  // Auto-scroll: down and back up three times at 2400 pt/s, counting JS frames over 20 ms as dropped.
  useEffect(() => {
    const rows = Math.ceil(COUNT / COLUMNS), total = rows * (cellHeight + GAP) - height;
    let frame = 0, last = 0, offset = 0, direction = 1, passes = 0, live = true;
    const started = setTimeout(() => {
      const step = (now: number) => {
        if (!live) return;
        if (last) {
          const delta = now - last; stats.current.frames++;
          if (delta > 20) stats.current.dropped += Math.round(delta / 16.7) - 1;
          stats.current.longest = Math.max(stats.current.longest, delta);
          offset += direction * 2.4 * delta;
          if (offset >= total) {offset = total; direction = -1;}
          if (offset <= 0) {offset = 0; direction = 1; passes++;}
          list.current?.scrollToOffset({offset, animated: false});
        }
        last = now;
        if (passes < 3) frame = requestAnimationFrame(step); else finish();
      };
      frame = requestAnimationFrame(step);
    }, 3000);
    const finish = () => {
      const sorted = [...stats.current.loads].sort((a, b) => a - b), at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      const line = `portico_picture_bench ${JSON.stringify({mode, size, loads: sorted.length, errors: stats.current.errors, loadMedianMs: at(0.5), loadP90Ms: at(0.9),
        jsFrames: stats.current.frames, jsDroppedFrames: stats.current.dropped, longestJsFrameMs: Math.round(stats.current.longest)})}`;
      console.warn(line); setSummary(line);
    };
    return () => {live = false; clearTimeout(started); cancelAnimationFrame(frame);};
  }, [cellHeight, height, mode, size]);

  return <View style={{flex: 1, backgroundColor: '#0b0d12'}}>
    <FlatList ref={list} data={Array.from({length: COUNT}, (_, index) => index)} numColumns={COLUMNS} keyExtractor={String}
      initialNumToRender={18} maxToRenderPerBatch={12} windowSize={7} removeClippedSubviews
      contentContainerStyle={{padding: GAP / 2, paddingTop: 60}}
      getItemLayout={(_, index) => ({length: cellHeight + GAP, offset: (cellHeight + GAP) * Math.floor(index / COLUMNS), index})}
      onViewableItemsChanged={({viewableItems}) => {const last = viewableItems[viewableItems.length - 1]?.index; if (typeof last === 'number') prefetch(last + 1);}}
      renderItem={({item}) => <Cell index={item} width={cell} height={cellHeight} request={request} stats={stats}/>}/>
    <View pointerEvents="none" style={{position: 'absolute', top: 24, left: 8, right: 8}}>
      <Text testID="bench-summary" style={{color: '#9f9', fontSize: 11}}>{summary || `${mode} · ${size} · scrolling…`}</Text>
    </View>
  </View>;
}

const Cell = React.memo(function Cell({index, width, height, request, stats}: {index: number; width: number; height: number; request: {w: number; h: number}; stats: React.RefObject<Stats>}) {
  const mounted = useRef(Date.now());
  return <View style={{width, height, margin: GAP / 2, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1d2230'}}>
    <Picture source={{uri: uri(index, request.w, request.h), width, height, scale: PixelRatio.get()}} resizeMode="cover" fadeDuration={0}
      resizeMethod="resize" resizeMultiplier={2} style={{width, height}}
      onLoad={() => {stats.current?.loads.push(Date.now() - mounted.current);}}
      onError={() => {if (stats.current) stats.current.errors++;}}/>
  </View>;
});
