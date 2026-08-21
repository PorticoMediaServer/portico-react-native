#import <GoogleCast/GoogleCast.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

static NSString *const PorticoGoogleCastStateChanged = @"PorticoGoogleCastStateChanged";
static NSString *const PorticoGoogleCastNamespace = @"urn:x-cast:tv.getportico.cast";

static NSString *PorticoGoogleCastApplicationID(void) {
  id value = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"PorticoGoogleCastReceiverApplicationID"];
  if (![value isKindOfClass:NSString.class]) return nil;
  NSString *applicationID = [(NSString *)value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (applicationID.length == 0 || [applicationID hasPrefix:@"$("] || [applicationID isEqualToString:@"CC1AD845"] || [applicationID rangeOfCharacterFromSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].location != NSNotFound) return nil;
  return applicationID;
}

static BOOL PorticoGoogleCastConfigured(void) {
  return PorticoGoogleCastApplicationID() != nil;
}

@interface PorticoGoogleCastRequestCompletion : NSObject <GCKRequestDelegate>
@property(nonatomic, copy) void (^success)(void);
@property(nonatomic, copy) void (^failure)(NSError *error);
@end

@interface PorticoGoogleCastChannel : GCKCastChannel
@property(nonatomic, copy) void (^messageHandler)(NSString *message);
@end

@implementation PorticoGoogleCastChannel
- (void)didReceiveTextMessage:(NSString *)message { if (self.messageHandler) self.messageHandler(message); }
@end

@implementation PorticoGoogleCastRequestCompletion
- (void)requestDidComplete:(GCKRequest *)request { if (self.success) self.success(); }
- (void)request:(GCKRequest *)request didFailWithError:(GCKError *)error { if (self.failure) self.failure(error); }
@end

@interface PorticoGoogleCastButtonManager : RCTViewManager
@end

@implementation PorticoGoogleCastButtonManager
RCT_EXPORT_MODULE(PorticoGoogleCastButton)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (UIView *)view {
  if (!PorticoGoogleCastConfigured()) {
    UIView *unconfigured = [[UIView alloc] initWithFrame:CGRectZero];
    unconfigured.hidden = YES;
    return unconfigured;
  }
  GCKUICastButton *button = [[GCKUICastButton alloc] initWithFrame:CGRectZero];
  button.tintColor = [UIColor colorWithRed:0.76 green:0.80 blue:0.84 alpha:1.0];
  [button setAccessibilityLabel:@"Google Cast" forCastState:GCKCastStateNoDevicesAvailable];
  [button setAccessibilityLabel:@"Google Cast" forCastState:GCKCastStateNotConnected];
  [button setAccessibilityLabel:@"Google Cast connecting" forCastState:GCKCastStateConnecting];
  [button setAccessibilityLabel:@"Google Cast connected" forCastState:GCKCastStateConnected];
  button.accessibilityHint = @"Choose or manage a Google Cast playback destination";
  return button;
}
@end

@interface PorticoGoogleCast : RCTEventEmitter <RCTBridgeModule, GCKSessionManagerListener, GCKRemoteMediaClientListener>
@property(nonatomic, assign) BOOL observing;
@property(nonatomic, assign) BOOL recoveringSession;
@property(nonatomic, copy) NSString *activeCastSessionID;
@property(nonatomic, copy) NSString *pendingReadyNonce;
@property(nonatomic, strong) NSMutableSet<PorticoGoogleCastRequestCompletion *> *pendingRequests;
@property(nonatomic, strong) PorticoGoogleCastChannel *channel;
@end

@implementation PorticoGoogleCast
RCT_EXPORT_MODULE(PorticoGoogleCast)
+ (BOOL)requiresMainQueueSetup { return YES; }

