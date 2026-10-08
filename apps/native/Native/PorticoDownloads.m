#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTUtils.h>
#import <AVKit/AVKit.h>
#import <CommonCrypto/CommonDigest.h>
#import "PorticoDownloadAttempt.h"

// Offline downloads for iPhone and iPad.
//
// The server prepares a file and hands out a short-lived address for it; this module moves the
// bytes and keeps them. Transfers run in a background URLSession, so they continue while the
// app is suspended and are picked up again when it next launches. A finished file is checked
// against the server's SHA-256 before it is called ready: a truncated or substituted file is
// deleted, never played. Files live in Application Support, excluded from iCloud backup (they
// are re-downloadable and can be tens of gigabytes).
//
// This module knows nothing about accounts, receipts or what may be played; that is decided in
// JavaScript from the server's signed receipt. It moves, stores, verifies and plays files.

static NSString *const PorticoDownloadsSession = @"tv.getportico.portico.downloads";
static NSString *const PorticoDownloadChanged = @"PorticoDownloadChanged";
static NSString *const PorticoDownloadPlayback = @"PorticoDownloadPlayback";

// Hosts the system player so its dismissal is observable: the module keeps the AVPlayer alive
// to report position, and without this a closed player would keep playing sound.
@interface PorticoOfflinePlayerHost : UIViewController
@property (nonatomic, copy) void (^onClosed)(void);
@end
@implementation PorticoOfflinePlayerHost
- (void)viewDidDisappear:(BOOL)animated {
  [super viewDidDisappear:animated];
  if ((self.isBeingDismissed || self.presentingViewController == nil) && self.onClosed) { void (^closed)(void) = self.onClosed; self.onClosed = nil; closed(); }
}
- (BOOL)prefersHomeIndicatorAutoHidden { return YES; }
@end

@interface PorticoDownloads : RCTEventEmitter <RCTBridgeModule, NSURLSessionDownloadDelegate>
@end

@implementation PorticoDownloads {
  NSURLSession *_session;
  NSMutableDictionary<NSString *, NSMutableDictionary *> *_entries;
  NSMutableDictionary<NSString *, NSNumber *> *_lastEmit;
  NSMutableDictionary<NSString *, NSURLSessionDownloadTask *> *_activeTasks;
  dispatch_queue_t _queue;
  BOOL _observing;
  BOOL _cellular;
  AVPlayer *_player;
  id _timeObserver;
  NSString *_playingId;
}

RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return NO; }
- (NSArray<NSString *> *)supportedEvents { return @[PorticoDownloadChanged, PorticoDownloadPlayback]; }
- (void)startObserving { _observing = YES; }
- (void)stopObserving { _observing = NO; }

- (instancetype)init {
  if ((self = [super init])) {
    _queue = dispatch_queue_create("tv.getportico.downloads", DISPATCH_QUEUE_SERIAL);
    _lastEmit = [NSMutableDictionary new];
    _activeTasks = [NSMutableDictionary new];
    _cellular = [[NSUserDefaults standardUserDefaults] boolForKey:@"PorticoDownloadsCellular"];
    [self loadManifest];
    [self session];
  }
  return self;
}

#pragma mark - Storage

