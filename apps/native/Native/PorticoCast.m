#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <GoogleCast/GoogleCast.h>

/**
 * IOS-PLAYER-03: Google Cast, as a transport only. The receiver is Portico's own page
 * (cast.getportico.tv); this module finds a Cast device (the SDK's own picker), opens a session,
 * and carries JSON on Portico's channel both ways. It never sees a media address or a token: the
 * JavaScript protocol pairs the television with the server by a one-use code, and the television
 * fetches everything itself.
 *
 * Available only when the app was built with a receiver application id (AppDelegate sets up the
 * Cast context); otherwise `available()` answers NO and no Cast row is offered.
 */
static NSString *const PorticoCastNamespace = @"urn:x-cast:tv.getportico.cast";

@interface PorticoCast : RCTEventEmitter <RCTBridgeModule, GCKSessionManagerListener, GCKGenericChannelDelegate>
@end

@implementation PorticoCast {
  GCKGenericChannel *_channel;
  __weak GCKCastSession *_channelSession;
  BOOL _listening;
}
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"PorticoCastSession", @"PorticoCastMessage"]; }

/** The receiver application this build was made for, so the app can tell whether the server names the same one. Empty when the build has none. */
- (NSDictionary *)constantsToExport {
  NSString *application = [NSBundle.mainBundle objectForInfoDictionaryKey:@"PorticoCastApplicationID"];
  BOOL named = [application isKindOfClass:NSString.class] && application.length > 0 && ![application hasPrefix:@"$("];
  return @{@"applicationId": named ? application : @""};
}

- (void)startObserving {
  _listening = YES;
  if (GCKCastContext.isSharedInstanceInitialized) [GCKCastContext.sharedInstance.sessionManager addListener:self];
}
- (void)stopObserving {
  _listening = NO;
  if (GCKCastContext.isSharedInstanceInitialized) [GCKCastContext.sharedInstance.sessionManager removeListener:self];
}
- (void)invalidate {
  void (^cleanup)(void) = ^{ [self stopObserving]; [self detachChannel]; };
  if (NSThread.isMainThread) cleanup(); else dispatch_async(dispatch_get_main_queue(), cleanup);
  [super invalidate];
}

- (void)emitSession:(NSString *)state session:(GCKSession *)session error:(NSError *)error {
  if (!_listening) return;
  [self sendEventWithName:@"PorticoCastSession" body:@{
    @"state": state,
    @"deviceName": session.device.friendlyName ?: @"",
    @"error": error ? @"cast_failed" : @"",
  }];
}

- (void)detachChannel {
  _channel.delegate = nil;
  if (_channel) [_channelSession removeChannel:_channel];
  _channel = nil; _channelSession = nil;
}
- (void)attach:(GCKCastSession *)session {
  if (_channel && _channelSession == session) return;
  [self detachChannel];
  GCKGenericChannel *channel = [[GCKGenericChannel alloc] initWithNamespace:PorticoCastNamespace];
  channel.delegate = self;
  if ([session addChannel:channel]) { _channel = channel; _channelSession = session; }
  else channel.delegate = nil;
}

#pragma mark Session listener

- (void)sessionManager:(GCKSessionManager *)manager didStartCastSession:(GCKCastSession *)session {
  [self attach:session];
  [self emitSession:@"started" session:session error:nil];
}
- (void)sessionManager:(GCKSessionManager *)manager didResumeCastSession:(GCKCastSession *)session {
  [self attach:session];
  [self emitSession:@"started" session:session error:nil];
}
- (void)sessionManager:(GCKSessionManager *)manager didEndCastSession:(GCKCastSession *)session withError:(NSError *)error {
  if (_channelSession && _channelSession != session) return;
  [self detachChannel];
  [self emitSession:@"ended" session:session error:error];
}
- (void)sessionManager:(GCKSessionManager *)manager didFailToStartCastSession:(GCKCastSession *)session withError:(NSError *)error {
  if (_channelSession && _channelSession != session) return;
  [self detachChannel];
  [self emitSession:@"failed" session:session error:error];
}

#pragma mark Channel

- (void)castChannel:(GCKCastChannel *)channel didReceiveTextMessage:(NSString *)message withNamespace:(NSString *)protocolNamespace {
  if (!_listening || ![protocolNamespace isEqualToString:PorticoCastNamespace] || message.length > 65536) return;
  [self sendEventWithName:@"PorticoCastMessage" body:@{@"message": message}];
}

#pragma mark JavaScript

RCT_REMAP_METHOD(available, availableWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@(GCKCastContext.isSharedInstanceInitialized));
}

/** The current session, if one is connected (after an app relaunch the SDK may resume it). */
RCT_REMAP_METHOD(current, currentWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!GCKCastContext.isSharedInstanceInitialized) { resolve([NSNull null]); return; }
  GCKCastSession *session = GCKCastContext.sharedInstance.sessionManager.currentCastSession;
  if (!session || session.connectionState != GCKConnectionStateConnected) { resolve([NSNull null]); return; }
  if (!_channel) [self attach:session];
  resolve(@{@"deviceName": session.device.friendlyName ?: @""});
}

/** The SDK's own device chooser; the session events report the outcome. */
RCT_EXPORT_METHOD(choose) {
  if (!GCKCastContext.isSharedInstanceInitialized) return;
  [GCKCastContext.sharedInstance presentCastDialog];
}

RCT_REMAP_METHOD(send, send:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!_channel || json.length > 65536) { reject(@"cast_not_connected", @"No Cast session.", nil); return; }
  NSError *error = nil;
  if ([_channel sendTextMessage:json error:&error]) resolve(@YES);
  else reject(@"cast_send_failed", @"The message was not sent.", error);
}

RCT_EXPORT_METHOD(end:(BOOL)stopReceiver) {
  if (!GCKCastContext.isSharedInstanceInitialized) return;
  [GCKCastContext.sharedInstance.sessionManager endSessionAndStopCasting:stopReceiver];
}
@end