- (instancetype)init {
  if ((self = [super init])) {
    _pendingRequests = [NSMutableSet new];
    _channel = [[PorticoGoogleCastChannel alloc] initWithNamespace:PorticoGoogleCastNamespace];
    __weak typeof(self) weakSelf = self;
    _channel.messageHandler = ^(NSString *message) {
      typeof(self) strongSelf = weakSelf;
      if (!strongSelf || !strongSelf.observing) return;
      NSData *data = [message dataUsingEncoding:NSUTF8StringEncoding];
      NSDictionary *payload = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
      if ([payload isKindOfClass:NSDictionary.class] && [payload[@"version"] isEqualToString:@"v1"]) {
        if ([payload[@"type"] isEqualToString:@"receiverReady"] && [payload[@"receiverPublicKey"] isKindOfClass:NSString.class] && [payload[@"receiverChallenge"] isKindOfClass:NSString.class] && [payload[@"nonce"] isEqualToString:strongSelf.pendingReadyNonce] && [payload[@"castSessionId"] isEqualToString:strongSelf.activeCastSessionID]) [strongSelf sendEventWithName:PorticoGoogleCastStateChanged body:@{ @"receiverReady": payload }];
        else if ([payload[@"type"] isEqualToString:@"receiverSessionReady"] && [payload[@"receiverSessionId"] isKindOfClass:NSString.class] && [payload[@"generation"] isKindOfClass:NSNumber.class]) {
          NSMutableDictionary *ready = [payload mutableCopy];
          ready[@"castSessionId"] = strongSelf.activeCastSessionID ?: @"";
          [strongSelf sendEventWithName:PorticoGoogleCastStateChanged body:@{ @"receiverSessionReady": ready }];
        }
      }
    };
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents { return @[PorticoGoogleCastStateChanged]; }

- (NSDictionary *)constantsToExport { return @{ @"configured": @(PorticoGoogleCastConfigured()), @"receiverId": PorticoGoogleCastApplicationID() ?: @"" }; }

- (void)startObserving {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.observing = YES;
    if (!PorticoGoogleCastConfigured()) { [self emitState]; return; }
    GCKSessionManager *manager = GCKCastContext.sharedInstance.sessionManager;
    [manager addListener:self];
    [self attachClient:manager.currentCastSession];
    [self emitState];
  });
}

- (void)stopObserving {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.observing = NO;
    if (!PorticoGoogleCastConfigured()) return;
    GCKSessionManager *manager = GCKCastContext.sharedInstance.sessionManager;
    [manager removeListener:self];
    [manager.currentCastSession removeChannel:self.channel];
    [manager.currentCastSession.remoteMediaClient removeListener:self];
    self.activeCastSessionID = nil;
    self.pendingReadyNonce = nil;
  });
}

RCT_REMAP_METHOD(state,
                 stateResolver:(RCTPromiseResolveBlock)resolve
                 stateRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{ resolve([self stateDictionary]); });
}

RCT_REMAP_METHOD(requestReceiverReady,
                 readyNonce:(NSString *)nonce
                 readyResolver:(RCTPromiseResolveBlock)resolve
                 readyRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!PorticoGoogleCastConfigured()) { reject(@"cast_unconfigured", @"Google Cast is unavailable until a Custom Receiver application ID is configured.", nil); return; }
    GCKCastSession *session = GCKCastContext.sharedInstance.sessionManager.currentCastSession;
    if (!session) { reject(@"cast_not_connected", @"Choose a Google Cast destination before requesting receiver readiness.", nil); return; }
    NSString *safeNonce = [self safeString:nonce];
    if (safeNonce.length == 0) { reject(@"cast_nonce_invalid", @"A readiness nonce is required.", nil); return; }
    self.pendingReadyNonce = safeNonce;
    NSDictionary *message = @{ @"type": @"requestReceiverReady", @"version": @"v1", @"nonce": safeNonce, @"sessionId": self.activeCastSessionID ?: @"" };
    NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSError *error = nil;
    if (![self.channel sendTextMessage:text error:&error]) { reject(@"cast_request_failed", error.localizedDescription ?: @"The receiver readiness request failed.", error); return; }
    resolve([self stateDictionary]);
  });
}

