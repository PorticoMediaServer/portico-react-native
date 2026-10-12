#import <React/RCTViewManager.h>
#import <React/RCTBridge.h>
#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <Security/Security.h>
#import "PorticoPlaybackController.h"
#import "PorticoSecureStorageRead.h"
#import "PorticoProfileTrust.h"
@interface PorticoPlayerView : UIView <AVPictureInPictureControllerDelegate>
@property(nonatomic,copy) NSString *lease;
@property(nonatomic) NSInteger pictureInPictureRequest;
@property(nonatomic,strong) AVPictureInPictureController *pictureInPicture;
@property(nonatomic,strong) PorticoPlaybackController *controller;
@end
@implementation PorticoPlayerView { AVPlayerLayer *_layer; UILabel *_subtitle; }
- (instancetype)initWithFrame:(CGRect)frame {if((self=[super initWithFrame:frame])){self.backgroundColor=UIColor.blackColor;_layer=[AVPlayerLayer playerLayerWithPlayer:nil];_layer.videoGravity=AVLayerVideoGravityResizeAspect;[self.layer addSublayer:_layer];_subtitle=[UILabel new];_subtitle.textColor=UIColor.whiteColor;_subtitle.backgroundColor=[UIColor colorWithWhite:0 alpha:0.7];_subtitle.textAlignment=NSTextAlignmentCenter;_subtitle.numberOfLines=0;_subtitle.userInteractionEnabled=NO;_subtitle.hidden=YES;_subtitle.isAccessibilityElement=YES;[self addSubview:_subtitle];[[NSNotificationCenter defaultCenter]addObserver:self selector:@selector(updateSubtitle) name:@"PorticoPlaybackSubtitleChanged" object:nil];[_layer addObserver:self forKeyPath:@"readyForDisplay" options:NSKeyValueObservingOptionNew context:NULL];[[NSNotificationCenter defaultCenter]addObserver:self selector:@selector(attachLayer) name:@"PorticoPlaybackAttachmentChanged" object:nil];}return self;}
- (void)setLease:(NSString *)lease {_lease=[lease copy];[self attachLayer];}
- (void)setController:(PorticoPlaybackController *)controller {_controller=controller;[self attachLayer];}
- (void)attachLayer {if(![_lease isEqual:_controller.lease]){[self.pictureInPicture stopPictureInPicture];self.pictureInPicture=nil;}
#if TARGET_OS_TV
 if(!_lease.length||![_lease isEqual:_controller.lease])self.window.avDisplayManager.preferredDisplayCriteria=nil;
#endif
 _layer.player=(_lease.length&&[_lease isEqual:_controller.lease])?_controller.player:nil;[self updateSubtitle];[self preparePictureInPicture];}
/** OS-04: the controller exists as soon as a video is attached, so leaving the app (Home swipe)
 * can continue the film in Picture in Picture, as the system's own players do. The system's
 * "Start PiP Automatically" setting still decides. This view stays the controller's only owner. */
- (void)preparePictureInPicture {
 if(![AVPictureInPictureController isPictureInPictureSupported]||!_lease.length||![_lease isEqual:_controller.lease]||!_layer.player)return;
 if(!self.pictureInPicture){self.pictureInPicture=[[AVPictureInPictureController alloc]initWithPlayerLayer:_layer];self.pictureInPicture.delegate=self;}
#if !TARGET_OS_TV
 if(@available(iOS 14.2, *))self.pictureInPicture.canStartPictureInPictureAutomaticallyFromInline=YES;
#endif
}
// Reported through the playback module's event channel, not a view event prop: old-style view
// events reach JavaScript through RCTEventEmitter, which a New Architecture production bundle
// never registers, so the first one (PiP "unavailable" on the simulator) crashed the app.
- (void)pictureInPictureChanged:(NSDictionary *)change {NSMutableDictionary *body=[change mutableCopy];body[@"lease"]=_lease?:@"";if(_controller.onPictureInPicture)_controller.onPictureInPicture(body);}
- (void)setPictureInPictureRequest:(NSInteger)value {if(value==_pictureInPictureRequest)return;_pictureInPictureRequest=value;
 // tvOS 14+ supports Picture in Picture from an AVPlayerLayer too (OS-04); the TV player decides
 // whether to offer it. Unsupported hardware answers "unavailable" rather than doing nothing.
 if(![AVPictureInPictureController isPictureInPictureSupported]||!_lease.length||![_lease isEqual:_controller.lease]){[self pictureInPictureChanged:@{@"state":@"unavailable"}];return;}
 if(self.pictureInPicture.isPictureInPictureActive){[self.pictureInPicture stopPictureInPicture];return;}
 [self preparePictureInPicture];
 if(self.pictureInPicture.isPictureInPicturePossible)[self.pictureInPicture startPictureInPicture];else [self pictureInPictureChanged:@{@"state":@"unavailable"}];
}
// OS-02: `subtitlesCarried` is NO when the chosen subtitles are drawn by the app, which PiP can't
// show; the player can say so instead of letting them vanish silently.
- (void)pictureInPictureControllerDidStartPictureInPicture:(AVPictureInPictureController *)controller {[self pictureInPictureChanged:@{@"state":@"started",@"subtitlesCarried":@(!_controller.subtitleOverlayActive)}];}
- (void)pictureInPictureControllerDidStopPictureInPicture:(AVPictureInPictureController *)controller {[self pictureInPictureChanged:@{@"state":@"stopped"}];}
- (void)pictureInPictureController:(AVPictureInPictureController *)controller failedToStartPictureInPictureWithError:(NSError *)error {[self pictureInPictureChanged:@{@"state":@"unavailable"}];}
- (void)pictureInPictureController:(AVPictureInPictureController *)controller restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:(void (^)(BOOL restored))completionHandler {[self pictureInPictureChanged:@{@"state":@"restore"}];completionHandler(YES);}
- (void)updateSubtitle {_subtitle.text=(_lease.length&&[_lease isEqual:_controller.lease])?_controller.subtitleText:@"";_subtitle.hidden=!_subtitle.text.length;[self setNeedsLayout];}
- (void)layoutSubviews{[super layoutSubviews];_layer.frame=self.bounds;CGRect video=_layer.videoRect;if(CGRectIsEmpty(video))video=self.bounds;CGFloat width=video.size.width*0.9;CGFloat fontSize=MAX(12,MIN(40,video.size.width*0.035));_subtitle.font=[_controller.subtitleCue[@"italic"]boolValue]?[UIFont italicSystemFontOfSize:fontSize]:[UIFont systemFontOfSize:fontSize weight:UIFontWeightMedium];CGSize size=[_subtitle sizeThatFits:CGSizeMake(width,video.size.height*0.6)];CGFloat height=MIN(size.height+8,video.size.height*0.6);_subtitle.frame=CGRectMake(CGRectGetMidX(video)-width/2,([_controller.subtitleCue[@"top"]boolValue]?MAX(CGRectGetMinY(video)+8,self.safeAreaInsets.top):CGRectGetMaxY(video)-MAX(8,video.size.height*0.08)-height),width,height);}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {if(object==_layer&&_layer.readyForDisplay){[_controller displayReadyForLease:_lease];
#if TARGET_OS_TV
 AVPlayerItem *item=_layer.player.currentItem;__weak PorticoPlayerView *weakSelf=self;
 [item.asset loadValuesAsynchronouslyForKeys:@[@"preferredDisplayCriteria"] completionHandler:^{dispatch_async(dispatch_get_main_queue(),^{PorticoPlayerView *view=weakSelf;if(view&&view->_layer.player.currentItem==item)view.window.avDisplayManager.preferredDisplayCriteria=item.asset.preferredDisplayCriteria;});}];
#endif
 }}
