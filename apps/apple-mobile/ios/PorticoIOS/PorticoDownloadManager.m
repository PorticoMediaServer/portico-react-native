#import <Foundation/Foundation.h>
#import <math.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

static NSString *const PorticoDownloadsEvent = @"PorticoDownloadsChanged";
static NSString *const PorticoDownloadSessionIdentifier = @"tv.getportico.ios.offline-downloads";
static NSString *const PorticoBackgroundEventsFinished = @"PorticoBackgroundDownloadEventsFinished";
static __strong id PorticoSharedDownloadManager;

@interface PorticoDownloadManager : RCTEventEmitter <RCTBridgeModule, NSURLSessionDownloadDelegate>
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *records;
@property(nonatomic, assign) BOOL observing;
@property(nonatomic, assign) BOOL allowOrphanCleanup;
@property(nonatomic, assign) BOOL recoveryPending;
- (BOOL)markDownloadRecoveryNeeded;
- (BOOL)clearDownloadRecoveryMarker;
- (BOOL)persistAndEmit;
- (BOOL)isCompleteMediaFileAtURL:(NSURL *)url record:(NSDictionary *)record;
- (BOOL)removeFileIfPresentAtURL:(NSURL *)url;
- (BOOL)removeOfflineArtifactsForIdentifier:(NSString *)identifier record:(NSDictionary *)record;
- (BOOL)removeOrphanedOfflineFiles;
+ (instancetype)sharedInstance;
+ (void)ensureBackgroundSession;
@end

@implementation PorticoDownloadManager

RCT_EXPORT_MODULE(PorticoDownloadManager)
+ (BOOL)requiresMainQueueSetup { return NO; }

+ (void)ensureBackgroundSession {
  // A background URL-session relaunch may not connect a scene or start the JS
  // bridge. Keep the native delegate alive independently so iOS can deliver
  // restored tasks and the app delegate can finish its launch transaction.
  [self sharedInstance];
}

+ (instancetype)sharedInstance {
  @synchronized (PorticoDownloadManager.class) {
    if (!PorticoSharedDownloadManager) {
      PorticoSharedDownloadManager = [[self alloc] init];
    }
    return PorticoSharedDownloadManager;
  }
}

- (instancetype)init {
  @synchronized (PorticoDownloadManager.class) {
    if (PorticoSharedDownloadManager) return PorticoSharedDownloadManager;
    if ((self = [super init])) {
      PorticoSharedDownloadManager = self;
      _records = [NSMutableDictionary new];
      [self loadRecords];
      NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration backgroundSessionConfigurationWithIdentifier:PorticoDownloadSessionIdentifier];
      configuration.sessionSendsLaunchEvents = YES;
      configuration.discretionary = NO;
      configuration.allowsCellularAccess = YES;
      configuration.HTTPMaximumConnectionsPerHost = 2;
      _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
      [self reconcileTasks];
    }
    return self;
  }
}

- (NSArray<NSString *> *)supportedEvents { return @[PorticoDownloadsEvent]; }
- (void)startObserving { self.observing = YES; [self emitRecords]; }
- (void)stopObserving { self.observing = NO; }

RCT_REMAP_METHOD(list,
                 scope:(NSDictionary *)scope
                 listResolver:(RCTPromiseResolveBlock)resolve
                 listRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isValidScope:scope]) { reject(@"download_scope_required", @"Choose and unlock a Portico profile before opening downloads.", nil); return; }
    resolve([self publicRecordsForScope:scope]);
  });
}

RCT_REMAP_METHOD(storageUsage,
                 storageScope:(NSDictionary *)scope
                 storageResolver:(RCTPromiseResolveBlock)resolve
                 storageRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isValidScope:scope]) { reject(@"download_scope_required", @"Choose and unlock a Portico profile before opening downloads.", nil); return; }
    unsigned long long bytes = 0;
    NSUInteger count = 0;
    for (NSDictionary *record in self.records.allValues) {
      if (![self record:record belongsToScope:scope] || [record[@"state"] isEqualToString:@"deleted"]) continue;
      NSURL *localURL = [self localURLForRecord:record];
      NSNumber *fileSize = localURL
        ? [[NSFileManager defaultManager] attributesOfItemAtPath:localURL.path error:nil][NSFileSize]
        : nil;
      bytes += fileSize ? fileSize.unsignedLongLongValue : [record[@"bytesWritten"] unsignedLongLongValue];
      if (fileSize && [record[@"state"] isEqualToString:@"completed"]) count += 1;
    }
    resolve(@{ @"bytes": @(bytes), @"count": @(count) });
  });
}

RCT_REMAP_METHOD(cleanupStaleAuthorizations,
                 cleanupScope:(NSDictionary *)scope
                 cleanupResolver:(RCTPromiseResolveBlock)resolve
                 cleanupRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (![self isValidScope:scope]) { reject(@"download_scope_required", @"Choose and unlock a Portico profile before opening downloads.", nil); return; }
    NSMutableSet<NSString *> *staleIdentifiers = [NSMutableSet new];
    unsigned long long bytesRemoved = 0;
    for (NSString *identifier in self.records.allKeys) {
      NSDictionary *record = self.records[identifier];
      if (![self record:record hasViewerIdentityOfScope:scope]) continue;
      if ([[self safeString:record[@"authorizationRevision"]] isEqualToString:[self safeString:scope[@"authorizationRevision"]]]) continue;
      [staleIdentifiers addObject:identifier];
      NSURL *localURL = [self localURLForRecord:record];
      NSNumber *size = localURL ? [[[NSFileManager defaultManager] attributesOfItemAtPath:localURL.path error:nil] objectForKey:NSFileSize] : nil;
      bytesRemoved += size ? size.unsignedLongLongValue : [record[@"bytesWritten"] unsignedLongLongValue];
    }
    if (staleIdentifiers.count == 0) {
      resolve(@{ @"bytesRemoved": @0, @"recordsRemoved": @0 });
      return;
    }
    [self.session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> *tasks) {
      for (NSURLSessionTask *task in tasks) if ([staleIdentifiers containsObject:task.taskDescription ?: @""]) [task cancel];
      dispatch_async(dispatch_get_main_queue(), ^{
        BOOL cleanupFailed = NO;
        NSUInteger recordsRemoved = 0;
        for (NSString *identifier in staleIdentifiers) {
          NSDictionary *record = self.records[identifier];
          if (!record || ![self record:record hasViewerIdentityOfScope:scope]) continue;
          if ([[self safeString:record[@"authorizationRevision"]] isEqualToString:[self safeString:scope[@"authorizationRevision"]]]) continue;
          NSMutableDictionary *mutableRecord = [record mutableCopy];
          mutableRecord[@"state"] = @"deleted";
          mutableRecord[@"updatedAt"] = [self timestamp];
          self.records[identifier] = mutableRecord;
          if (![self removeOfflineArtifactsForIdentifier:identifier record:mutableRecord]) {
            cleanupFailed = YES;
            [self markDownloadRecoveryNeeded];
            continue;
          }
          [self.records removeObjectForKey:identifier];
          recordsRemoved += 1;
        }
        if (![self persistAndEmit]) cleanupFailed = YES;
        if (cleanupFailed) {
          [self markDownloadRecoveryNeeded];
          [self persistAndEmit];
          reject(@"download_cleanup_failed", @"Portico could not complete the protected download cleanup. Try again later.", nil);
          return;
        }
        resolve(@{ @"bytesRemoved": @(bytesRemoved), @"recordsRemoved": @(recordsRemoved) });
      });
    }];
  });
}

