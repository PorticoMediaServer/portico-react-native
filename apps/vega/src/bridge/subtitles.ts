/**
 * The subtitle track the shared player selects, as the Apple module shows it: the server's
 * subtitle document (cues in microseconds of the source's own time) is fetched once per resource,
 * and the cues that cover the current position are the text on screen. Nothing here is drawn by
 * the media element, so the text looks the same whatever is playing.
 */
import {trace} from '../debug';

export type SubtitleCommand = Readonly<{
  mode?: string;
  revision?: number;
  resourceId?: string;
  resourceRevision?: number;
  refreshRevision?: number;
  offsetUs?: number;
  documentUrl?: string;
}>;
export type SubtitleDisplay = Readonly<{text: string; italic: boolean; top: boolean}>;
type Cue = {start: number; end: number; text: string; italic: boolean; top: boolean};

const NOTHING: SubtitleDisplay = Object.freeze({text: '', italic: false, top: false});
const BYTE_LIMIT = 8 * 1024 * 1024, CUE_LIMIT = 20000, DAY_US = 86400000000;
// The Apple module's words.
const UNAVAILABLE = 'Subtitles are unavailable or access was revoked.';
const UNREADABLE = 'Subtitles could not be read. Check the server connection.';

let display: SubtitleDisplay = NOTHING;
const listeners = new Set<() => void>();
let resource = '', cues: Cue[] | null = null, offset = 0, request: XMLHttpRequest | undefined;

function show(next: SubtitleDisplay): void {
  if (next.text === display.text && next.italic === display.italic && next.top === display.top) return;
  display = next.text ? next : NOTHING;
  trace(`subtitle ${display.text ? JSON.stringify(display.text.slice(0, 60)) : 'cleared'}`);
  for (const listener of [...listeners]) listener();
}

export const subtitleDisplay = {
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  current: (): SubtitleDisplay => display,
};

const whole = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value && value >= 0 && value <= DAY_US;

function parse(text: string): Cue[] | null {
  let document: {version?: unknown; timeDomain?: unknown; cues?: unknown};
  try { document = JSON.parse(text); } catch { return null; }
  if (!document || document.version !== 1 || document.timeDomain !== 'source-relative' || !Array.isArray(document.cues) || document.cues.length > CUE_LIMIT) return null;
  const found: Cue[] = [];
  let previous = -1;
  // Strict about the envelope, forgiving about cues: one bad cue costs only itself.
  for (const cue of document.cues as {startUs?: unknown; endUs?: unknown; text?: unknown; italic?: unknown; top?: unknown}[]) {
    const start = Number(cue?.startUs), end = Number(cue?.endUs);
    if (!cue || !whole(start) || !whole(end) || end <= start || start < previous || typeof cue.text !== 'string' || !cue.text) continue;
    previous = start;
    found.push({start, end, text: cue.text, italic: cue.italic === true, top: cue.top === true});
  }
  return found;
}

/** Turns subtitles off. */
export function clearSubtitles(): void {
  request?.abort();
  request = undefined;
  resource = '';
  cues = null;
  show(NOTHING);
}

/**
 * Applies the player's subtitle choice. `status` is told once per load: an empty string when the
 * track is ready, or what went wrong.
 */
export function applySubtitles(command: SubtitleCommand | null | undefined, status: (error: string) => void): void {
  if (!command || command.mode !== 'track' || typeof command.documentUrl !== 'string') { clearSubtitles(); return; }
  offset = typeof command.offsetUs === 'number' && Number.isFinite(command.offsetUs) ? command.offsetUs : 0;
  const wanted = JSON.stringify([command.documentUrl, command.resourceId, command.resourceRevision, command.refreshRevision]);
  if (wanted === resource) return;
  clearSubtitles();
  resource = wanted;
  const fetching = new XMLHttpRequest();
  request = fetching;
  fetching.open('GET', command.documentUrl);
  fetching.setRequestHeader('Accept', 'application/json');
  fetching.timeout = 15000;
  const mine = () => request === fetching && resource === wanted;
  fetching.onload = () => {
    if (!mine()) return;
    request = undefined;
    const body = String(fetching.responseText ?? '');
    if (fetching.status !== 200 || body.length > BYTE_LIMIT) { status(UNAVAILABLE); return; }
    const parsed = parse(body);
    if (!parsed) { status(UNREADABLE); return; }
    cues = parsed;
    status('');
  };
  fetching.onerror = fetching.ontimeout = () => { if (mine()) { request = undefined; status(UNREADABLE); } };
  fetching.send();
}

/** Shows the cues that cover `seconds`. */
export function tickSubtitles(seconds: number): void {
  if (!cues) { show(NOTHING); return; }
  const now = Math.round(seconds * 1e6) - offset;
  // The last cue starting at or before now, then back over the ones still running.
  let low = 0, high = cues.length;
  while (low < high) { const middle = (low + high) >> 1; if (cues[middle].start <= now) low = middle + 1; else high = middle; }
  const active: string[] = [];
  let italic = false, top = false;
  for (let index = low - 1; index >= 0 && index >= low - 12; index--) {
    const cue = cues[index];
    if (cue.end > now) { active.unshift(cue.text); italic ||= cue.italic; top ||= cue.top; }
  }
  show({text: active.join('\n'), italic, top});
}