- (void)willMoveToWindow:(UIWindow *)newWindow {
#if TARGET_OS_TV
 if(self.window&&self.window!=newWindow)self.window.avDisplayManager.preferredDisplayCriteria=nil;
#endif
 [super willMoveToWindow:newWindow];
}
- (void)dealloc{
#if TARGET_OS_TV
 self.window.avDisplayManager.preferredDisplayCriteria=nil;
#endif
 // This view is the app's strong owner of the PiP controller and its delegate is
 // weak, so teardown ends PiP here rather than leaving a controller running
 // against a layer whose player is about to go away. Exactly once: the property
 // is cleared immediately after.
 if(_pictureInPicture){[_pictureInPicture stopPictureInPicture];_pictureInPicture.delegate=nil;_pictureInPicture=nil;}
 [_layer removeObserver:self forKeyPath:@"readyForDisplay"];[[NSNotificationCenter defaultCenter]removeObserver:self];_layer.player=nil;}
@end
@interface PorticoPlayerManager : RCTViewManager @end
@implementation PorticoPlayerManager
RCT_EXPORT_MODULE(PorticoPlayer)
// After a JavaScript reload the new playback module registers itself as the shared controller;
// looking it up through the bridge could hand a new player view the previous, invalidated one.
- (UIView *)view {PorticoPlayerView *view=[PorticoPlayerView new];PorticoPlaybackController *controller=PorticoPlaybackController.shared;if(!controller){id module=[self.bridge moduleForClass:NSClassFromString(@"PorticoPlaybackModule")];controller=[module valueForKey:@"controller"];}view.controller=controller;return view;}
RCT_EXPORT_VIEW_PROPERTY(lease,NSString)
RCT_EXPORT_VIEW_PROPERTY(pictureInPictureRequest,NSInteger)
@end
// Queue HTTP requests carry a device proof. Never follow redirects, bypass TLS
// validation, or accumulate an unbounded response. There is no background media
// player here; this is only the bounded JSON control transport.
//
// PERF-04: every request used to open its own NSURLSession, so each API call paid a new TCP
// connection and TLS handshake, and a 17th concurrent request was rejected outright. Now one
// shared, ephemeral, cookie-less, cache-less session (so connections and TLS sessions are
// reused), at most 12 requests in flight and up to 64 waiting in order. The security bounds are
// unchanged and enforced per task: no redirects, at most 1 MB bodies (8 MB for API GETs), 15 s timeouts.
@interface PorticoQueueRequest : NSObject
@property(nonatomic,strong) NSURLSessionDataTask *task;
@property(nonatomic,strong) NSURLRequest *wire;
@property(nonatomic,strong) NSMutableData *data;
@property(nonatomic,strong) NSHTTPURLResponse *response;
@property(nonatomic,copy) RCTPromiseResolveBlock resolve;
@property(nonatomic,copy) RCTPromiseRejectBlock reject;
@property(nonatomic,copy) NSString *identifier;
@property(nonatomic,weak) id owner;
@property(nonatomic) BOOL completed;
@property(nonatomic) BOOL started;
@property(nonatomic) NSUInteger responseLimit;
- (void)finish:(NSString *)failure;
@end
static NSMutableDictionary<NSString *,PorticoQueueRequest *> *PorticoQueueRequests;
static NSMutableArray<PorticoQueueRequest *> *PorticoQueueWaiting;
static NSMutableDictionary<NSNumber *,PorticoQueueRequest *> *PorticoQueueTasks;
static NSInteger PorticoQueueActive;
static const NSInteger PorticoQueueMaxActive=12, PorticoQueueMaxWaiting=64;