RCT_REMAP_METHOD(stagePreparation,
                 request:(NSDictionary *)request
                 stagePreparationResolver:(RCTPromiseResolveBlock)resolve
                 stagePreparationRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *identifier = [self safeString:request[@"id"]];
    NSString *mediaID = [self safeString:request[@"mediaId"]];
    NSString *profile = [self safeString:request[@"profile"]];
    NSString *preparationID = [self safeString:request[@"preparationId"]];
    NSString *title = [self safeString:request[@"title"]];
    NSString *state = [self safeString:request[@"state"]];
    NSSet<NSString *> *preparationStates = [NSSet setWithArray:@[@"preparing", @"paused", @"failed", @"unavailable"]];
    double preparationProgress = [request[@"preparationProgress"] doubleValue];
    if (![self isSafeIdentifier:identifier] || ![self isValidScope:request] || [self safeString:request[@"clientIdentifier"]].length == 0 || mediaID.length == 0 || profile.length == 0 || preparationID.length == 0 || title.length == 0 || ![preparationStates containsObject:state] || !isfinite(preparationProgress) || preparationProgress < 0 || preparationProgress > 100) {
      reject(@"invalid_download_preparation", @"download.failed", nil);
      return;
    }
    NSMutableDictionary *existing = self.records[identifier];
    if (existing && ![self record:existing belongsToScope:request]) {
      reject(@"download_scope_conflict", @"download.failed", nil);
      return;
    }
    if (existing && ![@[@"preparing", @"failed", @"expired", @"unavailable"] containsObject:existing[@"state"] ?: @""]) {
      resolve([self publicRecord:existing]);
      return;
    }
    long long expectedBytesValue = [request[@"expectedBytes"] longLongValue] > 0 ? [request[@"expectedBytes"] longLongValue] : 0;
    if (existing &&
        [existing[@"mediaId"] isEqualToString:mediaID] &&
        [existing[@"profile"] isEqualToString:profile] &&
        [existing[@"preparationId"] isEqualToString:preparationID] &&
        [existing[@"title"] isEqualToString:title] &&
        [(existing[@"subtitle"] ?: @"") isEqualToString:[self safeString:request[@"subtitle"]]] &&
        [existing[@"state"] isEqualToString:state] &&
        fabs([existing[@"preparationProgress"] doubleValue] - preparationProgress) < 0.0001 &&
        [existing[@"bytesExpected"] longLongValue] == expectedBytesValue) {
      // Native change events drive the JS scheduler. Do not rewrite and emit
      // an unchanged preparation or it creates an event -> refresh -> stage
      // feedback loop while the server is still preparing the asset.
      resolve([self publicRecord:existing]);
      return;
    }
    NSString *now = [self timestamp];
    NSMutableDictionary *record = [@{
      @"id": identifier,
      @"clientIdentifier": [self safeString:request[@"clientIdentifier"]],
      @"mediaId": mediaID,
      @"profile": profile,
      @"preparationId": preparationID,
      @"authority": [self safeString:request[@"authority"]],
      @"accountId": [self safeString:request[@"accountId"]],
      @"serverId": [self safeString:request[@"serverId"]],
      @"profileId": [self safeString:request[@"profileId"]],
      @"authorizationRevision": [self safeString:request[@"authorizationRevision"]],
      @"title": title,
      @"subtitle": [self safeString:request[@"subtitle"]],
      @"state": state,
      @"preparationProgress": @(preparationProgress),
      @"bytesWritten": @0,
      @"bytesExpected": @(expectedBytesValue),
      @"transferStarted": @NO,
      @"createdAt": existing[@"createdAt"] ?: now,
      @"updatedAt": now,
    } mutableCopy];
    self.records[identifier] = record;
    [self persistAndEmit];
    resolve([self publicRecord:record]);
  });
}

