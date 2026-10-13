// The SDK's own random source, for a runtime that has no `crypto` of its own.
const system = globalThis.crypto;
export class WebCrypto { crypto = system; }