RCT_REMAP_METHOD(load,
                 loadRequest:(NSDictionary *)request
                 loadResolver:(RCTPromiseResolveBlock)resolve
                 loadRejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    GCKRemoteMediaClient *client = [self remoteClientOrReject:reject];
    if (!client) return;
    NSString *source = [self safeString:request[@"sourceURL"]];
    NSURL *sourceURL = [NSURL URLWithString:source];
    NSURLComponents *components = sourceURL ? [NSURLComponents componentsWithURL:sourceURL resolvingAgainstBaseURL:NO] : nil;
    BOOL secureTransport = [components.scheme.lowercaseString isEqualToString:@"https"];
    BOOL containsCredentialQuery = NO;
    for (NSURLQueryItem *item in components.queryItems) {
      NSString *name = item.name.lowercaseString;
      if ([name isEqualToString:@"media_grant"] || [name isEqualToString:@"access_token"] || [name isEqualToString:@"token"] || [name isEqualToString:@"authorization"]) containsCredentialQuery = YES;
    }
    NSDictionary *customData = [request[@"customData"] isKindOfClass:NSDictionary.class] ? request[@"customData"] : nil;
    NSString *configuredReceiverID = PorticoGoogleCastApplicationID();
    NSString *boundReceiverID = [self safeString:customData[@"receiverId"]];
    if (!sourceURL || !secureTransport || components.user || components.fragment || components.query.length > 0 || containsCredentialQuery || !customData[@"bootstrapEnvelope"] || !customData[@"bootstrapId"] || boundReceiverID.length == 0 || ![boundReceiverID isEqualToString:configuredReceiverID] || !customData[@"receiverOrigin"] || !customData[@"serverOrigin"] || !customData[@"receiverChallenge"]) {
      reject(@"invalid_cast_source", @"Google Cast requires a clean HTTPS stream URL and a receiver-bound bootstrap envelope.", nil);
      return;
    }

    GCKMediaMetadata *metadata = [[GCKMediaMetadata alloc] initWithMetadataType:GCKMediaMetadataTypeGeneric];
    NSString *title = [self safeString:request[@"title"]];
    NSString *subtitle = [self safeString:request[@"subtitle"]];
    if (title.length) [metadata setString:title forKey:kGCKMetadataKeyTitle];
    if (subtitle.length) [metadata setString:subtitle forKey:kGCKMetadataKeySubtitle];
    BOOL isLive = [request[@"isLive"] boolValue];
    GCKMediaInformationBuilder *media = [[GCKMediaInformationBuilder alloc] initWithContentURL:sourceURL];
    media.contentType = [self safeString:request[@"contentType"]].length ? [self safeString:request[@"contentType"]] : @"application/x-mpegURL";
    media.streamType = isLive ? GCKMediaStreamTypeLive : GCKMediaStreamTypeBuffered;
    media.streamDuration = isLive ? INFINITY : MAX(0, [request[@"durationSeconds"] doubleValue]);
    media.metadata = metadata;

    GCKMediaLoadRequestDataBuilder *load = [[GCKMediaLoadRequestDataBuilder alloc] init];
    load.mediaInformation = media.build;
    load.customData = customData;
    load.autoplay = @([request[@"autoplay"] boolValue]);
    load.startTime = isLive ? kGCKInvalidTimeInterval : MAX(0, [request[@"startPositionSeconds"] doubleValue]);
    [self trackRequest:[client loadMediaWithLoadRequestData:load.build] resolver:resolve rejecter:reject];
  });
}