@interface PorticoQueueTransport : NSObject<NSURLSessionDataDelegate,NSURLSessionTaskDelegate> @end
@implementation PorticoQueueTransport
+ (NSURLSession *)session {
 static NSURLSession *session;static dispatch_once_t once;
 dispatch_once(&once,^{
  NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
  configuration.timeoutIntervalForRequest=15;configuration.timeoutIntervalForResource=15;configuration.HTTPShouldSetCookies=NO;configuration.HTTPCookieStorage=nil;configuration.URLCache=nil;configuration.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;configuration.HTTPMaximumConnectionsPerHost=6;
  NSOperationQueue *queue=[NSOperationQueue new];queue.maxConcurrentOperationCount=1;queue.name=@"tv.getportico.transport";
  session=[NSURLSession sessionWithConfiguration:configuration delegate:[PorticoQueueTransport new] delegateQueue:queue];
 });
 return session;
}
/** Caller holds the class lock. */
+ (void)start:(PorticoQueueRequest *)request {
 request.started=YES;PorticoQueueActive++;
 NSURLSessionDataTask *task=[[self session] dataTaskWithRequest:request.wire];request.task=task;
 if(!PorticoQueueTasks)PorticoQueueTasks=[NSMutableDictionary dictionary];PorticoQueueTasks[@(task.taskIdentifier)]=request;
 [task resume];
}
/** Admits a request: start it, queue it, or refuse it when 76 are already pending. */
+ (void)submit:(PorticoQueueRequest *)request domain:(NSString *)domain busy:(NSString *)busy {
 @synchronized(PorticoQueueRequest.class){
  if(!PorticoQueueRequests)PorticoQueueRequests=[NSMutableDictionary dictionary];if(!PorticoQueueWaiting)PorticoQueueWaiting=[NSMutableArray array];
  if(PorticoQueueRequests[request.identifier]||(PorticoQueueActive>=PorticoQueueMaxActive&&(NSInteger)PorticoQueueWaiting.count>=PorticoQueueMaxWaiting)){request.reject(domain,busy,nil);return;}
  PorticoQueueRequests[request.identifier]=request;
  if(PorticoQueueActive<PorticoQueueMaxActive)[self start:request];else [PorticoQueueWaiting addObject:request];
 }
}
/** Caller holds the class lock. Frees the request's slot and starts the next waiting one. */
+ (void)release:(PorticoQueueRequest *)request {
 if(PorticoQueueRequests[request.identifier]==request)[PorticoQueueRequests removeObjectForKey:request.identifier];
 if(!request.started){[PorticoQueueWaiting removeObjectIdenticalTo:request];return;}
 if(request.task)[PorticoQueueTasks removeObjectForKey:@(request.task.taskIdentifier)];
 PorticoQueueActive=MAX(0,PorticoQueueActive-1);
 while(PorticoQueueActive<PorticoQueueMaxActive&&PorticoQueueWaiting.count){PorticoQueueRequest *next=PorticoQueueWaiting.firstObject;[PorticoQueueWaiting removeObjectAtIndex:0];[self start:next];}
}
+ (void)cancelOwnedBy:(id)owner {
 NSArray<PorticoQueueRequest *> *owned;
 @synchronized(PorticoQueueRequest.class){owned=[PorticoQueueRequests.allValues filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(PorticoQueueRequest *r,NSDictionary *b){return r.owner==owner||r.owner==nil;}]];}
 for(PorticoQueueRequest *request in owned)[request finish:@"The app reloaded."];
}
- (PorticoQueueRequest *)requestFor:(NSURLSessionTask *)task {@synchronized(PorticoQueueRequest.class){return PorticoQueueTasks[@(task.taskIdentifier)];}}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler {
 completionHandler(nil);[[self requestFor:task] finish:@"Queue control redirects are not allowed."];
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
 PorticoQueueRequest *request=[self requestFor:task];
 if(!request||![response isKindOfClass:NSHTTPURLResponse.class]||response.expectedContentLength>(long long)(request.responseLimit?:1048576)){completionHandler(NSURLSessionResponseCancel);[request finish:@"Queue response exceeded its limit."];return;}
 @synchronized(request){if(request.completed){completionHandler(NSURLSessionResponseCancel);return;}request.response=(NSHTTPURLResponse *)response;completionHandler(NSURLSessionResponseAllow);}
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
 PorticoQueueRequest *request=[self requestFor:task];if(!request)return;
 BOOL over=NO;@synchronized(request){if(request.completed)return;if(request.data.length+data.length>(request.responseLimit?:1048576))over=YES;else [request.data appendData:data];}
 if(over)[request finish:@"Queue response exceeded its limit."];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
 [[self requestFor:task] finish:error?@"The queue request could not be confirmed.":nil];
}
@end

@implementation PorticoQueueRequest
- (void)finish:(NSString *)failure {
 @synchronized(self) {if(self.completed)return;self.completed=YES;
 if(self.task.state==NSURLSessionTaskStateRunning||self.task.state==NSURLSessionTaskStateSuspended)[self.task cancel];
 @synchronized(PorticoQueueRequest.class){[PorticoQueueTransport release:self];}
 if(failure){self.reject(@"queue_transport",failure,nil);}else{
  NSString *body=[[NSString alloc] initWithData:self.data encoding:NSUTF8StringEncoding];
  if(!body||!self.response){self.reject(@"queue_transport",@"Invalid queue response.",nil);}else{
   NSMutableDictionary *headers=[NSMutableDictionary dictionary];for(id key in self.response.allHeaderFields)headers[[key description]]=[self.response.allHeaderFields[key] description];
   self.resolve(@{@"status":@(self.response.statusCode),@"headers":headers,@"body":body});
  }
 }
 self.resolve=nil;self.reject=nil;self.task=nil;self.wire=nil;
 }
}
@end