RCT_REMAP_METHOD(enqueue,
                 request:(NSDictionary *)request
                 enqueueResolver:(RCTPromiseResolveBlock)resolve
                 enqueueRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSString *identifier = [self safeString:request[@"id"]];
    NSString *mediaID = [self safeString:request[@"mediaId"]];
    NSString *profile = [self safeString:request[@"profile"]];
    NSString *preparationID = [self safeString:request[@"preparationId"]];
    NSString *title = [self safeString:request[@"title"]];
    NSString *authorization = [self safeString:request[@"authorization"]];
    NSNumber *expectedBytes = request[@"expectedBytes"];
    NSNumber *storageLimitBytes = request[@"storageLimitBytes"];
    NSURL *url = [NSURL URLWithString:[self safeString:request[@"downloadURL"]]];
    NSURLComponents *components = url ? [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO] : nil;
    BOOL containsCredentialQuery = NO;
    for (NSURLQueryItem *item in components.queryItems) {
      if ([item.name isEqualToString:@"download_grant"] || [item.name isEqualToString:@"media_grant"] || [item.name isEqualToString:@"access_token"]) containsCredentialQuery = YES;
    }
    BOOL hasScopedGrant = [authorization hasPrefix:@"PorticoDownload "] && authorization.length > @"PorticoDownload ".length;
    NSString *scheme = components.scheme.lowercaseString;
    BOOL safeTransport = [scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"];
    BOOL safeAuthority = components.host.length > 0 && components.user.length == 0 && components.password.length == 0;
    if (![self isSafeIdentifier:identifier] || ![self isValidScope:request] || [self safeString:request[@"clientIdentifier"]].length == 0 || mediaID.length == 0 || profile.length == 0 || preparationID.length == 0 || title.length == 0 || !url || !safeTransport || !safeAuthority || !hasScopedGrant || containsCredentialQuery || expectedBytes.longLongValue <= 0 || storageLimitBytes.longLongValue <= 0) {
      reject(@"invalid_download", @"The download request is incomplete.", nil);
      return;
    }
    NSSet<NSString *> *retryableStates = [NSSet setWithArray:@[@"preparing", @"failed", @"expired", @"unavailable"]];
    if (self.records[identifier] && ![self record:self.records[identifier] belongsToScope:request]) {
      reject(@"download_scope_conflict", @"That download identifier belongs to another Portico profile.", nil);
      return;
    }
    if (self.records[identifier] && ![retryableStates containsObject:self.records[identifier][@"state"] ?: @""]) {
      resolve([self publicRecord:self.records[identifier]]);
      return;
    }

    unsigned long long reservedBytes = 0;
    NSSet<NSString *> *reservedStates = [NSSet setWithArray:@[@"queued", @"preparing", @"downloading", @"paused", @"completed"]];
    for (NSString *recordID in self.records) {
      if ([recordID isEqualToString:identifier]) continue;
      NSDictionary *candidate = self.records[recordID];
      if (![self record:candidate belongsToScope:request] || ![reservedStates containsObject:candidate[@"state"] ?: @""]) continue;
      reservedBytes += [candidate[@"bytesExpected"] unsignedLongLongValue];
    }
    unsigned long long requestedBytes = expectedBytes.unsignedLongLongValue;
    unsigned long long storageLimit = storageLimitBytes.unsignedLongLongValue;
    NSDictionary *filesystem = [[NSFileManager defaultManager] attributesOfFileSystemForPath:[self supportDirectory].path error:nil];
    unsigned long long availableBytes = [filesystem[NSFileSystemFreeSize] unsignedLongLongValue];
    if (requestedBytes > storageLimit || reservedBytes > storageLimit - requestedBytes || availableBytes < requestedBytes) {
      reject(@"download_storage_full", @"download.storage-full", nil);
      return;
    }

    NSMutableDictionary *previous = self.records[identifier];
    NSURL *previousLocalURL = previous ? [self localURLForRecord:previous] : nil;
    if (previousLocalURL) [[NSFileManager defaultManager] removeItemAtURL:previousLocalURL error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:[self resumeURL:identifier] error:nil];

    NSString *now = [self timestamp];
    NSMutableDictionary *record = [@{
      @"id": identifier,
      @"clientIdentifier": [self safeString:request[@"clientIdentifier"]],
      @"mediaId": mediaID,
      @"profile": profile,
      @"preparationId": preparationID,
      @"authority": [self safeString:request[@"authority"]],
      @"accountId": [self safeString:request[@"accountId"]],
      @"serverId": [self safeString:request[@"serverId"]],
      @"profileId": [self safeString:request[@"profileId"]],
      @"authorizationRevision": [self safeString:request[@"authorizationRevision"]],
      @"title": title,
      @"subtitle": [self safeString:request[@"subtitle"]],
      @"state": @"queued",
      @"bytesWritten": @0,
      @"bytesExpected": expectedBytes,
      @"storageLimitBytes": storageLimitBytes,
      @"transferStarted": @YES,
      @"wifiOnly": @([request[@"wifiOnly"] boolValue]),
      @"createdAt": now,
      @"updatedAt": now,
    } mutableCopy];
    self.records[identifier] = record;
    [self persistAndEmit];

    NSMutableURLRequest *urlRequest = [NSMutableURLRequest requestWithURL:url];
    urlRequest.cachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
    urlRequest.allowsCellularAccess = ![record[@"wifiOnly"] boolValue];
    [urlRequest setValue:authorization forHTTPHeaderField:@"Authorization"];
    NSURLSessionDownloadTask *task = [self.session downloadTaskWithRequest:urlRequest];
    task.taskDescription = identifier;
    record[@"state"] = @"preparing";
    record[@"updatedAt"] = [self timestamp];
    [self persistAndEmit];
    [task resume];
    resolve([self publicRecord:record]);
  });
}

RCT_REMAP_METHOD(pause,
                 pauseIdentifier:(NSString *)identifier
                 pauseScope:(NSDictionary *)scope
                 pauseResolver:(RCTPromiseResolveBlock)resolve
                 pauseRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *record = self.records[identifier];
    if (!record) { reject(@"download_not_found", @"That download is no longer on this device.", nil); return; }
    if (![self record:record belongsToScope:scope]) { reject(@"download_scope_denied", @"That download does not belong to the active Portico profile.", nil); return; }
    [self.session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> *tasks) {
      dispatch_async(dispatch_get_main_queue(), ^{
        NSURLSessionDownloadTask *matching = nil;
        for (NSURLSessionTask *task in tasks) if ([task.taskDescription isEqualToString:identifier]) { matching = (NSURLSessionDownloadTask *)task; break; }
        if (!matching) {
          reject(@"download_not_active", @"That download is not currently active. Try the download again to obtain a fresh authorization.", nil);
          return;
        }
        [matching suspend];
        record[@"state"] = @"paused";
        [record removeObjectForKey:@"error"];
        record[@"updatedAt"] = [self timestamp];
        [self persistAndEmit];
        resolve([self publicRecord:record]);
      });
    }];
  });
}

RCT_REMAP_METHOD(resume,
                 resumeIdentifier:(NSString *)identifier
                 resumeScope:(NSDictionary *)scope
                 resumeResolver:(RCTPromiseResolveBlock)resolve
                 resumeRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *record = self.records[identifier];
    if (!record) { reject(@"download_not_found", @"That download is no longer on this device.", nil); return; }
    if (![self record:record belongsToScope:scope]) { reject(@"download_scope_denied", @"That download does not belong to the active Portico profile.", nil); return; }
    [self.session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> *tasks) {
      dispatch_async(dispatch_get_main_queue(), ^{
        NSURLSessionDownloadTask *matching = nil;
        for (NSURLSessionTask *task in tasks) if ([task.taskDescription isEqualToString:identifier]) { matching = (NSURLSessionDownloadTask *)task; break; }
        if (!matching) {
          reject(@"download_restart_required", @"Portico cannot resume this transfer. Try the download again to obtain a new authorization.", nil);
          return;
        }
        record[@"state"] = @"preparing";
        [record removeObjectForKey:@"error"];
        record[@"updatedAt"] = [self timestamp];
        [self persistAndEmit];
        [matching resume];
        resolve([self publicRecord:record]);
      });
    }];
  });
}

