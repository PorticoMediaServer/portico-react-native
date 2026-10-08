#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import "PorticoPlaybackController.h"
#import "PorticoListeningOwner.h"
#import "PorticoAudioRender.h"
@interface PorticoPlaybackModule : RCTEventEmitter<RCTBridgeModule>
@property(nonatomic,strong) PorticoPlaybackController *controller;
/** The native listening owner (Playback v1, plan §9.3 C3). */
@property(nonatomic,strong) PorticoListeningSessionOwner *session;
@property(atomic,assign) BOOL invalidated;
@end
@implementation PorticoPlaybackModule
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup{return YES;}
- (dispatch_queue_t)methodQueue{return dispatch_get_main_queue();}
- (instancetype)init {if((self=[super init])){
#if DEBUG
 [PorticoAudioRender runConformanceIfRequested];
#endif
 _controller=[PorticoPlaybackController new];PorticoPlaybackController.shared=_controller;_session=[[PorticoListeningSessionOwner alloc]initWithController:_controller render:[PorticoListeningDecodeRender new]];
 __weak PorticoPlaybackModule *weakSelf=self;_session.onSnapshot=^(NSDictionary *snapshot){if(!weakSelf.invalidated)[weakSelf sendEventWithName:@"PorticoListeningSnapshot" body:snapshot];};_controller.onFact=^(NSDictionary *fact){if(!weakSelf.invalidated){[weakSelf.session fact:fact];[weakSelf sendEventWithName:@"PorticoPlaybackFact" body:fact];}};_controller.onPictureInPicture=^(NSDictionary *change){if(!weakSelf.invalidated)[weakSelf sendEventWithName:@"PorticoPictureInPicture" body:change];};}return self;}
- (NSArray<NSString *> *)supportedEvents{return @[@"PorticoPlaybackFact",@"PorticoListeningSnapshot",@"PorticoPictureInPicture"];}
RCT_REMAP_METHOD(acquire,acquire:(NSString *)owner resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if(self.invalidated){reject(@"bridge_closed",@"Playback bridge is closed.",nil);return;}NSDictionary *lease=[_controller acquire:owner];if(lease)resolve(lease);else reject(@"owner_busy",@"Another playback owner is still active.",nil);}
RCT_REMAP_METHOD(command,command:(NSDictionary *)command resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if(self.invalidated){reject(@"bridge_closed",@"Playback bridge is closed.",nil);return;}NSString *error=[_controller acceptCommand:command];if(error)reject(@"command_rejected",error,nil);else resolve(@YES);}
RCT_REMAP_METHOD(release,release:(NSString *)lease resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){[_controller releaseLease:lease];resolve(@YES);}
/** Whether `owner` is the session owner's current handover. */
- (BOOL)v1:(NSString *)owner {return [owner isKindOfClass:NSString.class]&&[[self.session activeOwner] isEqual:owner];}
RCT_REMAP_METHOD(adoptListeningSession,adoptListeningSession:(NSDictionary *)context resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){NSError *error=nil;if(!self.invalidated&&[self.session adopt:context error:&error])resolve([self.session snapshot:context[@"owner"]]);else reject(@"listening_authority",error.localizedDescription?:@"Listening owner is closed.",error);}
RCT_REMAP_METHOD(listeningSessionUpdated,listeningSessionUpdated:(NSString *)owner sessionId:(NSString *)sessionId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if(!self.invalidated&&[self v1:owner]&&[sessionId isKindOfClass:NSString.class]&&[self.session sessionUpdated:sessionId owner:owner])resolve(@YES);else reject(@"listening_stale",@"This listening owner is no longer active.",nil);}
// INT T9: another viewer (sign-out, a profile or server switch) never reads this viewer's cached audio.
RCT_REMAP_METHOD(purgeAudioCache,purgeAudioCacheWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){[PorticoAudioRender purgeCache];resolve(@YES);}
RCT_REMAP_METHOD(listeningAdvance,listeningAdvance:(NSString *)owner reason:(NSString *)reason entryId:(NSString *)entryId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if(!self.invalidated&&[self v1:owner]&&[self.session advance:reason entry:[entryId isKindOfClass:NSString.class]?entryId:nil owner:owner])resolve(@YES);else reject(@"listening_stale",@"This listening owner is no longer active.",nil);}
RCT_REMAP_METHOD(listeningRoute,listeningRoute:(NSString *)owner route:(NSDictionary *)route resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if(!self.invalidated&&([self v1:owner]&&[self.session route:route owner:owner]))resolve(@YES);else reject(@"listening_route",@"The verified listening route could not be applied.",nil);}
RCT_REMAP_METHOD(listeningAction,listeningAction:(NSString *)owner action:(NSString *)action value:(NSNumber *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if(!self.invalidated&&([self v1:owner]&&[self.session action:action value:value owner:owner]))resolve(@YES);else reject(@"listening_stale",@"This listening owner is no longer active.",nil);}
RCT_REMAP_METHOD(listeningSnapshot,listeningSnapshot:(NSString *)owner resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){resolve([self.session snapshot:owner]);}
RCT_REMAP_METHOD(acknowledgeListening,acknowledgeListening:(NSString *)owner sequence:(NSNumber *)sequence resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if([self v1:owner]&&[self.session acknowledge:owner sequence:sequence])resolve(@YES);else reject(@"listening_stale",@"Listening handover expired.",nil);}
RCT_REMAP_METHOD(listeningPolicy,listeningPolicy:(NSString *)owner policy:(NSDictionary *)policy resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if([self v1:owner]&&[self.session policy:policy owner:owner])resolve(@YES);else reject(@"listening_policy",@"Listening policy could not be validated or saved.",nil);}
RCT_REMAP_METHOD(listeningDeadlines,listeningDeadlines:(NSString *)owner deadlines:(NSDictionary *)deadlines resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if([self v1:owner]&&[self.session deadlines:deadlines owner:owner])resolve(@YES);else reject(@"listening_deadline",@"Listening deadlines could not be saved.",nil);}
RCT_REMAP_METHOD(listeningCredentials,listeningCredentials:(NSString *)owner token:(NSString *)token resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){if([self v1:owner]&&[self.session credentials:token owner:owner])resolve(@YES);else reject(@"listening_stale",@"Listening authority changed.",nil);}
RCT_REMAP_METHOD(retireListening,retireListening:(NSString *)owner stop:(BOOL)stop resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){[self.session retire:owner stop:stop];resolve(@YES);}
RCT_EXPORT_METHOD(listeningMetadata:(NSString *)owner metadata:(NSDictionary *)metadata){[self.session metadata:metadata owner:owner];}
// OS-06: the profile's skip amounts for music and audiobooks on the lock screen.
RCT_EXPORT_METHOD(listeningSkipIntervals:(double)back forward:(double)forward){[self.session skipBack:back forward:forward];}
#if DEBUG
RCT_REMAP_METHOD(testStaleCommands,testStaleCommandsWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){resolve([_controller testStaleCommands]);}
RCT_EXPORT_METHOD(testClampNext){[_controller testClampNext];}
#endif
- (void)invalidate {
 self.invalidated=YES;
 PorticoPlaybackController *controller=_controller;
 PorticoListeningSessionOwner *session=_session;
 if(NSThread.isMainThread){[session invalidate];[controller invalidate];}
 else dispatch_async(dispatch_get_main_queue(), ^{[session invalidate];[controller invalidate];});
 [super invalidate];
}
@end
