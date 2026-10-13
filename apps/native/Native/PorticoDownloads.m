#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTUtils.h>
#import <AVKit/AVKit.h>
#import <CommonCrypto/CommonDigest.h>
#import "PorticoDownloadAttempt.h"

// Offline downloads for iPhone and iPad.
//
// The server prepares a file and hands out an address for it; this module moves the bytes and
// keeps them. Transfers run in a background URLSession, so they continue while the app is
// suspended and are picked up again when it next launches. A finished file is checked against
// the server's SHA-256 before it is called ready: a truncated or substituted file is deleted,
// never played. Files live in Application Support, excluded from iCloud backup (they are
// re-downloadable and can be tens of gigabytes).
//
// Continuing a transfer is the system's work here: a background download task that loses its
// connection, waits for Wi-Fi or is suspended asks for the same address again with a byte range
// by itself, and a task that is cancelled leaves resume data that a new task continues from.
// Both need the address to still be good, which is why the app keeps one address per download
// alive (the server extends it on request) instead of taking a new one for every attempt. The
// resume data is used whenever the download is still of the same file at the same address. When
// the address had to change, the system cannot be re-pointed at the new one and the transfer
// begins again; that is the one case in which bytes already fetched are fetched twice.
//
// Each entry says what it is doing in three fields. `state` is `downloading`, `paused`, `failed`
// or `ready`. `waiting` says why a download that should be moving is not: `wifi` or `network`.
// `intent` is `hold` once the person has paused it, and `run` otherwise: an entry that is paused
// or failed with `run` stopped by itself and is started again by the app when it can be.
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
- (dispatch_queue_t)methodQueue { return _queue; }
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
    [self reconcile];
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
// A finished transfer waits here while it is verified. It is inside the download's own folder,
// so a launch that finds one knows whose it is and finishes the job. Each attempt has its own
// name, so a late completion of an attempt that was replaced can never land on top of the file
// the current attempt is verifying.
- (NSURL *)incomingURLFor:(NSString *)identifier task:(NSUInteger)task {
  return [[self directoryFor:identifier] URLByAppendingPathComponent:[NSString stringWithFormat:@"incoming-%lu.part", (unsigned long)task]];
}
- (NSArray<NSURL *> *)incomingFilesFor:(NSString *)identifier {
  NSMutableArray<NSURL *> *found = [NSMutableArray new];
  for (NSURL *file in [[NSFileManager defaultManager] contentsOfDirectoryAtURL:[self directoryFor:identifier] includingPropertiesForKeys:nil options:0 error:nil])
    if ([file.lastPathComponent hasPrefix:@"incoming-"] && [file.pathExtension isEqualToString:@"part"]) [found addObject:file];
  return found;
}
- (NSURL *)extrasFor:(NSString *)identifier { return [[self directoryFor:identifier] URLByAppendingPathComponent:@"extras" isDirectory:YES]; }

// The most one extra (a poster, a subtitle track, the description) may weigh.
static const long long PorticoMaxExtraBytes = 32LL * 1024 * 1024;
// A name for a file kept beside a download: plain characters and at most one short extension.
static BOOL PorticoSafeExtraName(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length < 1 || value.length > 106) return NO;
  static NSRegularExpression *pattern; static dispatch_once_t once;
  dispatch_once(&once, ^{ pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,96}(\\.[a-z0-9]{1,8})?$" options:0 error:nil]; });
  return [pattern numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)] == 1;
}

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
  // An extra that was being filed when the app stopped leaves its holding file behind.
  for (NSURL *file in [[NSFileManager defaultManager] contentsOfDirectoryAtURL:[self root] includingPropertiesForKeys:nil options:0 error:nil])
    if ([file.pathExtension isEqualToString:@"extra"]) [[NSFileManager defaultManager] removeItemAtURL:file error:nil];
  NSData *raw = [NSData dataWithContentsOfURL:[self manifestURL]];
  NSDictionary *stored = raw ? [NSJSONSerialization JSONObjectWithData:raw options:0 error:nil] : nil;
  if (![stored isKindOfClass:NSDictionary.class]) return;
  for (NSString *key in stored) {
    NSDictionary *entry = stored[key];
    if (PorticoSafeIdentifier(key) && [entry isKindOfClass:NSDictionary.class]) _entries[key] = [entry mutableCopy];
  }
}