RCT_REMAP_METHOD(remove,
                 removeIdentifier:(NSString *)identifier
                 removeScope:(NSDictionary *)scope
                 removeResolver:(RCTPromiseResolveBlock)resolve
                 removeRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *record = self.records[identifier];
    if (!record) { resolve(nil); return; }
    if (![self record:record belongsToScope:scope]) { reject(@"download_scope_denied", @"That download does not belong to the active Portico profile.", nil); return; }
    record[@"state"] = @"deleted";
    record[@"updatedAt"] = [self timestamp];
    [self persistAndEmit];
    [self.session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> *tasks) {
      for (NSURLSessionTask *task in tasks) if ([task.taskDescription isEqualToString:identifier]) [task cancel];
      dispatch_async(dispatch_get_main_queue(), ^{
        if (![self removeOfflineArtifactsForIdentifier:identifier record:record]) {
          [self markDownloadRecoveryNeeded];
          [self persistAndEmit];
          reject(@"download_cleanup_failed", @"Portico could not complete the protected download cleanup. Try again later.", nil);
          return;
        }
        [self.records removeObjectForKey:identifier];
        if (![self persistAndEmit]) {
          [self markDownloadRecoveryNeeded];
          [self persistAndEmit];
          reject(@"download_cleanup_failed", @"Portico could not persist the protected download cleanup. Try again later.", nil);
          return;
        }
        resolve([self publicRecord:record]);
      });
    }];
  });
}

RCT_REMAP_METHOD(updatePlaybackProgress,
                 progressIdentifier:(NSString *)identifier
                 positionSeconds:(double)positionSeconds
                 durationSeconds:(double)durationSeconds
                 completed:(BOOL)completed
                 ordering:(NSDictionary *)ordering
                 progressScope:(NSDictionary *)scope
                 progressResolver:(RCTPromiseResolveBlock)resolve
                 progressRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *record = self.records[identifier];
    if (!record || ![record[@"state"] isEqualToString:@"completed"]) {
      reject(@"download_not_playable", @"That offline file is no longer available.", nil);
      return;
    }
    if (![self record:record belongsToScope:scope]) { reject(@"download_scope_denied", @"That download does not belong to the active Portico profile.", nil); return; }
    double attempt = [ordering[@"attempt"] doubleValue];
    NSInteger revision = [ordering[@"revision"] integerValue];
    double currentAttempt = [record[@"playbackAttempt"] doubleValue];
    NSInteger currentRevision = [record[@"playbackProgressRevision"] integerValue];
    BOOL hasOrdering = record[@"playbackAttempt"] != nil && record[@"playbackProgressRevision"] != nil;
    if (hasOrdering && (attempt < currentAttempt || (attempt == currentAttempt && revision <= currentRevision))) {
      resolve([self publicRecord:record]);
      return;
    }
    record[@"playbackAttempt"] = @(attempt);
    record[@"playbackProgressRevision"] = @(revision);
    record[@"progressSeconds"] = @(MAX(0, positionSeconds));
    record[@"durationSeconds"] = @(MAX(0, durationSeconds));
    record[@"playbackCompleted"] = @([record[@"playbackCompleted"] boolValue] || completed);
    record[@"playbackProgressPending"] = @YES;
    record[@"updatedAt"] = [self timestamp];
    [self persistAndEmit];
    resolve([self publicRecord:record]);
  });
}

