// What the direct sign-in boundaries answer (see session-direct-loader.mjs).
/** @type {{result: any}} */
export const direct = {result: undefined};
export const findDirectServer = async () => ({address: 'http://server.test', identity: {serverId: 'server', publicKey: 'key', fingerprint: 'fingerprint'}});
export const connectPairedServer = async address => ({api: {baseUrl: address, system: async () => ({name: 'Server'}), setAccessToken() {}, logout: async () => {}}, connection: {dispose() {}}});
export const rememberNativeSession = async () => {};
export const directSignIn = async () => direct.result;
