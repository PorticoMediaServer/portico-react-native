/**
 * Where a Portico Account lands after sign-in (Justin): straight into the shell, never a separate
 * "Choose a server" screen. One server opens by itself; with several, the one used last opens; only
 * with several and none used before does the shell show a picker. No React Native imports.
 */
export type LandingChoice<S> = Readonly<{kind: 'open'; server: S} | {kind: 'pick'} | {kind: 'none'}>;

export function landingChoice<S extends {id: string}>(servers: readonly S[], lastUsed: string | undefined): LandingChoice<S> {
  if (!servers.length) return {kind: 'none'};
  if (servers.length === 1) return {kind: 'open', server: servers[0]};
  const last = lastUsed ? servers.find(s => s.id === lastUsed) : undefined;
  return last ? {kind: 'open', server: last} : {kind: 'pick'};
}