// What the last run left unfinished is settled once at launch.
//
// A transfer that had fully arrived and was being verified when the app was stopped still has its
// bytes in the download's folder: it is verified now, instead of being thrown away and fetched
// again. An entry that says it is downloading and has no task behind it (the task was lost with
// the app) becomes paused, still meant to run, so the app starts it again; left as it was it
// would show a progress bar that never moves and offer only Pause.
//
// It waits a few seconds first. When the system relaunches the app because a transfer finished
// while it was away, that transfer's completion is delivered just after the session is created;
// looking sooner would find an entry with no running task and call it paused a moment before its
// finished file arrives.
- (void)reconcile {
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(5 * NSEC_PER_SEC)), _queue, ^{ [self reconcileNow]; });
}
- (void)reconcileNow {
  [[self session] getTasksWithCompletionHandler:^(NSArray *data, NSArray *uploads, NSArray<NSURLSessionDownloadTask *> *downloads) {
    dispatch_async(self->_queue, ^{
      NSMutableSet<NSString *> *live = [NSMutableSet new];
      for (NSURLSessionDownloadTask *task in downloads) {
        NSDictionary *entry = self->_entries[task.taskDescription ?: @""];
        // A task the session still lists, in any state, will report for itself.
        if (PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) [live addObject:task.taskDescription];
      }
      BOOL changed = NO;
      for (NSString *identifier in self->_entries.allKeys) {
        NSMutableDictionary *entry = self->_entries[identifier];
        NSArray<NSURL *> *arrived = [self incomingFilesFor:identifier];
        if ([entry[@"state"] isEqual:@"ready"] || [live containsObject:identifier]) {
          // Nothing is waiting to be verified for a finished download, and a download with a
          // task behind it will deliver its own file.
          if ([entry[@"state"] isEqual:@"ready"]) for (NSURL *file in arrived) [[NSFileManager defaultManager] removeItemAtURL:file error:nil];
          continue;
        }
        if (arrived.count) {
          for (NSUInteger i = 1; i < arrived.count; i++) [[NSFileManager defaultManager] removeItemAtURL:arrived[i] error:nil];
          [self finish:identifier from:arrived[0]];
          continue;
        }
        if ([entry[@"state"] isEqual:@"downloading"] && ![live containsObject:identifier]) {
          entry[@"state"] = @"paused"; entry[@"error"] = @""; entry[@"waiting"] = @"";
          changed = YES;
          [self changed:identifier force:YES];
        }
      }
      if (changed) [self saveManifest];
    });
  }];
}

// An entry as JavaScript sees it: what is stored, plus where its folder is in this launch (the
// app's container moves between installs, so a path is never stored). The address is a
// credential: it is used here and never handed back.
- (NSDictionary *)published:(NSString *)identifier {
  NSMutableDictionary *entry = [self->_entries[identifier] mutableCopy];
  if (!entry) return @{@"id": identifier, @"state": @"removed"};
  entry[@"dir"] = [self directoryFor:identifier].absoluteString;
  [entry removeObjectForKey:@"grantUrl"];
  return entry;
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
  if (_observing) [self sendEventWithName:PorticoDownloadChanged body:[self published:identifier]];
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
  if (!PorticoSafeIdentifier(identifier)) return;
  dispatch_async(_queue, ^{
    NSMutableDictionary *entry = self->_entries[identifier];
    if (!PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) return;
    entry[@"bytesDone"] = @(total);
    if (expected > 0) entry[@"bytes"] = @(expected);
    entry[@"state"] = @"downloading";
    BOOL waited = [entry[@"waiting"] length] > 0;
    entry[@"waiting"] = @"";
    [self changed:identifier force:waited];
  });
}

