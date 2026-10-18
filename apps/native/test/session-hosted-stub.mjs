// What the Portico Account boundaries answer (see session-hosted-loader.mjs).
const noop = () => {};
// `result`: the server's answer to the account's sign-in (a value or a promise); `opened`: routes
// opened; `retired`: tokens ended over a route.
/** @type {{result: any, opened: number, retired: (string | undefined)[]}} */
export const portico = {result: undefined, opened: 0, retired: []};
const account = {id: 'central-account', username: 'person'};
export const hosted = {
  credentials: {logout: async () => {}, getSnapshot: () => ({session: {accessToken: 'hosted', familyId: 'hosted-family', account}})},
  hosted: {account, profiles: []},
  servers: [{id: 'server', name: 'Server', baseUrl: 'http://server.test'}, {id: 'second', name: 'Second', baseUrl: 'http://second.test'}],
  directoryStatus: 'ready', setHosted: noop, refreshServers: noop, dropServer: noop, checkServersNow: noop, setAttachedServer: noop,
};
export const useHostedAccount = () => hosted;
export const connectHostedServer = async server => {
  portico.opened++;
  let token;
  return {api: {baseUrl: server.baseUrl, setAccessToken(next) {token = next;}, logout: async () => {portico.retired.push(token);}, system: async () => ({name: server.name})}, connection: {dispose: noop}};
};
export const porticoSignIn = async () => await portico.result;
// `session`: the viewer session a chosen profile is issued (a value, or a function of the request's
// signal returning one or a promise); `signals`: each selection request's signal.
/** @type {{session: any, signals: AbortSignal[]}} */
export const selection = {session: undefined, signals: []};
export const selectDirectProfile = async (_api, _scope, _profileId, _input, signal) => {
  selection.signals.push(signal);
  return {session: await (typeof selection.session === 'function' ? selection.session(signal) : selection.session)};
};
