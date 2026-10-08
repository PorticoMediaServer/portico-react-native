/** Server-sent events on React Native, whose `fetch` cannot stream a response body.
 *
 * XMLHttpRequest does deliver text as it arrives, so this adapts one into the small part of a
 * `Response` that the shared event reader uses. The text an XMLHttpRequest holds only ever
 * grows, so a long-lived stream is cut at a bound; the caller resumes from its last event id,
 * which is what it would do after any dropped connection. */
const MAX_HELD = 1048576;

export function openEventStream(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const chunks: string[] = [];
    let seen = 0, finished = false, settled = false, waiting: ((r: {value?: string; done: boolean}) => void) | undefined;
    const deliver = () => {
      if (!waiting) return;
      if (chunks.length) { const w = waiting; waiting = undefined; w({value: chunks.shift()!, done: false}); }
      else if (finished) { const w = waiting; waiting = undefined; w({done: true}); }
    };
    const finish = () => { finished = true; deliver(); };
    const abort = () => { xhr.abort(); finish(); if (!settled) { settled = true; reject(new Error('The event stream was cancelled.')); } };
    const take = () => {
      const text = xhr.responseText ?? '';
      if (text.length > seen) { chunks.push(text.slice(seen)); seen = text.length; deliver(); }
      if (seen > MAX_HELD) { xhr.abort(); finish(); }
    };
    xhr.open('GET', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.responseType = 'text';
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && !settled) {
        settled = true;
        const body = {getReader: () => ({read: () => new Promise<{value?: string; done: boolean}>(r => { waiting = r; deliver(); }), cancel: async () => { xhr.abort(); finish(); }, releaseLock: () => {}})};
        resolve({ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body} as unknown as Response);
      }
      if (xhr.readyState === 4) { take(); finish(); }
    };
    xhr.onprogress = take;
    xhr.onerror = () => { finish(); if (!settled) { settled = true; reject(new TypeError('Network request failed')); } };
    signal.addEventListener('abort', abort, {once: true});
    if (signal.aborted) abort(); else xhr.send();
  });
}