// The system is holding the task until it has a connection the task may use: no connection at
// all, or mobile data only while "Wi-Fi only" is on. It starts the task by itself when one comes.
- (void)URLSession:(NSURLSession *)session taskIsWaitingForConnectivity:(NSURLSessionTask *)task {
  NSString *identifier = task.taskDescription;
  if (!PorticoSafeIdentifier(identifier)) return;
  dispatch_async(_queue, ^{
    NSMutableDictionary *entry = self->_entries[identifier];
    if (!PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) return;
    entry[@"waiting"] = self->_cellular ? @"network" : @"wifi";
    [self changed:identifier force:YES];
  });
}

- (void)URLSession:(NSURLSession *)session downloadTask:(NSURLSessionDownloadTask *)task didFinishDownloadingToURL:(NSURL *)location {
  NSString *identifier = task.taskDescription;
  if (!PorticoSafeIdentifier(identifier)) return;
  NSInteger status = [task.response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)task.response).statusCode : 0;
  // The temporary file is only valid during this call: move it before returning. It goes into
  // the download's own folder, so if the app is stopped before it has been verified the next
  // launch finds it there and finishes (see -reconcile).
  BOOL known = PorticoSafeIdentifier(identifier);
  NSURL *holding = known ? [self incomingURLFor:identifier task:task.taskIdentifier] : nil;
  BOOL moved = NO;
  if (known && status >= 200 && status <= 299) {
    [[NSFileManager defaultManager] createDirectoryAtURL:[self directoryFor:identifier] withIntermediateDirectories:YES attributes:nil error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
    moved = [[NSFileManager defaultManager] moveItemAtURL:location toURL:holding error:nil];
  }
  dispatch_async(_queue, ^{
    NSMutableDictionary *entry = self->_entries[identifier];
    // An attempt that was replaced, or a download that was removed, has nothing to file.
    if (!PorticoDownloadAcceptsTask(entry, task.taskIdentifier)) {
      if (moved) [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
      if (moved && !entry) [[NSFileManager defaultManager] removeItemAtURL:[self directoryFor:identifier] error:nil];
      return;
    }
    [self->_activeTasks removeObjectForKey:identifier];
    if (status < 200 || status > 299) {
      // The address has run out, or the server will not hand this over just now. The app renews
      // the address and starts the transfer again; nothing here is the person's to fix.
      entry[@"state"] = @"failed"; entry[@"waiting"] = @"";
      entry[@"error"] = (status == 401 || status == 403 || status == 404 || status == 409 || status == 410) ? @"grant_expired" : (status == 429 || status == 503) ? @"network" : @"server_refused";
      [self saveManifest]; [self changed:identifier force:YES];
      return;
    }
    if (!moved) {
      entry[@"state"] = @"failed"; entry[@"error"] = @"storage_full"; entry[@"waiting"] = @"";
      [self saveManifest]; [self changed:identifier force:YES];
      return;
    }
    [self finish:identifier from:holding];
  });
}

// Verifies the bytes waiting in a download's folder and files them. On the downloads queue.
- (void)finish:(NSString *)identifier from:(NSURL *)holding {
  NSMutableDictionary *entry = self->_entries[identifier];
  if (!entry || [entry[@"state"] isEqual:@"ready"]) { [[NSFileManager defaultManager] removeItemAtURL:holding error:nil]; return; }
  NSString *expected = [entry[@"sha256"] isKindOfClass:NSString.class] ? entry[@"sha256"] : @"";
  NSString *actual = expected.length ? [self digestOf:holding] : @"";
  if (expected.length && ![actual isEqualToString:expected.lowercaseString]) {
    [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
    [[NSFileManager defaultManager] removeItemAtURL:[self resumeURLFor:identifier] error:nil];
    entry[@"state"] = @"failed"; entry[@"error"] = @"verification_failed"; entry[@"waiting"] = @"";
    [self saveManifest]; [self changed:identifier force:YES];
    return;
  }
  NSURL *final = [[self directoryFor:identifier] URLByAppendingPathComponent:PorticoSafeFileName(entry[@"fileName"])];
  [[NSFileManager defaultManager] removeItemAtURL:final error:nil];
  if (![[NSFileManager defaultManager] moveItemAtURL:holding toURL:final error:nil]) {
    [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
    entry[@"state"] = @"failed"; entry[@"error"] = @"storage_full"; entry[@"waiting"] = @"";
    [self saveManifest]; [self changed:identifier force:YES];
    return;
  }
  [final setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
  [[NSFileManager defaultManager] removeItemAtURL:[self resumeURLFor:identifier] error:nil];
  NSNumber *size = [[NSFileManager defaultManager] attributesOfItemAtPath:final.path error:nil][NSFileSize];
  entry[@"state"] = @"ready"; entry[@"error"] = @""; entry[@"waiting"] = @""; entry[@"bytes"] = size ?: @0; entry[@"bytesDone"] = size ?: @0;
  entry[@"file"] = final.lastPathComponent; entry[@"completedAt"] = @((long long)(NSDate.date.timeIntervalSince1970 * 1000));
  // SEC-22: the address has done its job; a finished download keeps no token.
  [entry removeObjectForKey:@"grantUrl"];
  [self saveManifest]; [self changed:identifier force:YES];
  // No notifications (Justin's rule): completion shows in the app (Downloads state and a toast).
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
  if (!PorticoSafeIdentifier(identifier)) return;
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
    entry[@"waiting"] = @"";
    // Anything the network did is the network's to mend: the app starts the transfer again and
    // the resume data just kept carries it on from the bytes already here.
    BOOL network = [error.domain isEqual:NSURLErrorDomain] && error.code != NSURLErrorCannotWriteToFile && error.code != NSURLErrorCannotCreateFile;
    entry[@"error"] = cancelled ? @"" : (network ? @"network" : @"transfer_failed");
    [self saveManifest]; [self changed:identifier force:YES];
  });
}

- (NSString *)digestOf:(NSURL *)file {
  NSInputStream *stream = [NSInputStream inputStreamWithURL:file];
  [stream open];
  CC_SHA256_CTX context; CC_SHA256_Init(&context);
  uint8_t *buffer = malloc(1 << 20);
  if (!buffer) { [stream close]; return @""; }
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
  dispatch_async(_queue, ^{
    NSMutableArray *all = [NSMutableArray new];
    for (NSString *identifier in self->_entries) [all addObject:[self published:identifier]];
    resolve(all);
  });
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
    if ([entry[@"state"] isEqual:@"ready"]) { self->_entries[identifier] = entry; resolve([self published:identifier]); return; }
    // The bytes already fetched belong to one exact file.
    NSString *wanted = [request[@"sha256"] isKindOfClass:NSString.class] ? [request[@"sha256"] lowercaseString] : @"";
    BOOL sameFile = wanted.length > 0 && [entry[@"sha256"] isKindOfClass:NSString.class] && [[entry[@"sha256"] lowercaseString] isEqual:wanted];
    for (NSString *key in @[@"itemId", @"title", @"subtitle", @"quality", @"fileName", @"sha256", @"contentType", @"meta"]) if ([request[key] isKindOfClass:NSString.class]) entry[key] = request[key];
    entry[@"id"] = identifier;
    entry[@"bytes"] = [request[@"bytes"] isKindOfClass:NSNumber.class] ? request[@"bytes"] : @0;
    entry[@"state"] = @"downloading"; entry[@"error"] = @""; entry[@"waiting"] = @""; entry[@"intent"] = @"run";
    if (!entry[@"addedAt"]) entry[@"addedAt"] = @((long long)(NSDate.date.timeIntervalSince1970 * 1000));
    self->_entries[identifier] = entry;
    // Resume data carries the request it was created from, address included, and nothing can
    // put a different address into it. The app keeps the same address alive across attempts, so
    // this is the ordinary case: same file, same address, carry on from the bytes already here.
    // A different address, or a different file, means the system's partial cannot be continued
    // and the transfer begins again.
    NSURL *resumeURL = [self resumeURLFor:identifier];
    NSData *resume = [NSData dataWithContentsOfURL:resumeURL];
    NSString *address = url.absoluteString;
    // Resume data contains its original request's cellular policy too. It cannot be tightened
    // by requestFor:, so only reuse data created under the current preference.
    BOOL samePolicy = [entry[@"cellularAllowed"] isKindOfClass:NSNumber.class] && [entry[@"cellularAllowed"] boolValue] == self->_cellular;
    BOOL sameGrant = sameFile && samePolicy && resume.length > 0 && [entry[@"grantUrl"] isKindOfClass:NSString.class] && [entry[@"grantUrl"] isEqual:address];
    if (resume.length > 0 && !sameGrant) {
      [[NSFileManager defaultManager] removeItemAtURL:resumeURL error:nil];
      resume = nil;
    }
    if (!resume.length) entry[@"bytesDone"] = @0;
    entry[@"grantUrl"] = address;
    entry[@"cellularAllowed"] = @(self->_cellular);
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
    resolve([self published:identifier]);
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
    // The person paused it: it stays paused until they continue it, with or without a task
    // behind it right now.
    NSMutableDictionary *entry = self->_entries[identifier];
    if (entry && ![entry[@"state"] isEqual:@"ready"]) {
      entry[@"intent"] = @"hold";
      if (!task && ![entry[@"state"] isEqual:@"failed"]) { entry[@"state"] = @"paused"; entry[@"waiting"] = @""; }
      [self saveManifest]; [self changed:identifier force:YES];
    }
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

// Several entries' details in one write of the manifest (a day's receipt renewals).
RCT_EXPORT_METHOD(setMetas:(NSDictionary *)metas resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    // Validate the whole batch before changing any entry. A later invalid value must not
    // leave earlier receipts changed in memory and saved by an unrelated progress update.
    for (NSString *identifier in metas) {
      if (!self->_entries[identifier]) continue;
      NSString *meta = metas[identifier];
      if (![meta isKindOfClass:NSString.class] || meta.length >= 65536) { reject(@"too_large", @"This download's details are too large to keep.", nil); return; }
    }
    NSMutableDictionary *previous = [NSMutableDictionary new];
    for (NSString *identifier in metas) {
      NSMutableDictionary *entry = self->_entries[identifier];
      if (!entry) continue;
      previous[identifier] = entry[@"meta"] ?: NSNull.null;
      entry[@"meta"] = metas[identifier];
    }
    if (![self saveManifest]) {
      for (NSString *identifier in previous) {
        if (previous[identifier] == NSNull.null) [self->_entries[identifier] removeObjectForKey:@"meta"]; else self->_entries[identifier][@"meta"] = previous[identifier];
      }
      reject(@"write_failed", @"This download's details could not be saved.", nil); return;
    }
    for (NSString *identifier in previous) [self changed:identifier force:YES];
    resolve(nil);
  });
}

#pragma mark - What travels with a download

- (NSURL *)extraURL:(NSString *)identifier name:(NSString *)name {
  if (!PorticoSafeIdentifier(identifier) || !self->_entries[identifier] || !PorticoSafeExtraName(name)) return nil;
  return [[self extrasFor:identifier] URLByAppendingPathComponent:name];
}

// One small text file kept beside the download (its description, chapters and markers).
RCT_EXPORT_METHOD(writeExtra:(NSString *)identifier name:(NSString *)name text:(NSString *)text resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    NSURL *file = [self extraURL:identifier name:name];
    NSData *data = [text isKindOfClass:NSString.class] ? [text dataUsingEncoding:NSUTF8StringEncoding] : nil;
    if (!file || !data || data.length > PorticoMaxExtraBytes) { reject(@"write_failed", @"This download's details could not be saved.", nil); return; }
    [[NSFileManager defaultManager] createDirectoryAtURL:[self extrasFor:identifier] withIntermediateDirectories:YES attributes:nil error:nil];
    if (![data writeToURL:file options:NSDataWritingAtomic | NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication error:nil]) { reject(@"write_failed", @"This download's details could not be saved.", nil); return; }
    resolve(nil);
  });
}
RCT_EXPORT_METHOD(readExtra:(NSString *)identifier name:(NSString *)name resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    NSURL *file = [self extraURL:identifier name:name];
    NSNumber *size = file ? [[NSFileManager defaultManager] attributesOfItemAtPath:file.path error:nil][NSFileSize] : nil;
    NSData *raw = size && size.longLongValue <= PorticoMaxExtraBytes ? [NSData dataWithContentsOfURL:file] : nil;
    resolve(raw ? ([[NSString alloc] initWithData:raw encoding:NSUTF8StringEncoding] ?: @"") : @"");
  });
}
// Fetches one small file (a poster, a subtitle track) to keep beside the download. Answers
// "saved", "missing" (the server has no such file for this title, which is an ordinary answer),
// "later" (not ready yet, or the connection failed) or "invalid". These are small and fetched
// while the app is in front, so they use an ordinary session, under the same Wi-Fi rule.
RCT_EXPORT_METHOD(fetchExtra:(NSString *)identifier name:(NSString *)name url:(NSString *)address resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(_queue, ^{
    NSURL *file = [self extraURL:identifier name:name];
    NSURL *url = [address isKindOfClass:NSString.class] ? [NSURL URLWithString:address] : nil;
    if (!file || !url || !([url.scheme isEqual:@"https"] || [url.scheme isEqual:@"http"])) { resolve(@"invalid"); return; }
    NSURLSessionDownloadTask *task = [[NSURLSession sharedSession] downloadTaskWithRequest:[self requestFor:url] completionHandler:^(NSURL *location, NSURLResponse *response, NSError *error) {
      NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 0;
      NSNumber *size = location ? [[NSFileManager defaultManager] attributesOfItemAtPath:location.path error:nil][NSFileSize] : nil;
      NSString *outcome = @"later";
      NSURL *holding = nil;
      if (status == 404) outcome = @"missing";
      else if (!error && status >= 200 && status <= 299 && size.longLongValue > PorticoMaxExtraBytes) outcome = @"missing";
      else if (!error && status >= 200 && status <= 299 && size.longLongValue > 0) {
        // The temporary file is only valid during this call.
        holding = [[self root] URLByAppendingPathComponent:[NSString stringWithFormat:@"%@.extra", NSUUID.UUID.UUIDString]];
        if (![[NSFileManager defaultManager] moveItemAtURL:location toURL:holding error:nil]) holding = nil;
      }
      dispatch_async(self->_queue, ^{
        // The download may have been removed while this was in flight: leave nothing behind.
        if (!holding || !self->_entries[identifier]) { if (holding) [[NSFileManager defaultManager] removeItemAtURL:holding error:nil]; resolve(outcome); return; }
        [[NSFileManager defaultManager] createDirectoryAtURL:[self extrasFor:identifier] withIntermediateDirectories:YES attributes:nil error:nil];
        [[NSFileManager defaultManager] removeItemAtURL:file error:nil];
        BOOL kept = [[NSFileManager defaultManager] moveItemAtURL:holding toURL:file error:nil];
        if (!kept) [[NSFileManager defaultManager] removeItemAtURL:holding error:nil];
        resolve(kept ? @"saved" : @"later");
      });
    }];
    [task resume];
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