RCT_REMAP_METHOD(markPlaybackProgressSynced,
                 syncIdentifier:(NSString *)identifier
                 syncScope:(NSDictionary *)scope
                 syncResolver:(RCTPromiseResolveBlock)resolve
                 syncRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *record = self.records[identifier];
    if (!record) { reject(@"download_not_found", @"That download is no longer on this device.", nil); return; }
    if (![self record:record belongsToScope:scope]) { reject(@"download_scope_denied", @"That download does not belong to the active Portico profile.", nil); return; }
    if (![record[@"playbackProgressPending"] boolValue]) {
      resolve([self publicRecord:record]);
      return;
    }
    record[@"playbackProgressPending"] = @NO;
    record[@"updatedAt"] = [self timestamp];
    [self persistAndEmit];
    resolve([self publicRecord:record]);
  });
}

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)downloadTask didWriteData:(int64_t)bytesWritten totalBytesWritten:(int64_t)totalBytesWritten totalBytesExpectedToWrite:(int64_t)totalBytesExpectedToWrite {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *record = self.records[downloadTask.taskDescription ?: @""];
    if (!record) return;
    record[@"state"] = @"downloading";
    record[@"bytesWritten"] = @(MAX(0, totalBytesWritten));
    if (totalBytesExpectedToWrite > 0) record[@"bytesExpected"] = @(totalBytesExpectedToWrite);
    record[@"updatedAt"] = [self timestamp];
    [self persistAndEmit];
  });
}

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)downloadTask didFinishDownloadingToURL:(NSURL *)location {
  dispatch_sync(dispatch_get_main_queue(), ^{
  NSString *identifier = downloadTask.taskDescription ?: @"";
  NSMutableDictionary *record = self.records[identifier];
  if (!record) return;
  if ([record[@"state"] isEqualToString:@"deleted"]) {
    [[NSFileManager defaultManager] removeItemAtURL:location error:nil];
    return;
  }
  NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)downloadTask.response;
  if ([httpResponse isKindOfClass:NSHTTPURLResponse.class] && (httpResponse.statusCode < 200 || httpResponse.statusCode >= 300)) {
    [self applyHTTPFailure:httpResponse.statusCode record:record];
    record[@"updatedAt"] = [self timestamp];
    [self persistAndEmit];
    return;
  }
  NSString *extension = [self safeFileExtension:downloadTask.response.suggestedFilename.pathExtension];
  NSURL *destination = [[self downloadsDirectory] URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.%@", identifier, extension] isDirectory:NO];
  [[NSFileManager defaultManager] removeItemAtURL:destination error:nil];
  NSError *moveError = nil;
  [[NSFileManager defaultManager] moveItemAtURL:location toURL:destination error:&moveError];
  if (moveError) {
    record[@"state"] = @"failed";
    record[@"error"] = @"Portico could not protect the completed file on this device.";
  } else {
    [self protectURL:destination];
    NSNumber *size = [[[NSFileManager defaultManager] attributesOfItemAtPath:destination.path error:nil] objectForKey:NSFileSize] ?: @0;
    NSString *mimeType = downloadTask.response.MIMEType.lowercaseString ?: @"";
    BOOL looksLikeErrorDocument = [mimeType isEqualToString:@"text/html"] || [mimeType isEqualToString:@"application/json"] || [mimeType hasSuffix:@"+json"];
    if (size.unsignedLongLongValue == 0 || looksLikeErrorDocument) {
      [[NSFileManager defaultManager] removeItemAtURL:destination error:nil];
      record[@"state"] = @"failed";
      record[@"bytesWritten"] = @0;
      record[@"error"] = @"The server returned an invalid media file. Try again later.";
    } else {
      record[@"state"] = @"completed";
      record[@"bytesWritten"] = size;
      record[@"bytesExpected"] = size;
      record[@"localFilename"] = destination.lastPathComponent;
      [record removeObjectForKey:@"localPath"];
      [record removeObjectForKey:@"error"];
      [[NSFileManager defaultManager] removeItemAtURL:[self resumeURL:identifier] error:nil];
    }
  }
  record[@"updatedAt"] = [self timestamp];
  [self persistAndEmit];
  });
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  if (!error) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSMutableDictionary *record = self.records[task.taskDescription ?: @""];
    if (!record || [record[@"state"] isEqualToString:@"paused"] || [record[@"state"] isEqualToString:@"deleted"] || [record[@"state"] isEqualToString:@"completed"]) return;
    NSHTTPURLResponse *response = (NSHTTPURLResponse *)task.response;
    if (response.statusCode >= 400) {
      [self applyHTTPFailure:response.statusCode record:record];
    } else {
      [self applyTransportFailure:error record:record];
    }
    record[@"updatedAt"] = [self timestamp];
    [self persistAndEmit];
  });
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
        newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest * _Nullable))completionHandler {
  NSURL *source = task.originalRequest.URL ?: task.currentRequest.URL;
  NSURL *destination = request.URL;
  if (!source || !destination || ![source.host.lowercaseString isEqualToString:destination.host.lowercaseString] || ![source.path isEqualToString:destination.path]) {
    completionHandler(nil);
    return;
  }
  NSString *sourceScheme = source.scheme.lowercaseString;
  NSString *destinationScheme = destination.scheme.lowercaseString;
  NSInteger sourcePort = source.port ? source.port.integerValue : ([sourceScheme isEqualToString:@"https"] ? 443 : 80);
  NSInteger destinationPort = destination.port ? destination.port.integerValue : ([destinationScheme isEqualToString:@"https"] ? 443 : 80);
  BOOL sameTransport = [sourceScheme isEqualToString:destinationScheme] && sourcePort == destinationPort;
  BOOL secureUpgrade = [sourceScheme isEqualToString:@"http"] && sourcePort == 80 && [destinationScheme isEqualToString:@"https"] && destinationPort == 443;
  BOOL safeAuthority = destination.user.length == 0 && destination.password.length == 0;
  NSURLComponents *sourceComponents = [NSURLComponents componentsWithURL:source resolvingAgainstBaseURL:NO];
  NSURLComponents *destinationComponents = [NSURLComponents componentsWithURL:destination resolvingAgainstBaseURL:NO];
  BOOL sourceHasCredentialQuery = NO;
  BOOL destinationHasCredentialQuery = NO;
  for (NSURLQueryItem *item in sourceComponents.queryItems) {
    if ([item.name isEqualToString:@"download_grant"] || [item.name isEqualToString:@"media_grant"] || [item.name isEqualToString:@"access_token"]) sourceHasCredentialQuery = YES;
  }
  for (NSURLQueryItem *item in destinationComponents.queryItems) {
    if ([item.name isEqualToString:@"download_grant"] || [item.name isEqualToString:@"media_grant"] || [item.name isEqualToString:@"access_token"]) destinationHasCredentialQuery = YES;
  }
  NSString *authorization = [task.originalRequest valueForHTTPHeaderField:@"Authorization"] ?: [task.currentRequest valueForHTTPHeaderField:@"Authorization"];
  BOOL hasScopedGrant = [authorization hasPrefix:@"PorticoDownload "] && authorization.length > @"PorticoDownload ".length;
  if ((!sameTransport && !secureUpgrade) || !safeAuthority || sourceHasCredentialQuery || destinationHasCredentialQuery || !hasScopedGrant) {
    completionHandler(nil);
    return;
  }
  NSMutableURLRequest *replacement = [request mutableCopy];
  [replacement setValue:authorization forHTTPHeaderField:@"Authorization"];
  completionHandler(replacement);
}

- (void)applyHTTPFailure:(NSInteger)statusCode record:(NSMutableDictionary *)record {
  if (statusCode == 401 || statusCode == 403) {
    record[@"state"] = @"expired";
    record[@"error"] = @"Download authorization expired before the transfer started. Try the download again.";
  } else if (statusCode == 404 || statusCode == 410) {
    record[@"state"] = @"unavailable";
    record[@"error"] = @"This media version is no longer available from the server.";
  } else {
    record[@"state"] = @"failed";
    record[@"error"] = @"The server could not provide this download. Try again later.";
  }
}

- (void)URLSessionDidFinishEventsForBackgroundURLSession:(NSURLSession *)session {
  NSString *identifier = session.configuration.identifier ?: PorticoDownloadSessionIdentifier;
  // Delegate callbacks above may enqueue durable record updates on the main
  // queue. Post only after those updates have drained so UIKit's completion
  // handler observes the complete background-session transaction.
  dispatch_async(dispatch_get_main_queue(), ^{
    [[NSNotificationCenter defaultCenter] postNotificationName:PorticoBackgroundEventsFinished object:nil userInfo:@{ @"identifier": identifier }];
  });
}