- (NSURL *)root {
  NSURL *base = [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *root = [base URLByAppendingPathComponent:@"Downloads" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:root withIntermediateDirectories:YES attributes:nil error:nil];
  [root setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
  return root;
}
- (NSURL *)manifestURL { return [[self root] URLByAppendingPathComponent:@"manifest.json"]; }
- (NSURL *)stateURL { return [[self root] URLByAppendingPathComponent:@"state.json"]; }
- (NSURL *)directoryFor:(NSString *)identifier { return [[self root] URLByAppendingPathComponent:identifier isDirectory:YES]; }
- (NSURL *)resumeURLFor:(NSString *)identifier { return [[self directoryFor:identifier] URLByAppendingPathComponent:@"resume.data"]; }

static BOOL PorticoSafeIdentifier(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length < 1 || value.length > 160) return NO;
  NSCharacterSet *allowed = [NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"];
  return [value rangeOfCharacterFromSet:allowed.invertedSet].location == NSNotFound;
}
// A file name from the server is used as a path component, so it is reduced to its last
// component and stripped of anything that could leave the download's own folder.
static NSString *PorticoSafeFileName(NSString *value) {
  NSString *name = [value isKindOfClass:NSString.class] ? value.lastPathComponent : @"";
  name = [[name componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/\\:\0"]] componentsJoinedByString:@"_"];
  if (name.length == 0 || [name hasPrefix:@"."] || name.length > 200) return @"media";
  return name;
}

- (void)loadManifest {
  _entries = [NSMutableDictionary new];
  // A crash between receiving a finished file and filing it leaves an ".incoming" file behind.
  for (NSURL *file in [[NSFileManager defaultManager] contentsOfDirectoryAtURL:[self root] includingPropertiesForKeys:nil options:0 error:nil])
    if ([file.pathExtension isEqualToString:@"incoming"]) [[NSFileManager defaultManager] removeItemAtURL:file error:nil];
  NSData *raw = [NSData dataWithContentsOfURL:[self manifestURL]];
  NSDictionary *stored = raw ? [NSJSONSerialization JSONObjectWithData:raw options:0 error:nil] : nil;
  if (![stored isKindOfClass:NSDictionary.class]) return;
  for (NSString *key in stored) {
    NSDictionary *entry = stored[key];
    if (PorticoSafeIdentifier(key) && [entry isKindOfClass:NSDictionary.class]) _entries[key] = [entry mutableCopy];
  }
}
- (BOOL)saveManifest {
  NSData *raw = [NSJSONSerialization dataWithJSONObject:_entries options:0 error:nil];
  // SEC-22: the manifest names titles and, while a transfer runs, its grant address; it is only
  // readable once the device has been unlocked after boot (background sessions still work).
  return raw && [raw writeToURL:[self manifestURL] options:NSDataWritingAtomic | NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication error:nil];
}
- (void)changed:(NSString *)identifier force:(BOOL)force {
  // Progress arrives many times a second; the interface needs it about twice a second.
  NSTimeInterval now = NSDate.date.timeIntervalSince1970;
  if (!force && now - _lastEmit[identifier].doubleValue < 0.5) return;
  _lastEmit[identifier] = @(now);
  NSDictionary *entry = _entries[identifier];
  if (_observing) [self sendEventWithName:PorticoDownloadChanged body:entry ? [entry copy] : @{@"id": identifier, @"state": @"removed"}];
}

#pragma mark - Session

- (NSURLSession *)session {
  if (_session) return _session;
  NSURLSessionConfiguration *configuration = [NSURLSessionConfiguration backgroundSessionConfigurationWithIdentifier:PorticoDownloadsSession];
  configuration.sessionSendsLaunchEvents = YES;
  configuration.discretionary = NO;
  // A background session's configuration is fixed once it is created, so baking
  // the current preference in here meant a later change did nothing until the
  // next launch. The session is therefore permissive and every request tightens
  // itself to the live policy — a request can restrict what the session allows,
  // it just cannot widen it. See -requestFor:.
  configuration.allowsCellularAccess = YES;
  configuration.allowsExpensiveNetworkAccess = YES;
  configuration.HTTPMaximumConnectionsPerHost = 2;
  _session = [NSURLSession sessionWithConfiguration:configuration delegate:self delegateQueue:nil];
  return _session;
}

/// A request carrying the network policy in force right now.
- (NSURLRequest *)requestFor:(NSURL *)url {
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  request.allowsCellularAccess = _cellular;
  request.allowsExpensiveNetworkAccess = _cellular;
  return request;
}

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)task didWriteData:(int64_t)written totalBytesWritten:(int64_t)total totalBytesExpectedToWrite:(int64_t)expected {
  NSString *identifier = task.taskDescription;
  dispatch_async(_queue, ^{
    NSMutableDictionary *entry = self->_entries[identifier];
    if (!PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) return;
    entry[@"bytesDone"] = @(total);
    if (expected > 0) entry[@"bytes"] = @(expected);
    entry[@"state"] = @"downloading";
    [self changed:identifier force:NO];
  });
}

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)task didFinishDownloadingToURL:(NSURL *)location {
  NSString *identifier = task.taskDescription;
  NSInteger status = [task.response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)task.response).statusCode : 0;
  // The temporary file is only valid during this call: move it before returning.
  NSURL *holding = [[self root] URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.incoming", NSUUID.UUID.UUIDString]];
  BOOL moved = [[NSFileManager defaultManager] moveItemAtURL:location toURL:holding error:nil];
  dispatch_async(_queue, ^{
    NSMutableDictionary *entry = self->_entries[identifier];
    if (!PorticoDownloadAcceptsTask(entry, task.taskIdentifier) || !moved) { [[NSFileManager defaultManager] removeItemAtURL:holding error:nil]; return; }
    if (status < 200 || status > 299) {
      [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
      entry[@"state"] = @"failed";
      entry[@"error"] = (status == 401 || status == 403 || status == 404 || status == 410) ? @"grant_expired" : @"server_refused";
      [self saveManifest]; [self changed:identifier force:YES];
      return;
    }
    [self->_activeTasks removeObjectForKey:identifier];
    NSString *expected = [entry[@"sha256"] isKindOfClass:NSString.class] ? entry[@"sha256"] : @"";
    NSString *actual = expected.length ? [self digestOf:holding] : @"";
    if (expected.length && ![actual isEqualToString:expected.lowercaseString]) {
      [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
      entry[@"state"] = @"failed"; entry[@"error"] = @"verification_failed";
      [self saveManifest]; [self changed:identifier force:YES];
      return;
    }
    NSURL *directory = [self directoryFor:identifier];
    [[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil];
    NSURL *final = [directory URLByAppendingPathComponent:PorticoSafeFileName(entry[@"fileName"])];
    [[NSFileManager defaultManager] removeItemAtURL:final error:nil];
    if (![[NSFileManager defaultManager] moveItemAtURL:holding toURL:final error:nil]) {
      [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
      entry[@"state"] = @"failed"; entry[@"error"] = @"storage_full";
      [self saveManifest]; [self changed:identifier force:YES];
      return;
    }
    [final setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:[self resumeURLFor:identifier] error:nil];
    NSNumber *size = [[NSFileManager defaultManager] attributesOfItemAtPath:final.path error:nil][NSFileSize];
    entry[@"state"] = @"ready"; entry[@"error"] = @""; entry[@"bytes"] = size ?: @0; entry[@"bytesDone"] = size ?: @0;
    entry[@"file"] = final.lastPathComponent; entry[@"completedAt"] = @((long long)(NSDate.date.timeIntervalSince1970 * 1000));
    // SEC-22: the grant address has done its job; a finished download keeps no token.
    [entry removeObjectForKey:@"grantUrl"];
    [self saveManifest]; [self changed:identifier force:YES];
    // No notifications (Justin's rule): completion shows in the app (Downloads state and a toast).
  });
}

/** All events for a background relaunch have been delivered: let iOS suspend the app again. */
- (void)URLSessionDidFinishEventsForBackgroundURLSession:(NSURLSession *)session {
  NSString *identifier = session.configuration.identifier ?: @"";
  dispatch_async(_queue, ^{
    // Manifest writes queued by the delegate calls above finish first (same serial queue).
    Class events = NSClassFromString(@"PorticoBackgroundEvents");
    SEL finish = NSSelectorFromString(@"finish:");
    if ([events respondsToSelector:finish]) { ((void (*)(id, SEL, NSString *))[events methodForSelector:finish])(events, finish, identifier); }
  });
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  if (!error) return;
  NSString *identifier = task.taskDescription;
  NSData *resume = error.userInfo[NSURLSessionDownloadTaskResumeData];
  dispatch_async(_queue, ^{
    NSMutableDictionary *entry = self->_entries[identifier];
    if (!PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) return;
    [self->_activeTasks removeObjectForKey:identifier];
    if (resume.length) {
      [[NSFileManager defaultManager] createDirectoryAtURL:[self directoryFor:identifier] withIntermediateDirectories:YES attributes:nil error:nil];
      [resume writeToURL:[self resumeURLFor:identifier] options:NSDataWritingAtomic error:nil];
    }
    BOOL cancelled = error.code == NSURLErrorCancelled;
    entry[@"state"] = cancelled ? @"paused" : @"failed";
    entry[@"error"] = cancelled ? @"" : (error.code == NSURLErrorNotConnectedToInternet || error.code == NSURLErrorNetworkConnectionLost || error.code == NSURLErrorTimedOut ? @"network" : @"transfer_failed");
    [self saveManifest]; [self changed:identifier force:YES];
  });
}

- (NSString *)digestOf:(NSURL *)file {
  NSInputStream *stream = [NSInputStream inputStreamWithURL:file];
  [stream open];
  CC_SHA256_CTX context; CC_SHA256_Init(&context);
  uint8_t *buffer = malloc(1 << 20);
  NSInteger read;
  while ((read = [stream read:buffer maxLength:1 << 20]) > 0) CC_SHA256_Update(&context, buffer, (CC_LONG)read);
  free(buffer); [stream close];
  if (read < 0) return @"";
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256_Final(digest, &context);
  NSMutableString *hex = [NSMutableString stringWithCapacity:64];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", digest[i]];
  return hex;
}

#pragma mark - JavaScript interface

RCT_EXPORT_METHOD(list:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{ resolve(self->_entries.allValues); });
}

RCT_EXPORT_METHOD(start:(NSDictionary *)request resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  NSString *identifier = request[@"id"];
  NSURL *url = [request[@"url"] isKindOfClass:NSString.class] ? [NSURL URLWithString:request[@"url"]] : nil;
  if (!PorticoSafeIdentifier(identifier) || !url || !([url.scheme isEqual:@"https"] || [url.scheme isEqual:@"http"])) { reject(@"invalid_download", @"The download request is invalid.", nil); return; }
  // Continue and retry both arrive here, so an earlier task for the same
  // download is ended first: two tasks writing one file is worse than starting
  // again. Cancelling without resume data is deliberate — the blob below is the
  // one that matters, and it is only kept when its grant is still the current one.
  [self taskFor:identifier then:^(NSURLSessionDownloadTask *existing) {
    [existing cancel];
    [self beginTransfer:request identifier:identifier url:url resolve:resolve];
  }];
}

- (void)beginTransfer:(NSDictionary *)request identifier:(NSString *)identifier url:(NSURL *)url resolve:(RCTPromiseResolveBlock)resolve {
  dispatch_async(_queue, ^{
    NSMutableDictionary *entry = self->_entries[identifier] ?: [NSMutableDictionary new];
    if ([entry[@"state"] isEqual:@"ready"]) { resolve([entry copy]); return; }
    for (NSString *key in @[@"itemId", @"title", @"subtitle", @"quality", @"fileName", @"sha256", @"contentType", @"artworkUrl", @"meta"]) if ([request[key] isKindOfClass:NSString.class]) entry[key] = request[key];
    entry[@"id"] = identifier;
    entry[@"bytes"] = [request[@"bytes"] isKindOfClass:NSNumber.class] ? request[@"bytes"] : @0;
    entry[@"bytesDone"] = @0; entry[@"state"] = @"downloading"; entry[@"error"] = @"";
    if (!entry[@"addedAt"]) entry[@"addedAt"] = @((long long)(NSDate.date.timeIntervalSince1970 * 1000));
    self->_entries[identifier] = entry;
    // Resume data carries the request it was created from, including its URL —
    // and a download URL carries a single-use grant token. Continuing after a
    // fresh grant was issued therefore replayed the *old* token, which the
    // server rejects once it has expired, and no argument can substitute the new
    // URL into an opaque resume blob. So the blob is only used when it belongs
    // to this exact grant; otherwise it is discarded and the transfer restarts
    // under the authorization that was just obtained.
    NSURL *resumeURL = [self resumeURLFor:identifier];
    NSData *resume = [NSData dataWithContentsOfURL:resumeURL];
    NSString *address = url.absoluteString;
    BOOL sameGrant = resume.length > 0 && [entry[@"grantUrl"] isKindOfClass:NSString.class] && [entry[@"grantUrl"] isEqual:address];
    if (resume.length > 0 && !sameGrant) {
      [[NSFileManager defaultManager] removeItemAtURL:resumeURL error:nil];
      resume = nil;
    }
    entry[@"grantUrl"] = address;
    NSURLSessionDownloadTask *task = resume.length ? [[self session] downloadTaskWithResumeData:resume]
                                                   : [[self session] downloadTaskWithRequest:[self requestFor:url]];
    // Serial publication fences every callback from the previous attempt,
    // including a late cancellation that carries the previous grant’s resume data.
    [self->_activeTasks[identifier] cancel];
    entry[@"taskIdentifier"] = @(task.taskIdentifier);
    self->_activeTasks[identifier] = task;
    task.taskDescription = identifier;
    if ([request[@"bytes"] isKindOfClass:NSNumber.class]) task.countOfBytesClientExpectsToReceive = [request[@"bytes"] longLongValue];
    [task resume];
    [self saveManifest]; [self changed:identifier force:YES];
    resolve([entry copy]);
  });
}

- (void)taskFor:(NSString *)identifier then:(void (^)(NSURLSessionDownloadTask *))work {
  [[self session] getTasksWithCompletionHandler:^(NSArray *data, NSArray *uploads, NSArray<NSURLSessionDownloadTask *> *downloads) {
    dispatch_async(self->_queue, ^{
      NSDictionary *entry = self->_entries[identifier];
      for (NSURLSessionDownloadTask *task in downloads) {
        if ([task.taskDescription isEqual:identifier] && PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) { work(task); return; }
      }
      work(nil);
    });
  }];
}

RCT_EXPORT_METHOD(pause:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  [self taskFor:identifier then:^(NSURLSessionDownloadTask *task) {
    // The resume data arrives through didCompleteWithError, which records the paused state.
    if (task) [task cancelByProducingResumeData:^(NSData *data) {}];
    resolve(nil);
  }];
}

RCT_EXPORT_METHOD(remove:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  if (!PorticoSafeIdentifier(identifier)) { reject(@"invalid_download", @"The download is invalid.", nil); return; }
  [self taskFor:identifier then:^(NSURLSessionDownloadTask *task) {
    [task cancel];
    dispatch_async(self->_queue, ^{
      [self->_activeTasks[identifier] cancel];
      [self->_activeTasks removeObjectForKey:identifier];
      [self->_entries removeObjectForKey:identifier];
      [[NSFileManager defaultManager] removeItemAtURL:[self directoryFor:identifier] error:nil];
      [self saveManifest]; [self changed:identifier force:YES];
      resolve(nil);
    });
  }];
}

RCT_EXPORT_METHOD(setMeta:(NSString *)identifier meta:(NSString *)meta resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    // The caller's bookkeeping (a receipt, its owner) is only acknowledged once it is on disk.
    NSMutableDictionary *entry = self->_entries[identifier];
    if (!entry) { reject(@"not_found", @"This download no longer exists.", nil); return; }
    if (meta.length >= 65536) { reject(@"too_large", @"This download's details are too large to keep.", nil); return; }
    id previous = entry[@"meta"];
    entry[@"meta"] = meta;
    if (![self saveManifest]) {
      if (previous) entry[@"meta"] = previous; else [entry removeObjectForKey:@"meta"];
      reject(@"write_failed", @"This download's details could not be saved.", nil); return;
    }
    [self changed:identifier force:YES];
    resolve(nil);
  });
}

RCT_EXPORT_METHOD(storage:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    NSDictionary *values = [[self root] resourceValuesForKeys:@[NSURLVolumeAvailableCapacityForImportantUsageKey] error:nil];
    long long used = 0;
    for (NSDictionary *entry in self->_entries.allValues) if ([entry[@"state"] isEqual:@"ready"]) used += [entry[@"bytes"] longLongValue];
    resolve(@{@"freeBytes": values[NSURLVolumeAvailableCapacityForImportantUsageKey] ?: @0, @"usedBytes": @(used)});
  });
}

RCT_EXPORT_METHOD(setCellular:(BOOL)allowed resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  [[NSUserDefaults standardUserDefaults] setBool:allowed forKey:@"PorticoDownloadsCellular"];
  BOOL tightened = self->_cellular && !allowed;
  _cellular = allowed;
  // Every transfer started from here on carries the new policy. A transfer
  // already running was created under the old one, and "Never use mobile data"
  // has to mean now rather than next launch — so turning Wi-Fi-only on suspends
  // what is in flight, keeping its bytes. Continue restarts it under the new
  // policy, and on Wi-Fi the system starts it again without waiting.
  if (!tightened) { resolve(nil); return; }
  [[self session] getTasksWithCompletionHandler:^(NSArray *data, NSArray *uploads, NSArray<NSURLSessionDownloadTask *> *downloads) {
    for (NSURLSessionDownloadTask *task in downloads) {
      NSString *identifier = task.taskDescription;
      if (!PorticoSafeIdentifier(identifier)) continue;
      [task cancelByProducingResumeData:^(NSData *bytes) {
        dispatch_async(self->_queue, ^{
          NSMutableDictionary *entry = self->_entries[identifier];
          if (!PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) return;
          if (bytes.length) [bytes writeToURL:[self resumeURLFor:identifier] options:NSDataWritingAtomic error:nil];
          entry[@"state"] = @"paused";
          [self saveManifest];
          [self changed:identifier force:YES];
        });
      }];
    }
    resolve(nil);
  }];
}

// One small JSON document for the JavaScript side's own bookkeeping (settings and the queue of
// viewing progress made while offline). Kept beside the files so removing the app's data
// removes both.
RCT_EXPORT_METHOD(readState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    NSData *raw = [NSData dataWithContentsOfURL:[self stateURL]];
    resolve(raw ? [[NSString alloc] initWithData:raw encoding:NSUTF8StringEncoding] : @"");
  });
}
RCT_EXPORT_METHOD(writeState:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    if (json.length >= 1048576) { reject(@"too_large", @"Download settings are too large to keep.", nil); return; }
    NSError *error = nil;
    if (![[json dataUsingEncoding:NSUTF8StringEncoding] writeToURL:[self stateURL] options:NSDataWritingAtomic | NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication error:&error]) {
      reject(@"write_failed", @"Download settings could not be saved.", error); return;
    }
    resolve(nil);
  });
}

