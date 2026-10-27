import type {SetupCodeService, SetupCodeSnapshot} from '../../../../../packages/client-core/src/setup-code';

export type TVCodeKind = 'local' | 'portico';
export type TVCodeCapture<T, S> = Readonly<{kind: TVCodeKind; service: SetupCodeService<T>; source: S}>;
export type TVCodeOpening = Readonly<{
  kind: TVCodeKind;
  current: () => boolean;
  pending: () => boolean;
  start: () => Promise<void>;
  newCode: () => Promise<void>;
  credentials: () => Promise<void>;
  retire: (cancel?: boolean) => void;
}>;

/** One rendered code opening owns its service, subscription and accepting source.
 * A retained action never discovers a replacement through the component's refs. */
export function createTVCodeOpening<T, S>(capture: TVCodeCapture<T, S>, options: {
  owns: (opening: TVCodeOpening) => boolean;
  current: (original: TVCodeCapture<T, S>) => boolean;
  publish: (opening: TVCodeOpening, value: Omit<SetupCodeSnapshot<T>, 'grant'>) => void;
  busy: (pending: boolean, adopting: boolean) => void;
  error: (failure: unknown) => void;
  accept: (original: TVCodeCapture<T, S>, grant: T, current: () => boolean) => Promise<void>;
  replace: (original: TVCodeCapture<T, S>, current: () => boolean) => Promise<void>;
  credentials: (original: TVCodeCapture<T, S>, current: () => boolean) => Promise<void>;
}): TVCodeOpening {
  const original = Object.freeze({...capture});
  let phase: 'live' | 'new-code' | 'credentials' | 'adopting' | 'retired' = 'live';
  let starting = false, off: (() => void) | undefined, cancellation: Promise<void> | undefined;
  const current = () => phase !== 'retired' && options.owns(opening) && options.current(original);
  const pending = () => starting || phase !== 'live' && phase !== 'retired';
  const changed = () => {if (current()) options.busy(pending(), phase === 'adopting');};
  const unlink = () => {const release = off; off = undefined; release?.();};
  const cancel = () => {
    if (!cancellation) {
      try {cancellation = Promise.resolve(original.service.cancel());}
      catch (failure) {cancellation = Promise.reject(failure);}
    }
    return cancellation;
  };
  const transition = async (next: 'new-code' | 'credentials') => {
    if (!current() || pending()) return;
    phase = next; unlink(); changed();
    const same = () => phase === next && current();
    try {
      if (!same()) return;
      // Unlink first: cancel emits synchronously and may settle after Back/reset.
      await cancel().catch(failure => {if (same()) cancellation = undefined; throw failure;});
      if (!same()) return;
      await (next === 'new-code' ? options.replace : options.credentials)(original, same);
    } catch (failure) {
      if (same()) {phase = 'live'; options.error(failure);}
    } finally {
      if (same()) phase = 'live';
      changed();
    }
  };
  const read = () => {
    // Refuse before even reading a retired source, not just before setState.
    if (phase !== 'live' || !current()) return;
    const value = original.service.getSnapshot();
    if (phase !== 'live' || !current()) return;
    const {grant, ...presentation} = value;
    options.publish(opening, presentation);
    if (phase !== 'live' || !current() || value.phase !== 'approved' || grant === undefined) return;
    phase = 'adopting'; unlink(); changed();
    const same = () => phase === 'adopting' && current();
    void (async () => {
      if (!same() || !original.service.isCurrent(grant)) return;
      await options.accept(original, grant, same);
    })().catch(failure => {if (same()) options.error(failure);}).finally(() => {
      if (same()) phase = 'live';
      changed();
    });
  };
  const opening: TVCodeOpening = Object.freeze({
    kind: original.kind, current, pending,
    async start() {
      if (!current() || starting || off) return;
      starting = true; off = original.service.subscribe(read); changed();
      try {if (current()) await original.service.start();}
      catch (failure) {if (current()) options.error(failure);}
      finally {starting = false; changed();}
    },
    newCode: () => transition('new-code'), credentials: () => transition('credentials'),
    retire(abandon = false) {
      if (phase === 'retired') return;
      const owned = options.owns(opening);
      phase = 'retired'; unlink();
      if (!owned) return;
      original.service.pause();
      // Unmount only pauses. Explicit abandonment cancels this original once;
      // its late storage/network failure has no presentation owner to update.
      if (abandon) void cancel().catch(() => {});
    },
  });
  return opening;
}