- (void)reconcileTasks {
  [self.session getAllTasksWithCompletionHandler:^(NSArray<__kindof NSURLSessionTask *> *tasks) {
    dispatch_async(dispatch_get_main_queue(), ^{
      BOOL reconciliationSucceeded = YES;
      NSMutableSet<NSString *> *active = [NSMutableSet new];
      for (NSURLSessionTask *task in tasks) {
        NSString *identifier = task.taskDescription;
        if (!identifier.length || !self.records[identifier]) {
          [task cancel];
          reconciliationSucceeded = NO;
          continue;
        }
        [active addObject:identifier];
        if (task.state == NSURLSessionTaskStateSuspended) self.records[identifier][@"state"] = @"paused";
        else self.records[identifier][@"state"] = task.countOfBytesReceived > 0 ? @"downloading" : @"preparing";
      }
      for (NSString *identifier in [self.records.allKeys copy]) {
        NSMutableDictionary *record = self.records[identifier];
        NSString *state = record[@"state"];
        NSURL *localURL = [self localURLForRecord:record];
        if ([state isEqualToString:@"deleted"]) {
          if (![self removeOfflineArtifactsForIdentifier:identifier record:record]) {
            reconciliationSucceeded = NO;
            continue;
          }
          [self.records removeObjectForKey:identifier];
          continue;
        }

        BOOL hasActiveTask = [active containsObject:identifier];
        if (hasActiveTask) {
          // NSURLSession writes to a temporary URL until didFinishDownloading.
          // A destination left by an interrupted attempt is never evidence of a
          // complete download and must not survive recovery as playable media.
          if (localURL && ![self removeFileIfPresentAtURL:localURL]) {
            reconciliationSucceeded = NO;
          } else if (localURL) {
            [record removeObjectForKey:@"localFilename"];
            [record removeObjectForKey:@"localPath"];
          }
          continue;
        }

        if ([state isEqualToString:@"completed"] && [self isCompleteMediaFileAtURL:localURL record:record]) {
          NSNumber *size = [[[NSFileManager defaultManager] attributesOfItemAtPath:localURL.path error:nil] objectForKey:NSFileSize];
          record[@"bytesWritten"] = size ?: @0;
          record[@"localFilename"] = localURL.lastPathComponent;
          [record removeObjectForKey:@"localPath"];
          [record removeObjectForKey:@"error"];
          continue;
        }

        if (localURL && ![self removeFileIfPresentAtURL:localURL]) {
          reconciliationSucceeded = NO;
        } else if (localURL) {
          [record removeObjectForKey:@"localFilename"];
          [record removeObjectForKey:@"localPath"];
        }

        if ([state isEqualToString:@"completed"]) {
          record[@"state"] = @"unavailable";
          record[@"bytesWritten"] = @0;
          record[@"error"] = @"The downloaded file is no longer stored on this iPhone. Download it again to watch offline.";
          continue;
        }
        if ([state isEqualToString:@"paused"] && ![active containsObject:identifier]) {
          record[@"state"] = @"failed";
          record[@"error"] = @"The background transfer is no longer available. Try the download again to obtain a fresh authorization.";
          continue;
        }
        if ([record[@"transferStarted"] boolValue] && ([state isEqualToString:@"queued"] || [state isEqualToString:@"downloading"] || [state isEqualToString:@"preparing"]) && ![active containsObject:identifier]) {
          record[@"state"] = @"failed";
          record[@"error"] = @"The background transfer ended before it completed.";
        }
      }
      if (self.allowOrphanCleanup || self.recoveryPending) {
        if (![self removeOrphanedOfflineFiles]) {
          reconciliationSucceeded = NO;
          [self markDownloadRecoveryNeeded];
        }
      }
      if (![self persistAndEmit]) {
        reconciliationSucceeded = NO;
        [self markDownloadRecoveryNeeded];
      }
      if (self.recoveryPending) {
        if (reconciliationSucceeded && [self clearDownloadRecoveryMarker]) {
          self.allowOrphanCleanup = YES;
        } else {
          [self markDownloadRecoveryNeeded];
          self.allowOrphanCleanup = NO;
        }
      }
    });
  }];
}

- (NSArray *)publicRecordsForScope:(NSDictionary *)scope {
  NSArray *values = [self.records.allValues sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [b[@"createdAt"] compare:a[@"createdAt"]];
  }];
  NSMutableArray *result = [NSMutableArray new];
  for (NSDictionary *record in values) if ([self record:record belongsToScope:scope]) [result addObject:[self publicRecord:record]];
  return result;
}

- (NSDictionary *)publicRecord:(NSDictionary *)record {
  NSMutableDictionary *result = [record mutableCopy];
  NSURL *localURL = [self localURLForRecord:record];
  [result removeObjectForKey:@"localPath"];
  [result removeObjectForKey:@"localFilename"];
  // A destination file is exposed only after a terminal completed state and
  // a basic completeness check. Recovery may leave a partial artifact on
  // disk, but it must remain unusable until reconciliation proves it safe.
  if ([record[@"state"] isEqualToString:@"completed"] && [self isCompleteMediaFileAtURL:localURL record:record]) result[@"localURL"] = localURL.absoluteString;
  long long expected = [record[@"bytesExpected"] longLongValue];
  long long written = [record[@"bytesWritten"] longLongValue];
  result[@"progress"] = [record[@"transferStarted"] boolValue]
    ? (expected > 0 ? @(MIN(1.0, MAX(0.0, (double)written / (double)expected))) : @0)
    : @(MIN(1.0, MAX(0.0, [record[@"preparationProgress"] doubleValue] / 100.0)));
  return result;
}

- (void)emitRecords {
  // Never broadcast record metadata: subscribers re-read through list(scope),
  // which enforces the active viewer at the native boundary.
  if (self.observing) [self sendEventWithName:PorticoDownloadsEvent body:@{ @"changed": @YES }];
}

- (BOOL)persistAndEmit {
  BOOL saved = [self saveRecords];
  [self emitRecords];
  return saved;
}

- (NSURL *)supportDirectory {
  NSURL *url = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] firstObject];
  url = [url URLByAppendingPathComponent:@"Portico" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:url withIntermediateDirectories:YES attributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication} error:nil];
  [self excludeURLFromBackup:url];
  return url;
}

- (NSURL *)downloadsDirectory {
  NSURL *url = [[self supportDirectory] URLByAppendingPathComponent:@"Offline Media" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:url withIntermediateDirectories:YES attributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication} error:nil];
  [self excludeURLFromBackup:url];
  return url;
}