// Pull-based event responses share one bounded lifetime and never follow redirects.
@interface PorticoEventStream : NSObject<NSURLSessionDataDelegate>
@property(nonatomic,strong) NSURLSession *session;
@property(nonatomic,strong) NSURLSessionDataTask *task;
@property(nonatomic,strong) NSMutableData *bytes;
@property(nonatomic,weak) id owner;
@property(nonatomic,copy) RCTPromiseResolveBlock opening;
@property(nonatomic,copy) RCTPromiseRejectBlock openingReject;
@property(nonatomic,copy) RCTPromiseResolveBlock reading;
@property(nonatomic,copy) RCTPromiseRejectBlock readingReject;
@property(nonatomic) NSUInteger received;
@property(nonatomic) NSTimeInterval startedAt;
@property(nonatomic) BOOL ended;
@property(nonatomic) BOOL closed;
@property(nonatomic) BOOL failed;
@property(nonatomic,copy) NSString *failureCode;
- (void)cancel;
- (void)deliver;
@end
static NSMutableDictionary<NSString *,PorticoEventStream *> *PorticoEventStreams;
@implementation PorticoEventStream
- (void)deliver {
 if(!self.reading)return;
 if(self.failed){self.readingReject(self.failureCode?:@"event_transport",@"The event connection was interrupted.",nil);}
 else if(self.bytes.length){NSUInteger count=MIN((NSUInteger)16384,self.bytes.length);NSData *chunk=[self.bytes subdataWithRange:NSMakeRange(0,count)];[self.bytes replaceBytesInRange:NSMakeRange(0,count) withBytes:NULL length:0];self.reading(@{@"done":@NO,@"data":[chunk base64EncodedStringWithOptions:0]});}
 else if(self.ended||self.closed){self.reading(@{@"done":@YES});}
 else return;
 self.reading=nil;self.readingReject=nil;
}
- (void)cancel {
 @synchronized(self){
  if(self.closed)return;self.closed=YES;self.ended=YES;
  [self.task cancel];[self.session invalidateAndCancel];self.bytes=nil;
  if(self.openingReject)self.openingReject(self.failureCode?:@"event_cancelled",@"The event stream was cancelled.",nil);
  self.opening=nil;self.openingReject=nil;[self deliver];
 }
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler {
 completionHandler(nil);@synchronized(self){self.failed=YES;self.failureCode=@"event_redirect";[self cancel];}
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
 @synchronized(self){
  if(self.closed||![response isKindOfClass:NSHTTPURLResponse.class]){completionHandler(NSURLSessionResponseCancel);[self cancel];return;}
  NSHTTPURLResponse *http=(id)response;
  if(http.statusCode>=300&&http.statusCode<400){completionHandler(NSURLSessionResponseCancel);self.failed=YES;self.failureCode=@"event_redirect";[self cancel];return;}
  NSMutableDictionary *headers=[NSMutableDictionary dictionary];for(id key in http.allHeaderFields)headers[[key description]]=[http.allHeaderFields[key] description];
  if(self.opening)self.opening(@{@"status":@(http.statusCode),@"headers":headers});
  self.opening=nil;self.openingReject=nil;completionHandler(NSURLSessionResponseAllow);
 }
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
 @synchronized(self){
  if(self.closed)return;
  if(data.length>1048576-self.received){[self cancel];return;}
  self.received+=data.length;[self.bytes appendData:data];[self deliver];
 }
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
 @synchronized(self){
  if(self.closed)return;self.ended=YES;
  BOOL expired=[error.domain isEqual:NSURLErrorDomain]&&error.code==NSURLErrorTimedOut&&NSProcessInfo.processInfo.systemUptime-self.startedAt>=2099;
  self.failed=error!=nil&&!expired;
  self.failureCode=[error.domain isEqual:NSURLErrorDomain]&&error.code==NSURLErrorTimedOut?@"event_timeout":([error.domain isEqual:NSURLErrorDomain]&&error.code==NSURLErrorCancelled?@"event_cancelled":@"event_transport");
  if(self.openingReject)self.openingReject(self.failureCode,@"The event connection could not be opened.",nil);
  self.opening=nil;self.openingReject=nil;[self deliver];[self.session finishTasksAndInvalidate];
 }
}
@end

@interface PorticoRuntime : NSObject<RCTBridgeModule,RCTInvalidating> @end
@implementation PorticoRuntime
RCT_EXPORT_MODULE()
/** A JavaScript reload abandons its promises; release their transport slots at once instead of
 * leaving them to time out while the new JavaScript's first requests wait behind them. */
- (void)invalidate {
 [PorticoQueueTransport cancelOwnedBy:self];
 NSArray<NSString *> *identifiers;@synchronized(PorticoEventStream.class){identifiers=[PorticoEventStreams allKeys];}
 for(NSString *identifier in identifiers){PorticoEventStream *stream;@synchronized(PorticoEventStream.class){stream=PorticoEventStreams[identifier];if(stream.owner!=self&&stream.owner!=nil)continue;[PorticoEventStreams removeObjectForKey:identifier];}[stream cancel];}
}
+ (BOOL)requiresMainQueueSetup{return NO;}
RCT_REMAP_METHOD(prepareSecureRecords,prepareSecureRecordsWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 // Keychain records do not depend on a separate app-held sealing key.
 resolve(@NO);
}
- (NSDictionary *)constantsToExport{
 NSMutableDictionary *values=[@{@"launchId":NSUUID.UUID.UUIDString} mutableCopy];
#if !TARGET_OS_TV
 values[@"pictureInPictureSupported"]=@([AVPictureInPictureController isPictureInPictureSupported]);
#endif
 NSString *hosted=NSBundle.mainBundle.infoDictionary[@"PorticoHostedURL"];if(hosted.length && ![hosted containsString:@"$("])values[@"hostedUrl"]=hosted;
#if DEBUG
 NSString *fixture=NSProcessInfo.processInfo.environment[@"PORTICO_TEST_LOGIN_JSON"];
 values[@"testOwnership"]=@([NSProcessInfo.processInfo.environment[@"PORTICO_TEST_PLAYER_OWNERSHIP"] isEqualToString:@"1"]);
 if(fixture){id json=[NSJSONSerialization JSONObjectWithData:[fixture dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];if([json isKindOfClass:NSDictionary.class])values[@"testLogin"]=json;}
#endif
 return values;
}
#if DEBUG
RCT_REMAP_METHOD(recordTestEvent,recordTestEvent:(NSString *)json){
 NSString *path=[NSTemporaryDirectory() stringByAppendingPathComponent:@"portico-journey.jsonl"];
 if(![NSFileManager.defaultManager fileExistsAtPath:path])[NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
 NSFileHandle *file=[NSFileHandle fileHandleForWritingAtPath:path];[file seekToEndOfFile];[file writeData:[[json stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding]];[file closeFile];
}
#endif
RCT_REMAP_METHOD(loadQueueRecord,loadQueueRecord:(NSString *)key resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.queues",(__bridge id)kSecAttrAccount:key,(__bridge id)kSecReturnData:@YES};CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
 PorticoResolveSecureStorageRead(status,CFBridgingRelease(result),NSNull.null,@"Queue recovery could not be read.",resolve,reject);
}
RCT_REMAP_METHOD(saveQueueRecord,saveQueueRecord:(NSString *)key json:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>262144){reject(@"queue_journal_size",@"Queue recovery is full.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.queues",(__bridge id)kSecAttrAccount:key};NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);
 if(status==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}if(status==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"Queue recovery could not be saved.",nil);
}
RCT_REMAP_METHOD(queueRequest,queueRequest:(NSString *)identifier url:(NSString *)url method:(NSString *)method headers:(NSDictionary *)headers body:(NSString *)body resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 [self boundedRequest:identifier url:url method:method headers:headers body:body fullAPI:NO resolver:resolve rejecter:reject];
}
RCT_REMAP_METHOD(openNetworkStream,openNetworkStream:(NSString *)identifier url:(NSString *)url headers:(NSDictionary *)headers resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 if(![url isKindOfClass:NSString.class]||!url.length||url.length>8192||![identifier isKindOfClass:NSString.class]||!identifier.length||identifier.length>128){reject(@"event_local",@"Invalid event request.",nil);return;}
 NSURL *target=[NSURL URLWithString:url];
 BOOL pathAllowed=[target.path isEqual:@"/v1/notifications/events"]||[target.path rangeOfString:@"^/v1/groups/[A-Za-z0-9_-]{1,128}/events$" options:NSRegularExpressionSearch].location!=NSNotFound;
 if(!target||![@[@"http",@"https"] containsObject:target.scheme]||!target.host.length||target.user||target.password||target.fragment||url.length>8192||!pathAllowed||!identifier.length||identifier.length>128){reject(@"event_local",@"Invalid event request.",nil);return;}
 @synchronized(PorticoEventStream.class){
  if(!PorticoEventStreams)PorticoEventStreams=[NSMutableDictionary dictionary];
  if(PorticoEventStreams.count>=4||PorticoEventStreams[identifier]){reject(@"event_local",@"Too many event streams.",nil);return;}
  PorticoEventStream *stream=[PorticoEventStream new];stream.owner=self;stream.startedAt=NSProcessInfo.processInfo.systemUptime;stream.bytes=[NSMutableData data];stream.opening=resolve;stream.openingReject=reject;
  NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
  configuration.timeoutIntervalForRequest=60;configuration.timeoutIntervalForResource=2100;configuration.HTTPShouldSetCookies=NO;configuration.HTTPCookieStorage=nil;configuration.URLCredentialStorage=nil;configuration.URLCache=nil;configuration.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
  NSOperationQueue *queue=[NSOperationQueue new];queue.maxConcurrentOperationCount=1;
  stream.session=[NSURLSession sessionWithConfiguration:configuration delegate:stream delegateQueue:queue];
  NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:target];request.HTTPMethod=@"GET";
  for(id name in headers)if([name isKindOfClass:NSString.class]&&[headers[name] isKindOfClass:NSString.class])[request setValue:headers[name] forHTTPHeaderField:name];
  stream.task=[stream.session dataTaskWithRequest:request];PorticoEventStreams[identifier]=stream;[stream.task resume];
 }
}
RCT_REMAP_METHOD(readNetworkStream,readNetworkStream:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 PorticoEventStream *stream;@synchronized(PorticoEventStream.class){stream=PorticoEventStreams[identifier];}
 if(!stream){reject(@"event_local",@"The event stream is unavailable.",nil);return;}
 @synchronized(stream){
  if(stream.reading){reject(@"event_local",@"An event read is already pending.",nil);return;}
  stream.reading=resolve;stream.readingReject=reject;[stream deliver];
 }
}
RCT_REMAP_METHOD(cancelNetworkStream,cancelNetworkStream:(NSString *)identifier){
 PorticoEventStream *stream;@synchronized(PorticoEventStream.class){stream=PorticoEventStreams[identifier];[PorticoEventStreams removeObjectForKey:identifier];}
 [stream cancel];
}

RCT_REMAP_METHOD(networkRequest,networkRequest:(NSString *)identifier url:(NSString *)url method:(NSString *)method headers:(NSDictionary *)headers body:(NSString *)body resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 [self boundedRequest:identifier url:url method:method headers:headers body:body fullAPI:YES resolver:resolve rejecter:reject];
}
- (void)boundedRequest:(NSString *)identifier url:(NSString *)url method:(NSString *)method headers:(NSDictionary *)headers body:(NSString *)body fullAPI:(BOOL)fullAPI resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject {

 NSURL *target=[NSURL URLWithString:url];NSData *data=[body dataUsingEncoding:NSUTF8StringEncoding];
 if(!target||![@[@"http",@"https"] containsObject:target.scheme]||target.user.length||target.password.length||target.fragment.length||url.length>8192||(fullAPI ? (![target.path hasPrefix:@"/v1/"]&&![target.path hasPrefix:@"/v2/"]) : (![target.path hasPrefix:@"/v2/"]&&[target.path rangeOfString:@"^/v1/items/[A-Za-z0-9_-]+/playback/[A-Za-z0-9_-]+/subtitles$" options:NSRegularExpressionSearch].location==NSNotFound))||![ (fullAPI ? @[@"GET",@"POST",@"PUT",@"PATCH",@"DELETE",@"HEAD"] : @[@"GET",@"POST",@"PUT"]) containsObject:method]||data.length>1048576||identifier.length>128){reject(@"queue_transport",@"Invalid queue request.",nil);return;}
 PorticoQueueRequest *request=[PorticoQueueRequest new];request.identifier=identifier;request.resolve=resolve;request.reject=reject;request.data=[NSMutableData data];request.owner=self;
 // PERF-S18: API reads that grow with the library (Home rows, queue views, admin pages) get 8 MB;
 // writes and the narrow queue-control surface keep the 1 MB bound.
 request.responseLimit=(fullAPI&&[method isEqualToString:@"GET"])?8388608:1048576;
 NSMutableURLRequest *wire=[NSMutableURLRequest requestWithURL:target];wire.HTTPMethod=method;wire.HTTPBody=data;wire.cachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
 for(id name in headers){if([name isKindOfClass:NSString.class]&&[headers[name] isKindOfClass:NSString.class])[wire setValue:headers[name] forHTTPHeaderField:name];}
 request.wire=wire;[PorticoQueueTransport submit:request domain:@"queue_transport" busy:@"Too many queue requests."];
}
RCT_REMAP_METHOD(profileRequest,profileRequest:(NSString *)identifier url:(NSString *)url method:(NSString *)method headers:(NSDictionary *)headers body:(NSString *)body resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSURL *target=[NSURL URLWithString:url];NSData *data=[body isKindOfClass:NSString.class]?[body dataUsingEncoding:NSUTF8StringEncoding]:nil;BOOL loopback=[@[@"localhost",@"127.0.0.1",@"::1",@"[::1]"]containsObject:target.host];
 if(!target||(![target.scheme isEqual:@"https"]&&!([target.scheme isEqual:@"http"]&&loopback))||target.user.length||target.password.length||target.fragment.length||![target.path hasPrefix:@"/v1/"]||![@[@"GET",@"POST",@"PUT",@"PATCH",@"DELETE"]containsObject:method]||data.length>65536||identifier.length>128){reject(@"profile_transport",@"A secure, bounded profile request is required.",nil);return;}
 PorticoQueueRequest *request=[PorticoQueueRequest new];request.identifier=identifier;request.resolve=resolve;request.reject=reject;request.data=[NSMutableData data];request.owner=self;
 NSMutableURLRequest *wire=[NSMutableURLRequest requestWithURL:target];wire.HTTPMethod=method;wire.HTTPBody=data;wire.cachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
 for(id name in headers){if([name isKindOfClass:NSString.class]&&[headers[name] isKindOfClass:NSString.class])[wire setValue:headers[name] forHTTPHeaderField:name];}
 request.wire=wire;[PorticoQueueTransport submit:request domain:@"profile_transport" busy:@"Too many requests are in progress."];
}

RCT_REMAP_METHOD(cancelQueueRequest,cancelQueueRequest:(NSString *)identifier){
 PorticoQueueRequest *request;@synchronized(PorticoQueueRequest.class){request=PorticoQueueRequests[identifier];}[request finish:@"Queue request cancelled."];
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(playbackRequestId){return NSUUID.UUID.UUIDString;}
RCT_REMAP_METHOD(newRequestId,newRequestIdResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){resolve(NSUUID.UUID.UUIDString);}
// Each PIN attempt, including a failed decrypt, is durably charged before the
// expensive operation. A restart or second React bridge cannot reset the delay.
RCT_REMAP_METHOD(profileInstallation,profileInstallationResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 @synchronized(PorticoRuntime.class){OSStatus e;NSString *value=PorticoProfileInstallation(&e);if(value)resolve(value);else reject(@"secure_storage",@"This device's profile installation could not be read.",nil);}
}
RCT_REMAP_METHOD(saveProfileTrust,saveProfileTrust:(NSString *)scope metadata:(NSString *)metadataJSON payload:(NSString *)payloadJSON pin:(NSString *)pin resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 @synchronized(PorticoRuntime.class){OSStatus e;NSString *key=PorticoProfileRecordKey(scope),*installation=PorticoProfileInstallation(&e);id metadata=PorticoProfileParse([metadataJSON dataUsingEncoding:NSUTF8StringEncoding]);
  if(!key||!installation||!PorticoProfileMetadata(scope,metadata,installation)||!PorticoProfilePIN(pin,[metadata[@"pinRequired"]boolValue])){reject(@"profile_trust_invalid",@"A current, fully scoped selection and its PIN are required to trust this profile.",nil);return;}
  NSArray *index=PorticoProfileActiveIndex(&e);if(!index){reject(@"secure_storage",@"Trusted profiles could not be read.",nil);return;}if(index.count>=64&&![index containsObject:key]){reject(@"profile_trust_full",@"Remove an unused trusted profile before remembering another.",nil);return;}
  NSDictionary *record=PorticoProfileEnvelope(scope,metadataJSON,payloadJSON,pin,&e);if(!record){reject(@"secure_storage",@"The profile proof could not be protected on this device.",nil);return;}
  NSData *old=PorticoProfileRead(key,&e);if(e!=errSecSuccess&&e!=errSecItemNotFound){reject(@"secure_storage",@"The existing profile proof could not be read.",nil);return;}
  e=PorticoProfileWrite(key,PorticoProfileJSON(record));if(e==errSecSuccess&&![index containsObject:key]){NSMutableArray *next=[index mutableCopy];[next addObject:key];e=PorticoProfileWrite(@"index.v1",PorticoProfileJSON(next));}
  if(e!=errSecSuccess){PorticoProfileWrite(key,old);PorticoProfileWrite(@"index.v1",PorticoProfileJSON(index));}
  if(e==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"This profile selection could not be remembered.",nil);
 }
}
RCT_REMAP_METHOD(listProfileTrust,listProfileTrustResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 @synchronized(PorticoRuntime.class){OSStatus e;NSArray *index=PorticoProfileActiveIndex(&e);if(!index){reject(@"secure_storage",@"Trusted profiles could not be read.",nil);return;}NSMutableArray *out=[NSMutableArray array];double now=NSDate.date.timeIntervalSince1970*1000;
  for(NSString *key in index){NSData *raw=PorticoProfileRead(key,&e);if(e==errSecItemNotFound)continue;if(e!=errSecSuccess){reject(@"secure_storage",@"A trusted profile could not be read.",nil);return;}id record=PorticoProfileParse(raw);if(![record isKindOfClass:NSDictionary.class]||!PorticoProfileText(record[@"metadata"],8192)){reject(@"secure_storage",@"A trusted profile record is invalid.",nil);return;}id metadata=PorticoProfileParse([record[@"metadata"]dataUsingEncoding:NSUTF8StringEncoding]);if(![metadata isKindOfClass:NSDictionary.class]){reject(@"secure_storage",@"A trusted profile record is invalid.",nil);return;}if([metadata[@"expiresAtMs"]isKindOfClass:NSNumber.class]&&[metadata[@"expiresAtMs"]doubleValue]>now)[out addObject:metadata];}
  resolve([[NSString alloc]initWithData:PorticoProfileJSON(out) encoding:NSUTF8StringEncoding]);
 }
}
RCT_REMAP_METHOD(unlockProfileTrust,unlockProfileTrust:(NSString *)scope pin:(NSString *)pin resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 @synchronized(PorticoRuntime.class){OSStatus e;NSString *key=PorticoProfileRecordKey(scope);if(!key){reject(@"profile_trust_invalid",@"Choose a previously trusted profile.",nil);return;}id value=PorticoProfileParse(PorticoProfileRead(key,&e));if(e!=errSecSuccess||![value isKindOfClass:NSDictionary.class]){reject(@"profile_trust_missing",@"This profile is not available for offline selection on this device.",nil);return;}NSMutableDictionary *record=[value mutableCopy];if(!PorticoProfileText(record[@"metadata"],8192)||!PorticoProfileAttempts(record)){reject(@"secure_storage",@"The trusted profile record is invalid. Select it online again.",nil);return;}id metadata=PorticoProfileParse([record[@"metadata"]dataUsingEncoding:NSUTF8StringEncoding]);NSString *installation=PorticoProfileInstallation(&e);
  if(!installation||!PorticoProfileMetadata(scope,metadata,installation)){reject(@"profile_trust_expired",@"This trusted profile expired or belongs to another installation. Select it online again.",nil);return;}
  double now=NSDate.date.timeIntervalSince1970;if([record[@"lockedUntil"]doubleValue]>now){reject(@"profile_pin_locked",@"Profile PIN attempts are temporarily locked. Try again later.",nil);return;}
  if(!PorticoProfilePIN(pin,[metadata[@"pinRequired"]boolValue])){reject(@"profile_pin_required",@"Enter this profile's four-digit PIN.",nil);return;}
  NSInteger attempts=MIN(1000,[record[@"attempts"]integerValue]+1);double delay=attempts>=10?900:attempts>=5?300:attempts>=3?30:2;
  record[@"attempts"]=@(attempts);record[@"lockedUntil"]=@(now+delay);e=PorticoProfileWrite(key,PorticoProfileJSON(record));if(e!=errSecSuccess){reject(@"secure_storage",@"The profile unlock attempt could not be saved.",nil);return;}
  NSString *payload=PorticoProfileDecrypt(record,scope,pin,&e);if(!payload){reject(e==errSecAuthFailed?@"profile_pin_required":@"secure_storage",e==errSecAuthFailed?@"That profile PIN is not correct. Try again after the delay.":@"The protected profile proof could not be read.",nil);return;}
  record[@"attempts"]=@0;record[@"lockedUntil"]=@0;e=PorticoProfileWrite(key,PorticoProfileJSON(record));if(e!=errSecSuccess){reject(@"secure_storage",@"The profile unlock could not be saved.",nil);return;}resolve(payload);
 }
}
RCT_REMAP_METHOD(removeProfileTrust,removeProfileTrust:(NSString *)scope resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 @synchronized(PorticoRuntime.class){NSString *key=PorticoProfileRecordKey(scope);if(!key){reject(@"profile_trust_invalid",@"A complete profile scope is required.",nil);return;}OSStatus e=PorticoProfileWrite(key,nil);if(e==errSecSuccess){NSArray *index=PorticoProfileIndex(&e);if(index){NSMutableArray *next=[index mutableCopy];[next removeObject:key];e=PorticoProfileWrite(@"index.v1",PorticoProfileJSON(next));}}if(e==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"The trusted profile could not be removed.",nil);}
}

RCT_REMAP_METHOD(loadSelectedViewer,loadSelectedViewerResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 @synchronized(PorticoRuntime.class){if([NSUserDefaults.standardUserDefaults boolForKey:@"PorticoSelectedViewerQuarantined"]){resolve(NSNull.null);return;}
  NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:@"portico:selected-viewer:v1",(__bridge id)kSecReturnData:@YES};CFTypeRef value=NULL;OSStatus e=SecItemCopyMatching((__bridge CFDictionaryRef)query,&value);PorticoResolveSecureStorageRead(e,CFBridgingRelease(value),NSNull.null,@"The saved server selection could not be read.",resolve,reject);
 }
}
RCT_REMAP_METHOD(saveSelectedViewer,saveSelectedViewer:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 @synchronized(PorticoRuntime.class){BOOL removing=[json isEqual:@"null"];if(removing){[NSUserDefaults.standardUserDefaults setBool:YES forKey:@"PorticoSelectedViewerQuarantined"];[NSUserDefaults.standardUserDefaults synchronize];}
  NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>65536){reject(@"secure_storage",@"The server credential record is invalid.",nil);return;}
  NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:@"portico:selected-viewer:v1"};OSStatus e;
  if(removing){e=SecItemDelete((__bridge CFDictionaryRef)query);if(e==errSecItemNotFound)e=errSecSuccess;}else{NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};e=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);if(e==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];e=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}}
  if(e!=errSecSuccess){reject(@"secure_storage",@"The server credential could not be saved. The account credential is unchanged.",nil);return;}
  NSMutableDictionary *read=[query mutableCopy];read[(__bridge id)kSecReturnData]=@YES;CFTypeRef value=NULL;e=SecItemCopyMatching((__bridge CFDictionaryRef)read,&value);NSData *confirmed=CFBridgingRelease(value);
  if((removing&&e!=errSecItemNotFound)||(!removing&&(e!=errSecSuccess||![confirmed isKindOfClass:NSData.class]||![confirmed isEqualToData:data]))){[NSUserDefaults.standardUserDefaults setBool:YES forKey:@"PorticoSelectedViewerQuarantined"];[NSUserDefaults.standardUserDefaults synchronize];reject(@"secure_storage",@"Server credential storage could not be verified. Sign in to the server again.",nil);return;}
  if(!removing){[NSUserDefaults.standardUserDefaults setBool:NO forKey:@"PorticoSelectedViewerQuarantined"];[NSUserDefaults.standardUserDefaults synchronize];}resolve(@YES);
 }
}

