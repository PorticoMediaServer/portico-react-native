/**
 * A server for the tests, behind a stand-in for the device's XMLHttpRequest: `routes` maps an
 * address to what is answered for it (text, a segment description, a status, or a function of
 * the request). `log` is every address asked for, in order.
 */
/** @type {{routes: Map<string, any>, log: string[], offline: boolean, delay: number}} */
export const server = {routes: new Map(), log: [], offline: false, delay: 0};
export function resetServer() { server.routes = new Map(); server.log = []; server.offline = false; server.delay = 0; }
/** @param {{init?: boolean, pts?: number, duration?: number, bytes?: number}} description */
export const segment = description => ({segment: description});

class Request {
  readyState = 0; status = 0; response = null; responseText = ''; responseURL = ''; responseType = 'text'; timeout = 0; withCredentials = false;
  onload = null; onerror = null; ontimeout = null; onabort = null; onreadystatechange = null; onprogress = null;
  #headers = {}; #answered = {}; #done = false; #timer;
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.#headers[name.toLowerCase()] = value; }
  getResponseHeader(name) { return this.#answered[name.toLowerCase()] ?? null; }
  getAllResponseHeaders() { return Object.entries(this.#answered).map(([k, v]) => `${k}: ${v}`).join('\r\n'); }
  send() {
    server.log.push(this.url);
    this.#timer = setTimeout(() => {
      if (this.#done) return;
      this.#done = true;
      if (server.offline) { this.onerror?.(); return; }
      let answer = server.routes.get(this.url);
      if (typeof answer === 'function') answer = answer({url: this.url, headers: this.#headers});
      if (answer === undefined) answer = {status: 404};
      if (typeof answer === 'string') answer = {status: 200, text: answer};
      if (answer.segment) answer = {status: 200, bytes: Buffer.from(JSON.stringify({...answer.segment, pad: 'x'.repeat(answer.segment.bytes ?? 0)}))};
      this.status = answer.status ?? 200;
      this.responseURL = answer.from ?? this.url;
      this.#answered = Object.fromEntries(Object.entries(answer.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      this.readyState = 2; this.onreadystatechange?.();
      if (this.responseType === 'arraybuffer') { const b = answer.bytes ?? Buffer.from(answer.text ?? ''); this.response = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
      else this.responseText = answer.text ?? '';
      this.readyState = 4; this.onreadystatechange?.();
      this.onload?.();
    }, server.delay);
  }
  abort() { if (this.#done) return; this.#done = true; clearTimeout(this.#timer); this.onabort?.(); }
}
globalThis.XMLHttpRequest = Request;