- (NSURL *)recordsURL { return [[self supportDirectory] URLByAppendingPathComponent:@"downloads.json"]; }
- (NSURL *)recordsBackupURL { return [[self supportDirectory] URLByAppendingPathComponent:@"downloads.backup.json"]; }
- (NSURL *)recordsCorruptURL { return [[self supportDirectory] URLByAppendingPathComponent:@"downloads.corrupt.json"]; }
- (NSURL *)recoveryMarkerURL { return [[self supportDirectory] URLByAppendingPathComponent:@"downloads.recovery-needed"]; }
- (NSURL *)resumeURL:(NSString *)identifier { return [[self supportDirectory] URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.resume", identifier]]; }

- (NSURL *)localURLForRecord:(NSDictionary *)record {
  NSString *filename = [self safeString:record[@"localFilename"]];
  if (filename.length == 0) filename = [self safeString:record[@"localPath"]].lastPathComponent;
  if (filename.length == 0 || ![filename isEqualToString:filename.lastPathComponent]) return nil;
  return [[self downloadsDirectory] URLByAppendingPathComponent:filename isDirectory:NO];
}

- (void)loadRecords {
  NSURL *primaryURL = [self recordsURL];
  BOOL primaryExists = [[NSFileManager defaultManager] fileExistsAtPath:primaryURL.path];
  self.recoveryPending = [[NSFileManager defaultManager] fileExistsAtPath:[self recoveryMarkerURL].path];
  if (!primaryExists) {
    BOOL backupValid = NO;
    NSMutableDictionary *backup = [self validatedRecordsAtURL:[self recordsBackupURL] valid:&backupValid];
    NSArray<NSURL *> *mediaFiles = [[NSFileManager defaultManager] contentsOfDirectoryAtURL:[self downloadsDirectory]
                                                                  includingPropertiesForKeys:nil
                                                                                     options:NSDirectoryEnumerationSkipsHiddenFiles
                                                                                       error:nil] ?: @[];
    if (backupValid || mediaFiles.count > 0) {
      if (backupValid) self.records = backup;
      [self markDownloadRecoveryNeeded];
      self.allowOrphanCleanup = NO;
    } else {
      self.allowOrphanCleanup = !self.recoveryPending;
    }
    return;
  }
  BOOL primaryValid = NO;
  NSMutableDictionary *primary = [self validatedRecordsAtURL:primaryURL valid:&primaryValid];
  if (primaryValid) {
    self.records = primary;
    self.allowOrphanCleanup = !self.recoveryPending;
    return;
  }
  NSFileManager *files = NSFileManager.defaultManager;
  [files removeItemAtURL:[self recordsCorruptURL] error:nil];
  [files copyItemAtURL:primaryURL toURL:[self recordsCorruptURL] error:nil];
  [self markDownloadRecoveryNeeded];
  [self protectURL:[self recordsCorruptURL]];
  BOOL backupValid = NO;
  NSMutableDictionary *backup = [self validatedRecordsAtURL:[self recordsBackupURL] valid:&backupValid];
  self.records = backupValid ? backup : [NSMutableDictionary new];
  self.allowOrphanCleanup = NO;
}

- (BOOL)markDownloadRecoveryNeeded {
  self.recoveryPending = YES;
  self.allowOrphanCleanup = NO;
  NSError *error = nil;
  BOOL written = [@"recovery-needed" writeToURL:[self recoveryMarkerURL] atomically:YES encoding:NSUTF8StringEncoding error:&error];
  if (written) [self protectURL:[self recoveryMarkerURL]];
  return written;
}

- (BOOL)clearDownloadRecoveryMarker {
  NSURL *markerURL = [self recoveryMarkerURL];
  NSFileManager *files = NSFileManager.defaultManager;
  if ([files fileExistsAtPath:markerURL.path]) {
    NSDictionary *attributes = [files attributesOfItemAtPath:markerURL.path error:nil];
    if ([attributes[NSFileType] isEqualToString:NSFileTypeDirectory]) return NO;
    NSError *error = nil;
    [files removeItemAtURL:markerURL error:&error];
    if ([files fileExistsAtPath:markerURL.path]) return NO;
  }
  self.recoveryPending = NO;
  return YES;
}

- (NSMutableDictionary *)validatedRecordsAtURL:(NSURL *)url valid:(BOOL *)valid {
  if (valid) *valid = NO;
  NSData *data = [NSData dataWithContentsOfURL:url];
  NSDictionary *decoded = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil] : nil;
  if (![decoded isKindOfClass:NSDictionary.class]) return [NSMutableDictionary new];
  NSMutableDictionary *validated = [NSMutableDictionary new];
  __block BOOL allRecordsValid = YES;
  [(NSDictionary *)decoded enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *stop) {
    if (![key isKindOfClass:NSString.class] || ![self isSafeIdentifier:key] || ![value isKindOfClass:NSDictionary.class]) { allRecordsValid = NO; return; }
    NSDictionary *candidate = value;
    if (![[self safeString:candidate[@"id"]] isEqualToString:key] || [self safeString:candidate[@"mediaId"]].length == 0 || [self safeString:candidate[@"title"]].length == 0) { allRecordsValid = NO; return; }
    NSMutableDictionary *record = [candidate mutableCopy];
    // Older builds wrote NSURLSession resume data, which can contain request
    // headers. Delete it during migration; Portico never persists grant-bearing
    // resume blobs and instead relies on the protected background session task.
    [[NSFileManager defaultManager] removeItemAtURL:[self resumeURL:key] error:nil];
    // V1 records without complete owner scope remain on disk, including their
    // protected media, but are invisible and inoperable until explicitly
    // removed by a future recovery/migration flow. They are never attributed
    // to whichever profile happens to open the upgraded app first.
    if (![self isValidScope:record] || [self safeString:record[@"clientIdentifier"]].length == 0) record[@"quarantined"] = @YES;
    else [record removeObjectForKey:@"quarantined"];
    validated[key] = record;
  }];
  if (valid) *valid = allRecordsValid;
  return validated;
}

- (BOOL)saveRecords {
  NSError *serializationError = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:self.records options:0 error:&serializationError];
  if (!data) return NO;
  BOOL currentValid = NO;
  [self validatedRecordsAtURL:[self recordsURL] valid:&currentValid];
  if (currentValid) {
    [[NSFileManager defaultManager] removeItemAtURL:[self recordsBackupURL] error:nil];
    [[NSFileManager defaultManager] copyItemAtURL:[self recordsURL] toURL:[self recordsBackupURL] error:nil];
    [self protectURL:[self recordsBackupURL]];
  }
  NSError *writeError = nil;
  if (![data writeToURL:[self recordsURL] options:NSDataWritingAtomic error:&writeError]) return NO;
  [self protectURL:[self recordsURL]];
  return YES;
}

- (void)protectURL:(NSURL *)url {
  [[NSFileManager defaultManager] setAttributes:@{NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication} ofItemAtPath:url.path error:nil];
  [self excludeURLFromBackup:url];
}