RCT_REMAP_METHOD(loadCredentials,loadCredentials:(NSString *)origin resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:origin,(__bridge id)kSecReturnData:@YES};CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
 PorticoResolveSecureStorageRead(status,CFBridgingRelease(result),NSNull.null,@"Account credentials could not be read.",resolve,reject);
}
RCT_REMAP_METHOD(saveCredentials,saveCredentials:(NSString *)origin json:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>262144){reject(@"credential_size",@"Account credential storage is full.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:origin};NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);if(status==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}if(status==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"Account credentials could not be saved.",nil);
}
RCT_REMAP_METHOD(loadJournal,loadJournal:(NSString *)scope resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.playback",(__bridge id)kSecAttrAccount:scope,(__bridge id)kSecReturnData:@YES};CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
 PorticoResolveSecureStorageRead(status,CFBridgingRelease(result),@"[]",@"Playback recovery could not be read.",resolve,reject);
}
RCT_REMAP_METHOD(saveJournal,saveJournal:(NSString *)scope json:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(data.length>262144){reject(@"journal_size",@"Playback recovery is full.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.playback",(__bridge id)kSecAttrAccount:scope};NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);if(status==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}if(status==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"Playback recovery could not be saved.",nil);
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(playbackRandomBytes:(NSNumber *)count){
 NSInteger n=[count integerValue];if(n<1||n>64)return NSNull.null;uint8_t bytes[64];if(SecRandomCopyBytes(kSecRandomDefault,(size_t)n,bytes)!=errSecSuccess)return NSNull.null;
 NSMutableArray *result=[NSMutableArray new];for(NSInteger i=0;i<n;i++)[result addObject:@(bytes[i])];return result;
}

@end

@interface PorticoBackdropView : UIView @end
@implementation PorticoBackdropView
+ (Class)layerClass{return CAGradientLayer.class;}
- (instancetype)initWithFrame:(CGRect)frame{if((self=[super initWithFrame:frame])){CAGradientLayer *gradient=(CAGradientLayer *)self.layer;gradient.type=kCAGradientLayerRadial;gradient.colors=@[(id)[UIColor colorWithRed:0.075 green:0.18 blue:0.24 alpha:1].CGColor,(id)[UIColor colorWithRed:0.027 green:0.063 blue:0.094 alpha:1].CGColor];gradient.locations=@[@0,@0.74,@1];gradient.colors=@[(id)[UIColor colorWithRed:0.09 green:0.24 blue:0.33 alpha:1].CGColor,(id)[UIColor colorWithRed:0.063 green:0.129 blue:0.176 alpha:1].CGColor,(id)[UIColor colorWithRed:0.027 green:0.063 blue:0.094 alpha:1].CGColor];gradient.startPoint=CGPointMake(.5,-.08);gradient.endPoint=CGPointMake(.92,.44);self.userInteractionEnabled=NO;}return self;}
@end
@interface PorticoBackdropManager : RCTViewManager @end
@implementation PorticoBackdropManager
RCT_EXPORT_MODULE(PorticoBackdrop)
- (UIView *)view{return [PorticoBackdropView new];}
@end