RCT_REMAP_METHOD(play,
                 playResolver:(RCTPromiseResolveBlock)resolve
                 playRejecter:(RCTPromiseRejectBlock)reject) {
  [self performCommand:@"play" position:0 resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(pause,
                 pauseResolver:(RCTPromiseResolveBlock)resolve
                 pauseRejecter:(RCTPromiseRejectBlock)reject) {
  [self performCommand:@"pause" position:0 resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(stop,
                 stopResolver:(RCTPromiseResolveBlock)resolve
                 stopRejecter:(RCTPromiseRejectBlock)reject) {
  [self performCommand:@"stop" position:0 resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(seek,
                 seekPosition:(double)position
                 seekResolver:(RCTPromiseResolveBlock)resolve
                 seekRejecter:(RCTPromiseRejectBlock)reject) {
  [self performCommand:@"seek" position:position resolver:resolve rejecter:reject];
}

- (void)performCommand:(NSString *)command
              position:(double)position
              resolver:(RCTPromiseResolveBlock)resolve
              rejecter:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    GCKRemoteMediaClient *client = [self remoteClientOrReject:reject];
    if (!client) return;
    GCKRequest *request = nil;
    if ([command isEqualToString:@"play"]) request = [client play];
    else if ([command isEqualToString:@"pause"]) request = [client pause];
    else if ([command isEqualToString:@"stop"]) request = [client stop];
    else {
      GCKMediaSeekOptions *options = [GCKMediaSeekOptions new];
      options.interval = MAX(0, position);
      options.relative = NO;
      options.resumeState = GCKMediaResumeStateUnchanged;
      request = [client seekWithOptions:options];
    }
    [self trackRequest:request resolver:resolve rejecter:reject];
  });
}

- (void)trackRequest:(GCKRequest *)request resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject {
  if (!request) { reject(@"cast_request_failed", @"Google Cast could not create the playback request.", nil); return; }
  PorticoGoogleCastRequestCompletion *completion = [PorticoGoogleCastRequestCompletion new];
  __weak typeof(self) weakSelf = self;
  __weak PorticoGoogleCastRequestCompletion *weakCompletion = completion;
  completion.success = ^{
    typeof(self) strongSelf = weakSelf;
    PorticoGoogleCastRequestCompletion *strongCompletion = weakCompletion;
    if (!strongSelf || !strongCompletion) return;
    [strongSelf.pendingRequests removeObject:strongCompletion];
    [strongSelf emitState];
    resolve([strongSelf stateDictionary]);
  };
  completion.failure = ^(NSError *error) {
    typeof(self) strongSelf = weakSelf;
    PorticoGoogleCastRequestCompletion *strongCompletion = weakCompletion;
    if (strongSelf && strongCompletion) [strongSelf.pendingRequests removeObject:strongCompletion];
    reject(@"cast_request_failed", error.localizedDescription ?: @"The Google Cast request failed.", error);
  };
  [self.pendingRequests addObject:completion];
  request.delegate = completion;
}

- (GCKRemoteMediaClient *)remoteClientOrReject:(RCTPromiseRejectBlock)reject {
  if (!PorticoGoogleCastConfigured()) {
    reject(@"cast_unconfigured", @"Google Cast is unavailable until a Custom Receiver application ID is configured.", nil);
    return nil;
  }
  GCKCastSession *session = GCKCastContext.sharedInstance.sessionManager.currentCastSession;
  if (!session || !session.remoteMediaClient) {
    reject(@"cast_not_connected", @"Choose a Google Cast destination before starting playback.", nil);
    return nil;
  }
  return session.remoteMediaClient;
}

- (NSDictionary *)stateDictionary {
  if (!PorticoGoogleCastConfigured()) {
    return @{ @"configured": @NO, @"connected": @NO, @"recovering": @NO, @"deviceName": @"", @"playerState": @"idle", @"positionSeconds": @0, @"durationSeconds": @0, @"isLive": @NO, @"canPause": @NO, @"canSeek": @NO, @"contentURL": @"", @"idleReason": @"none" };
  }
  GCKCastSession *session = GCKCastContext.sharedInstance.sessionManager.currentCastSession;
  GCKRemoteMediaClient *client = session.remoteMediaClient;
  GCKMediaStatus *status = client.mediaStatus;
  NSString *playerState = @"idle";
  if (status.playerState == GCKMediaPlayerStatePlaying) playerState = @"playing";
  else if (status.playerState == GCKMediaPlayerStatePaused) playerState = @"paused";
  else if (status.playerState == GCKMediaPlayerStateBuffering) playerState = @"buffering";
  else if (status.playerState == GCKMediaPlayerStateLoading) playerState = @"loading";
  NSString *idleReason = @"none";
  if (status.idleReason == GCKMediaPlayerIdleReasonFinished) idleReason = @"finished";
  else if (status.idleReason == GCKMediaPlayerIdleReasonCancelled) idleReason = @"cancelled";
  else if (status.idleReason == GCKMediaPlayerIdleReasonInterrupted) idleReason = @"interrupted";
  else if (status.idleReason == GCKMediaPlayerIdleReasonError) idleReason = @"error";
  NSTimeInterval duration = status.mediaInformation.streamDuration;
  return @{
    @"configured": @YES,
    @"receiverId": PorticoGoogleCastApplicationID() ?: @"",
    @"castSessionId": session.sessionID ?: @"",
    @"connected": @(session != nil && session.connectionState == GCKConnectionStateConnected),
    @"recovering": @(self.recoveringSession),
    @"deviceName": session.device.friendlyName ?: @"",
    @"playerState": playerState,
    @"positionSeconds": @(client ? MAX(0, client.approximateStreamPosition) : 0),
    @"durationSeconds": @(isfinite(duration) ? MAX(0, duration) : 0),
    @"isLive": @(status.mediaInformation.streamType == GCKMediaStreamTypeLive),
    @"canPause": @(status ? [status isMediaCommandSupported:kGCKMediaCommandPause] : NO),
    @"canSeek": @(status ? [status isMediaCommandSupported:kGCKMediaCommandSeek] : NO),
    @"contentURL": status.mediaInformation.contentURL.absoluteString ?: @"",
    @"idleReason": idleReason,
  };
}

- (void)emitState {
  if (self.observing) [self sendEventWithName:PorticoGoogleCastStateChanged body:[self stateDictionary]];
}

- (NSString *)safeString:(id)value {
  return [value isKindOfClass:NSString.class] ? [(NSString *)value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] : @"";
}

- (void)attachClient:(GCKCastSession *)session {
  if (!session) return;
  NSString *nextSessionID = session.sessionID ?: @"";
  if (![self.activeCastSessionID isEqualToString:nextSessionID]) {
    self.activeCastSessionID = nextSessionID;
    self.pendingReadyNonce = nil;
  }
  [session addChannel:self.channel];
  [session.remoteMediaClient removeListener:self];
  [session.remoteMediaClient addListener:self];
  [self emitState];
}

- (void)sessionManager:(GCKSessionManager *)sessionManager didStartCastSession:(GCKCastSession *)session { self.recoveringSession = NO; [self attachClient:session]; }
- (void)sessionManager:(GCKSessionManager *)sessionManager didResumeCastSession:(GCKCastSession *)session { self.recoveringSession = NO; [self attachClient:session]; }
- (void)sessionManager:(GCKSessionManager *)sessionManager didSuspendCastSession:(GCKCastSession *)session withReason:(GCKConnectionSuspendReason)reason { self.recoveringSession = YES; [session.remoteMediaClient removeListener:self]; [self emitState]; }
- (void)sessionManager:(GCKSessionManager *)sessionManager didEndCastSession:(GCKCastSession *)session withError:(NSError *)error { self.recoveringSession = NO; [session.remoteMediaClient removeListener:self]; if ([self.activeCastSessionID isEqualToString:session.sessionID]) { self.activeCastSessionID = nil; self.pendingReadyNonce = nil; } [self emitState]; }
- (void)sessionManager:(GCKSessionManager *)sessionManager didFailToStartCastSession:(GCKCastSession *)session withError:(NSError *)error { self.recoveringSession = NO; [self emitState]; }
- (void)remoteMediaClientDidUpdateMediaStatus:(GCKRemoteMediaClient *)client { [self emitState]; }
- (void)remoteMediaClientDidUpdatePreloadStatus:(GCKRemoteMediaClient *)client { [self emitState]; }

@end
