import {musicMixDisplayName} from '../../../../../../packages/client-core/src/music-mixes';
import {decodeGetMusicMixesResponse, routePath} from '../../../../../../packages/contracts/src/index';
import type {I18n} from '../../../../../../packages/i18n/src';
import type {NativeShellPlaybackAdapter} from '../../../shell/playback';
import type {ShellAuthority} from '../../../shell/model';

type Mix = ReturnType<typeof decodeGetMusicMixesResponse>['data']['mixes'][number];
export type NativeMusicMixRow = Readonly<{id: string; name: string; tint: string; artists: readonly Readonly<{id: string; name: string}>[]; more: boolean;
  songCount: number; covers: readonly Readonly<{id: string; name: string; posterUrl?: string}>[]}>;
export type NativeMusicMixesSnapshot = Readonly<{phase: 'idle' | 'loading' | 'ready' | 'error' | 'retired'; rows: readonly NativeMusicMixRow[]; error?: unknown}>;

export type NativeMusicMixesPort = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeMusicMixesSnapshot;
  load: () => Promise<void>;
  play: (row: NativeMusicMixRow) => Promise<void>;
}>;

type Options = Readonly<{
  request: (path: string, method: 'GET', body: undefined, signal: AbortSignal) => Promise<unknown>;
  authority: () => ShellAuthority;
  playback: () => NativeShellPlaybackAdapter | undefined;
  t: I18n['t'];
  isCurrent: () => boolean;
}>;

const invalid = () => Object.assign(new Error('invalid_music_mixes'), {code: 'invalid_music_mixes'});
const retired = () => Object.assign(new Error('native_music_mixes_retired'), {name: 'AbortError'});

/** music-plus (MC-9): one profile's own Mixes row from the server's real projection. The
 * canonical naming formatter owns the words; nothing here invents a mix, an artist or a cover. */
export function createNativeMusicMixes(options: Options): NativeMusicMixesPort {
  const listeners = new Set<() => void>();
  let state: NativeMusicMixesSnapshot = Object.freeze({phase: 'idle', rows: Object.freeze([])});
  let read: AbortController | undefined, pending: Promise<void> | undefined, closed = false, generation = 0, commands = new Set<AbortController>();
  const publish = (next: NativeMusicMixesSnapshot) => {state = Object.freeze(next); for (const listener of [...listeners]) listener();};
  const current = () => !closed && generation >= 0 && options.isCurrent();
  const stop = () => {for (const command of commands) command.abort(); commands.clear();};
  const name = (mix: Mix) => musicMixDisplayName(mix.nameSource, mix.artists, options.t);
  const rows = (mixes: readonly Mix[]): readonly NativeMusicMixRow[] => Object.freeze(mixes.flatMap(mix => {
    const label = name(mix);
    if (!label) return [];
    return [Object.freeze({id: mix.id, name: label, tint: mix.tint, more: mix.more, songCount: mix.songCount,
      artists: Object.freeze(mix.artists.map(artist => Object.freeze({id: artist.id, name: artist.name}))),
      covers: Object.freeze(mix.covers.map(cover => Object.freeze({id: cover.album.id, name: cover.album.name, ...(cover.posterUrl ? {posterUrl: cover.posterUrl} : {})})))})];
  }));
  const load = (): Promise<void> => {
    if (!current()) return Promise.reject(retired());
    if (pending) return pending;
    const controller = new AbortController(), ticket = ++generation;
    read = controller; stop();
    const task = Promise.resolve().then(async () => {
      try {
        const response = decodeGetMusicMixesResponse(await options.request(routePath('get_music_mixes'), 'GET', undefined, controller.signal));
        if (!current() || ticket !== generation || controller.signal.aborted) throw retired();
        const authority = options.authority();
        if (response.scope.serverId !== authority.serverId || response.scope.authority !== authority.authority
          || response.scope.accountId !== authority.accountId || response.scope.profileId !== authority.profileId) throw invalid();
        if (new Set(response.data.mixes.map(mix => mix.id)).size !== response.data.mixes.length) throw invalid();
        publish({phase: 'ready', rows: rows(response.data.mixes)});
      } catch (error) {
        if (current() && ticket === generation && !controller.signal.aborted) publish({phase: 'error', rows: Object.freeze([]), error});
        throw error;
      } finally {if (read === controller) {read = undefined; pending = undefined;}}
    });
    pending = task; publish({phase: 'loading', rows: Object.freeze([])}); return task;
  };
  return Object.freeze({
    subscribe(listener: () => void) {if (closed) return () => {}; listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => state,
    load,
    async play(row: NativeMusicMixRow) {
      if (!current() || state.phase !== 'ready' || !state.rows.includes(row)) throw retired();
      const port = options.playback()?.cataloguePlayback?.();
      if (!port) throw Object.assign(new Error('music_playback_unavailable'), {code: 'music_playback_unavailable'});
      const controller = new AbortController(); commands.add(controller);
      const ticket = generation;
      try {
        await port.playSegments([{source: {container: {kind: 'mix', id: row.id}}}],
          {signal: controller.signal, isCurrent: () => current() && ticket === generation});
      } finally {commands.delete(controller);}
    },
  });
}
