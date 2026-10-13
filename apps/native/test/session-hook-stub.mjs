// Authentication/storage/device boundaries; SessionProvider and ViewerSelectionCommit stay real.
/** @type {{saved: any, restore: (...args: any[]) => Promise<any>, chosen: any, me?: () => Promise<any>, writes: any[], revoked: string[]}} */
export const auth = {saved: null, restore: async () => undefined, chosen: undefined, writes: [], revoked: []};
export const nativeViewerStorage = {read: async () => auth.saved, write: async record => {auth.writes.push(record); auth.saved = record;}};
export const prepareSecureRecords = async () => false;
export const profileInstallation = async () => 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
export const deviceIdentity = async () => ({deviceName: 'Device', appVersion: '1'});
export const nativeNetworkFetch = async () => new Response('{}', {status: 200});
export const nativeConnectionEnvironment = {storage: {read: async () => undefined}, crypto: {}};
export const restoreNativeConnection = (...args) => auth.restore(...args);
export const forgetNativeConnection = async () => {};
export const trackNativeConnection = () => {};
export const onNetworkChange = () => () => {};
export const nativeHostedSource = () => ({});
const noop = () => {};
const hosted = {credentials: undefined, hosted: undefined, setHosted: noop, servers: [], directoryStatus: 'ready', refreshServers: noop, dropServer: noop, checkServersNow: noop, setAttachedServer: noop};
export const useHostedAccount = () => hosted;
export const useCredentialVerification = noop;
export const offlineDownloads = {adopt: noop};
export const knownDirectServers = {remember: async () => {}, forget: async () => {}};
export const clearActivity = noop;
export function profileAPI(origin, token) {
  return {baseUrl: origin, getRouteConnection: () => undefined, getRouteSnapshot: () => undefined, subscribeRoute: () => () => {},
    system: async () => ({name: 'Server'}), request: async path => path === '/v1/me' && auth.me ? auth.me() : ({viewer: auth.chosen?.viewer}),
    logout: async () => {auth.revoked.push(token);}, setAccessToken() {}, setAuthRecovery() {}};
}

export const installationPlatform = 'iphone';
