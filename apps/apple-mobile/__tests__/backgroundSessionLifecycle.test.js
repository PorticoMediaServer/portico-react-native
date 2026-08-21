const fs = require('node:fs');
const path = require('node:path');

const nativeRoot = path.resolve(__dirname, '../ios/PorticoIOS');
const appDelegate = fs.readFileSync(
  path.join(nativeRoot, 'AppDelegate.swift'),
  'utf8',
);
const downloadManager = fs.readFileSync(
  path.join(nativeRoot, 'PorticoDownloadManager.m'),
  'utf8',
);
const primitives = fs.readFileSync(
  path.resolve(__dirname, '../../../packages/app/src/ui/primitives.tsx'),
  'utf8',
);

test('background URL-session completion survives native relaunch ordering', () => {
  expect(appDelegate).toMatch(
    /backgroundSessionCompletions: \[String: \[\(\) -> Void\]\]/,
  );
  expect(appDelegate).toMatch(/backgroundSessionsFinishedBeforeHandler/);
  expect(appDelegate).toMatch(/ensureBackgroundDownloadSession\(\)/);
  expect(appDelegate).toMatch(/completeBackgroundSession\(identifier: identifier\)/);
  expect(appDelegate).not.toMatch(
    /backgroundSessionCompletions\[identifier\] = completionHandler/,
  );
  expect(downloadManager).toMatch(/PorticoSharedDownloadManager/);
  expect(downloadManager).toMatch(/sessionSendsLaunchEvents = YES/);
  expect(downloadManager).toMatch(
    /URLSessionDidFinishEventsForBackgroundURLSession[\s\S]*dispatch_async\(dispatch_get_main_queue\(\)/,
  );
  expect(downloadManager).toMatch(
    /session\.configuration\.identifier \?: PorticoDownloadSessionIdentifier/,
  );
});

test('download recovery marker clears only after durable reconciliation and never exposes partial media', () => {
  expect(downloadManager).toMatch(/recoveryPending/);
  expect(downloadManager).toMatch(
    /if \(self\.allowOrphanCleanup \|\| self\.recoveryPending\) \{[\s\S]*removeOrphanedOfflineFiles/,
  );
  expect(downloadManager).toMatch(
    /if \(!\[self persistAndEmit\]\) \{[\s\S]*reconciliationSucceeded = NO;[\s\S]*markDownloadRecoveryNeeded/,
  );
  expect(downloadManager).toMatch(
    /if \(self\.recoveryPending\) \{[\s\S]*reconciliationSucceeded && \[self clearDownloadRecoveryMarker\][\s\S]*else \{[\s\S]*markDownloadRecoveryNeeded/,
  );
  expect(downloadManager).toMatch(
    /\[record\[@"state"\] isEqualToString:@"completed"\][\s\S]*isCompleteMediaFileAtURL/,
  );

  const reconcileStart = downloadManager.indexOf('- (void)reconcileTasks');
  const reconcileEnd = downloadManager.indexOf('- (NSArray *)publicRecordsForScope:', reconcileStart);
  const reconcile = downloadManager.slice(reconcileStart, reconcileEnd);
  expect(reconcile.indexOf('removeOrphanedOfflineFiles')).toBeGreaterThan(-1);
  expect(reconcile.indexOf('persistAndEmit')).toBeGreaterThan(
    reconcile.indexOf('removeOrphanedOfflineFiles'),
  );
  expect(reconcile.indexOf('clearDownloadRecoveryMarker')).toBeGreaterThan(
    reconcile.indexOf('persistAndEmit'),
  );
});

test('MediaCard has no unowned retry timer beside the cache-owned timer', () => {
  const start = primitives.indexOf('export function MediaCard(');
  const end = primitives.indexOf('export function SectionHeading(', start);
  const mediaCard = primitives.slice(start, end);

  expect(mediaCard).toContain('rememberMediaArtworkFailure(sourceUri)');
  expect(mediaCard).not.toContain('setTimeout(');
});
