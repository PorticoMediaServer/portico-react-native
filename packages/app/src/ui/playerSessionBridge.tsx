import {useEffect, useRef} from 'react';
import {usePersistentPlayback} from './playbackSession';

export interface PersistentPlaybackBridgeProps {
  active: boolean;
  artwork?: string;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  isPlaying: boolean;
  mediaFamily: 'audio' | 'video';
  mediaId: string;
  onNext(): void;
  onPause(): void;
  onPlay(): void;
  onPrevious(): void;
  onSeekBy(seconds: number): void;
  onStop(): void | Promise<void>;
  platform: 'mobile' | 'tv';
  presentation: 'collapsed' | 'fullscreen';
  subtitle?: string;
  title: string;
}

/** The only bridge from a mounted native player into the provider-owned session authority. */
export function PersistentPlaybackBridge(props: PersistentPlaybackBridgeProps) {
  const {publish, register} = usePersistentPlayback();
  const commands = useRef({
    next: props.onNext,
    pause: props.onPause,
    play: props.onPlay,
    previous: props.onPrevious,
    seekBy: props.onSeekBy,
    stop: props.onStop,
  });
  commands.current = {
    next: props.onNext,
    pause: props.onPause,
    play: props.onPlay,
    previous: props.onPrevious,
    seekBy: props.onSeekBy,
    stop: props.onStop,
  };
  useEffect(() => register({
    next: () => commands.current.next(),
    pause: () => commands.current.pause(),
    play: () => commands.current.play(),
    previous: () => commands.current.previous(),
    seekBy: seconds => commands.current.seekBy(seconds),
    stop: () => commands.current.stop(),
  }), [register]);
  useEffect(() => {
    publish(props.active ? {
      active: props.active,
      artwork: props.artwork,
      canNext: props.canNext,
      canPrevious: props.canPrevious,
      canSeek: props.canSeek,
      isPlaying: props.isPlaying,
      mediaFamily: props.mediaFamily,
      mediaId: props.mediaId,
      platform: props.platform,
      presentation: props.presentation,
      subtitle: props.subtitle,
      title: props.title,
    } : undefined);
  }, [props.active, props.artwork, props.canNext, props.canPrevious, props.canSeek, props.isPlaying, props.mediaFamily, props.mediaId, props.platform, props.presentation, props.subtitle, props.title, publish]);
  return null;
}