- (void)excludeURLFromBackup:(NSURL *)url {
  [url setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
}

- (void)applyTransportFailure:(NSError *)error record:(NSMutableDictionary *)record {
  record[@"state"] = @"failed";
  switch (error.code) {
    case NSURLErrorNotConnectedToInternet:
    case NSURLErrorNetworkConnectionLost:
    case NSURLErrorTimedOut:
    case NSURLErrorCannotFindHost:
    case NSURLErrorCannotConnectToHost:
    case NSURLErrorDNSLookupFailed:
      record[@"error"] = @"The download was interrupted by a network problem. Try again when the server is reachable.";
      break;
    case NSURLErrorCannotWriteToFile:
    case NSURLErrorNoPermissionsToReadFile:
    case NSURLErrorDataLengthExceedsMaximum:
      record[@"error"] = @"The download could not be stored on this iPhone. Check available storage and try again.";
      break;
    default:
      record[@"error"] = @"The download was interrupted. Try again when the server is reachable.";
      break;
  }
}

- (BOOL)isCompleteMediaFileAtURL:(NSURL *)url record:(NSDictionary *)record {
  if (!url) return NO;
  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:url.path error:nil];
  if (![attributes[NSFileType] isEqualToString:NSFileTypeRegular]) return NO;
  unsigned long long size = [attributes[NSFileSize] unsignedLongLongValue];
  if (size == 0) return NO;
  long long expectedBytes = [record[@"bytesExpected"] longLongValue];
  return expectedBytes >= 0 && (expectedBytes == 0 || size >= (unsigned long long)expectedBytes);
}

- (BOOL)removeFileIfPresentAtURL:(NSURL *)url {
  if (!url) return YES;
  NSFileManager *files = NSFileManager.defaultManager;
  if (![files fileExistsAtPath:url.path]) return YES;
  NSDictionary *attributes = [files attributesOfItemAtPath:url.path error:nil];
  if ([attributes[NSFileType] isEqualToString:NSFileTypeDirectory]) return NO;
  NSError *error = nil;
  [files removeItemAtURL:url error:&error];
  return ![files fileExistsAtPath:url.path];
}

- (BOOL)removeOfflineArtifactsForIdentifier:(NSString *)identifier record:(NSDictionary *)record {
  if (![self removeFileIfPresentAtURL:[self localURLForRecord:record]]) return NO;
  return [self removeFileIfPresentAtURL:[self resumeURL:identifier]];
}

- (BOOL)removeOrphanedOfflineFiles {
  NSMutableSet<NSString *> *referenced = [NSMutableSet new];
  for (NSDictionary *record in self.records.allValues) {
    if (![record[@"state"] isEqualToString:@"completed"]) continue;
    NSURL *localURL = [self localURLForRecord:record];
    if ([self isCompleteMediaFileAtURL:localURL record:record]) [referenced addObject:localURL.lastPathComponent];
  }
  NSError *directoryError = nil;
  NSArray<NSURL *> *files = [[NSFileManager defaultManager] contentsOfDirectoryAtURL:[self downloadsDirectory]
                                                               includingPropertiesForKeys:nil
                                                                                  options:NSDirectoryEnumerationSkipsHiddenFiles
                                                                                    error:&directoryError];
  if (directoryError || !files) return NO;
  for (NSURL *file in files) {
    if ([referenced containsObject:file.lastPathComponent]) continue;
    if (![self removeFileIfPresentAtURL:file]) return NO;
  }
  return YES;
}

- (BOOL)isSafeIdentifier:(NSString *)identifier {
  if (identifier.length == 0 || identifier.length > 128) return NO;
  NSCharacterSet *unsafe = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"] invertedSet];
  return [identifier rangeOfCharacterFromSet:unsafe].location == NSNotFound;
}

- (BOOL)isValidScope:(NSDictionary *)scope {
  if (![scope isKindOfClass:NSDictionary.class]) return NO;
  NSString *authority = [self safeString:scope[@"authority"]];
  BOOL validAuthority = [authority isEqualToString:@"hosted"] || [authority isEqualToString:@"local"];
  return validAuthority
    && [self safeString:scope[@"accountId"]].length > 0
    && [self safeString:scope[@"serverId"]].length > 0
    && [self safeString:scope[@"profileId"]].length > 0
    && [self safeString:scope[@"authorizationRevision"]].length > 0;
}

- (BOOL)record:(NSDictionary *)record belongsToScope:(NSDictionary *)scope {
  if (![self isValidScope:scope] || ![self isValidScope:record] || [record[@"quarantined"] boolValue]) return NO;
  return [[self safeString:record[@"authority"]] isEqualToString:[self safeString:scope[@"authority"]]]
    && [[self safeString:record[@"accountId"]] isEqualToString:[self safeString:scope[@"accountId"]]]
    && [[self safeString:record[@"serverId"]] isEqualToString:[self safeString:scope[@"serverId"]]]
    && [[self safeString:record[@"profileId"]] isEqualToString:[self safeString:scope[@"profileId"]]]
    && [[self safeString:record[@"authorizationRevision"]] isEqualToString:[self safeString:scope[@"authorizationRevision"]]];
}

- (BOOL)record:(NSDictionary *)record hasViewerIdentityOfScope:(NSDictionary *)scope {
  if (![self isValidScope:scope] || ![self isValidScope:record] || [record[@"quarantined"] boolValue]) return NO;
  return [[self safeString:record[@"authority"]] isEqualToString:[self safeString:scope[@"authority"]]]
    && [[self safeString:record[@"accountId"]] isEqualToString:[self safeString:scope[@"accountId"]]]
    && [[self safeString:record[@"serverId"]] isEqualToString:[self safeString:scope[@"serverId"]]]
    && [[self safeString:record[@"profileId"]] isEqualToString:[self safeString:scope[@"profileId"]]];
}

- (NSString *)safeFileExtension:(NSString *)extension {
  NSString *candidate = extension.lowercaseString ?: @"";
  if (candidate.length == 0 || candidate.length > 8) return @"media";
  NSCharacterSet *unsafe = [[NSCharacterSet alphanumericCharacterSet] invertedSet];
  return [candidate rangeOfCharacterFromSet:unsafe].location == NSNotFound ? candidate : @"media";
}

- (NSString *)timestamp {
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  return [formatter stringFromDate:[NSDate date]];
}

- (NSString *)safeString:(id)value { return [value isKindOfClass:NSString.class] ? value : @""; }

@end