#pragma mark - Offline playback

// OS-07: the file of a finished download, for Portico's own player (PorticoPlaybackController
// accepts a file source only inside this module's root).
RCT_EXPORT_METHOD(localFile:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    NSDictionary *entry = self->_entries[identifier];
    NSString *file = entry[@"file"];
    if (![entry[@"state"] isEqual:@"ready"] || ![file isKindOfClass:NSString.class]) { reject(@"not_ready", @"This download is not ready to play.", nil); return; }
    NSURL *url = [[self directoryFor:identifier] URLByAppendingPathComponent:PorticoSafeFileName(file)];
    if (![[NSFileManager defaultManager] fileExistsAtPath:url.path]) { reject(@"missing_file", @"This download’s file is missing. Remove it and download it again.", nil); return; }
    // The player's timeline needs the length before the first frame, so read it from the file.
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
    [asset loadValuesAsynchronouslyForKeys:@[@"duration"] completionHandler:^{
      double seconds = [asset statusOfValueForKey:@"duration" error:nil] == AVKeyValueStatusLoaded ? CMTimeGetSeconds(asset.duration) : 0;
      resolve(@{@"url": url.absoluteString, @"durationSeconds": @(isfinite(seconds) && seconds > 0 ? seconds : 0)});
    }];
  });
}
// Plays a finished download with the system player (the launch flow's offline Downloads, where
// Portico's player isn't mounted). No server is involved, so there is no session to keep alive;
// the position is reported back so it can be sent to the server later.
RCT_EXPORT_METHOD(play:(NSString *)identifier startSeconds:(double)startSeconds resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    NSDictionary *entry = self->_entries[identifier];
    NSString *file = entry[@"file"];
    if (![entry[@"state"] isEqual:@"ready"] || ![file isKindOfClass:NSString.class]) { reject(@"not_ready", @"This download is not ready to play.", nil); return; }
    NSURL *url = [[self directoryFor:identifier] URLByAppendingPathComponent:PorticoSafeFileName(file)];
    if (![[NSFileManager defaultManager] fileExistsAtPath:url.path]) { reject(@"missing_file", @"This download’s file is missing. Remove it and download it again.", nil); return; }
    dispatch_async(dispatch_get_main_queue(), ^{
      [self stopPlayback];
      AVPlayer *player = [AVPlayer playerWithURL:url];
      AVPlayerViewController *controller = [AVPlayerViewController new];
      controller.player = player;
      controller.allowsPictureInPicturePlayback = YES;
      self->_player = player; self->_playingId = identifier;
      __weak PorticoDownloads *weakSelf = self;
      self->_timeObserver = [player addPeriodicTimeObserverForInterval:CMTimeMake(5, 1) queue:dispatch_get_main_queue() usingBlock:^(CMTime time) { [weakSelf reportPlayback:NO]; }];
      [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(playbackEnded) name:AVPlayerItemDidPlayToEndTimeNotification object:player.currentItem];
      if (startSeconds > 1) [player seekToTime:CMTimeMakeWithSeconds(startSeconds, 600) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero];
      UIViewController *presenter = RCTPresentedViewController();
      if (!presenter) { [self stopPlayback]; reject(@"no_window", @"The player could not be shown.", nil); return; }
      PorticoOfflinePlayerHost *host = [PorticoOfflinePlayerHost new];
      host.modalPresentationStyle = UIModalPresentationFullScreen;
      host.view.backgroundColor = UIColor.blackColor;
      [host addChildViewController:controller];
      controller.view.frame = host.view.bounds;
      controller.view.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      [host.view addSubview:controller.view];
      [controller didMoveToParentViewController:host];
      host.onClosed = ^{ [weakSelf stopPlayback]; };
      [presenter presentViewController:host animated:YES completion:^{ [player play]; resolve(nil); }];
    });
  });
}
- (void)reportPlayback:(BOOL)ended {
  if (!_player || !_playingId || !_observing) return;
  double position = CMTimeGetSeconds(_player.currentTime), duration = CMTimeGetSeconds(_player.currentItem.duration);
  if (!isfinite(position)) return;
  [self sendEventWithName:PorticoDownloadPlayback body:@{@"id": _playingId, @"positionSeconds": @(position), @"durationSeconds": @(isfinite(duration) ? duration : 0), @"ended": @(ended)}];
}
- (void)playbackEnded { [self reportPlayback:YES]; }
- (void)stopPlayback {
  if (_player) {
    [self reportPlayback:NO];
    if (_timeObserver) [_player removeTimeObserver:_timeObserver];
    [[NSNotificationCenter defaultCenter] removeObserver:self name:AVPlayerItemDidPlayToEndTimeNotification object:_player.currentItem];
    [_player pause];
  }
  _player = nil; _timeObserver = nil; _playingId = nil;
}
RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{ [self stopPlayback]; resolve(nil); });
}

@end
