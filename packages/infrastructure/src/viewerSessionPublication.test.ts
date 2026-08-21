import type {PorticoClient, ViewerScope} from '@portico/client-core';
import {
  activateViewerClient,
  fenceViewerClient,
  guardViewerClient,
  viewerClientIsActive,
  type ViewerPublicationSnapshot,
} from './viewerSessionPublication';

const scopeA: ViewerScope = {
  authority: 'hosted',
  accountId: 'account-a',
  serverId: 'server-a',
  profileId: 'profile-a',
  authorizationRevision: 'revision-a',
};
const scopeB: ViewerScope = {
  authority: 'hosted',
  accountId: 'account-b',
  serverId: 'server-b',
  profileId: 'profile-b',
  authorizationRevision: 'revision-b',
};

function client(label: string, calls: string[]): PorticoClient {
  return { home: () => { calls.push(label); return Promise.resolve({}); } } as unknown as PorticoClient;
}

test('keeps A fenced while B credentials/runtime publish before B AppSession', async () => {
  const calls: string[] = [];
  let runtime: ViewerPublicationSnapshot = {
    acceptingWrites: true,
    scope: scopeA,
    transitioning: false,
  };
  const guardedA = guardViewerClient(client('A', calls), scopeA, () => runtime);
  activateViewerClient(guardedA, scopeA);
  await guardedA.home();

  // Stage begins: A UI can still be mounted, but its client is synchronously
  // closed before the global credential family is replaced.
  fenceViewerClient(guardedA);
  runtime = { acceptingWrites: false, scope: scopeA, transitioning: true };
  expect(() => guardedA.home()).toThrow(
    'fenced while the active viewing profile changes',
  );

  // Core may now install B credentials and publish B runtime. B's guarded
  // client remains unusable until the AppSession ref names B; A remains inert.
  const guardedB = guardViewerClient(client('B', calls), scopeB, () => runtime);
  runtime = { acceptingWrites: true, scope: scopeB, transitioning: false };
  expect(() => guardedA.home()).toThrow(
    'fenced while the active viewing profile changes',
  );
  expect(() => guardedB.home()).toThrow(
    'fenced while the active viewing profile changes',
  );

  let appSessionClient: PorticoClient | undefined;
  appSessionClient = guardedB;
  activateViewerClient(appSessionClient, scopeB);
  expect(viewerClientIsActive(guardedB)).toBe(true);
  await appSessionClient.home();
  expect(calls).toEqual(['A', 'B']);
});

test('two-phase rollback never reopens A until B is fenced and A runtime is restored', async () => {
  const calls: string[] = [];
  let runtime: ViewerPublicationSnapshot = {
    acceptingWrites: true,
    scope: scopeA,
    transitioning: false,
  };
  const guardedA = guardViewerClient(client('A', calls), scopeA, () => runtime);
  activateViewerClient(guardedA, scopeA);
  fenceViewerClient(guardedA);
  runtime = { acceptingWrites: true, scope: scopeB, transitioning: false };
  const guardedB = guardViewerClient(client('B', calls), scopeB, () => runtime);
  activateViewerClient(guardedB, scopeB);

  // Candidate rollback synchronously fences B before credential restoration.
  fenceViewerClient(guardedB);
  runtime = { acceptingWrites: false, scope: scopeB, transitioning: true };
  expect(() => activateViewerClient(guardedA, scopeA)).toThrow(
    'cannot publish before its viewer runtime is authoritative',
  );
  expect(() => guardedB.home()).toThrow(
    'fenced while the active viewing profile changes',
  );

  runtime = { acceptingWrites: true, scope: scopeA, transitioning: false };
  activateViewerClient(guardedA, scopeA);
  await guardedA.home();
  expect(() => guardedB.home()).toThrow(
    'fenced while the active viewing profile changes',
  );
  expect(calls).toEqual(['A']);
});

test('rejects a client activation when AppSession scope and runtime differ', () => {
  const runtime: ViewerPublicationSnapshot = {
    acceptingWrites: true,
    scope: scopeB,
    transitioning: false,
  };
  const guardedA = guardViewerClient(client('A', []), scopeA, () => runtime);
  expect(() => activateViewerClient(guardedA, scopeA)).toThrow(
    'cannot publish before its viewer runtime is authoritative',
  );
});
