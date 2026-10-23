#import "PorticoInstallationStorage.h"
#import <React/RCTViewManager.h>
#import <React/RCTBridge.h>
#import <React/RCTBridgeModule.h>
#import <AVFoundation/AVFoundation.h>
#import <AVKit/AVKit.h>
#import <MediaAccessibility/MediaAccessibility.h>
#import <CoreText/CoreText.h>
#import <QuartzCore/QuartzCore.h>
#import <Security/Security.h>
#import "PorticoPlaybackController.h"
#import "PorticoSubtitleSelection.h"
#import "PorticoSubtitleOverlay.h"
#import "PorticoSecureStorageRead.h"
#import "PorticoProfileTrust.h"
#import "PorticoServerTrust.h"
@interface PorticoPlayerView : UIView <AVPictureInPictureControllerDelegate>
@property(nonatomic,copy) NSString *lease;
@property(nonatomic) NSInteger pictureInPictureRequest;
@property(nonatomic,copy) NSDictionary *pictureInPictureBinding;
@property(nonatomic,strong) AVPictureInPictureController *pictureInPicture;
@property(nonatomic,strong) PorticoPlaybackController *controller;
@end
@implementation PorticoPlayerView { AVPlayerLayer *_layer; UILabel *_subtitle; UIImageView *_richSubtitle; CADisplayLink *_subtitleClock; NSDictionary *_activePictureBinding;NSInteger _submittedPictureRequest; }
- (instancetype)initWithFrame:(CGRect)frame {if((self=[super initWithFrame:frame])){self.backgroundColor=UIColor.blackColor;_layer=[AVPlayerLayer playerLayerWithPlayer:nil];_layer.videoGravity=AVLayerVideoGravityResizeAspect;[self.layer addSublayer:_layer];self.clipsToBounds=YES;
 _richSubtitle=[UIImageView new];_richSubtitle.userInteractionEnabled=NO;_richSubtitle.layer.contentsFormat=kCAContentsFormatRGBA8Uint;
 if(@available(iOS 17.0,tvOS 17.0,*))_richSubtitle.preferredImageDynamicRange=UIImageDynamicRangeStandard;
 [self addSubview:_richSubtitle];_subtitle=[UILabel new];_subtitle.textColor=UIColor.whiteColor;_subtitle.backgroundColor=[UIColor colorWithWhite:0 alpha:0.7];_subtitle.textAlignment=NSTextAlignmentCenter;_subtitle.numberOfLines=0;_subtitle.userInteractionEnabled=NO;_subtitle.hidden=YES;_subtitle.isAccessibilityElement=YES;[self addSubview:_subtitle];[[NSNotificationCenter defaultCenter]addObserver:self selector:@selector(updateSubtitle) name:@"PorticoPlaybackSubtitleChanged" object:nil];[_layer addObserver:self forKeyPath:@"readyForDisplay" options:NSKeyValueObservingOptionNew context:NULL];[[NSNotificationCenter defaultCenter]addObserver:self selector:@selector(attachLayer) name:@"PorticoPlaybackAttachmentChanged" object:nil];
 // The viewer's caption style in the device's Accessibility settings is followed as it changes.
 [[NSNotificationCenter defaultCenter]addObserver:self selector:@selector(updateSubtitle) name:(__bridge NSString *)kMACaptionAppearanceSettingsChangedNotification object:nil];}return self;}
- (void)setLease:(NSString *)lease {
 if(_lease==lease||[_lease isEqualToString:lease])return;
 _lease=[lease copy];_richSubtitle.image=nil;[self attachLayer];
}
- (void)setController:(PorticoPlaybackController *)controller {
 if(_controller==controller)return;
 _controller.subtitleOverlay.onImage=nil;_controller=controller;_richSubtitle.image=nil;
 __weak PorticoPlayerView *weakSelf=self;controller.subtitleOverlay.onImage=^(UIImage *image){PorticoPlayerView *v=weakSelf;if(v)v->_richSubtitle.image=(v->_lease.length&&[v->_lease isEqual:v->_controller.lease])?image:nil;};[self attachLayer];
}
- (void)subtitleFrame {
 if(!_lease.length||![_lease isEqual:_controller.lease]||!self.window||!_controller.subtitleOverlay.active){_richSubtitle.image=nil;return;}
 CGRect video=_layer.videoRect;if(CGRectIsEmpty(video))return;CGFloat scale=self.window.screen.scale;
 [_controller.subtitleOverlay renderAtSourceTime:_controller.currentSourcePosition size:CGSizeMake(video.size.width*scale,video.size.height*scale)];
}
- (void)attachLayer {
 BOOL valid=_lease.length&&[_lease isEqual:_controller.lease];
 if(!valid){[self.pictureInPicture stopPictureInPicture];self.pictureInPicture=nil;_richSubtitle.image=nil;}
#if TARGET_OS_TV
 if(!valid)self.window.avDisplayManager.preferredDisplayCriteria=nil;
 else if(self.window)_controller.displayWindow=self.window;
#endif
 AVPlayer *player=valid?_controller.player:nil;
 if(_layer.player!=player){_richSubtitle.image=nil;_layer.player=player;}
 [self updateSubtitle];[self preparePictureInPicture];
}
/** OS-04: the controller exists as soon as a video is attached, so leaving the app (Home swipe)
 * can continue the film in Picture in Picture, as the system's own players do. The system's
 * "Start PiP Automatically" setting still decides. This view stays the controller's only owner. */
- (void)preparePictureInPicture {
 if(![AVPictureInPictureController isPictureInPictureSupported]||!_lease.length||![_lease isEqual:_controller.lease]||!_layer.player)return;
 if(!self.pictureInPicture){self.pictureInPicture=[[AVPictureInPictureController alloc]initWithPlayerLayer:_layer];self.pictureInPicture.delegate=self;}
#if !TARGET_OS_TV
 if(@available(iOS 14.2, *))self.pictureInPicture.canStartPictureInPictureAutomaticallyFromInline=!_controller.subtitleOverlayActive;
#endif
 if(_controller.subtitleOverlayActive&&self.pictureInPicture.isPictureInPictureActive)[self.pictureInPicture stopPictureInPicture];
}
// Reported through the playback module's event channel, not a view event prop: old-style view
// events reach JavaScript through RCTEventEmitter, which a New Architecture production bundle
// never registers, so the first one (PiP "unavailable" on the simulator) crashed the app.
- (void)pictureInPictureChanged:(NSDictionary *)change {NSMutableDictionary *body=[change mutableCopy];body[@"lease"]=_lease?:@"";body[@"binding"]=_activePictureBinding?:_pictureInPictureBinding?:NSNull.null;body[@"requestId"]=@(_submittedPictureRequest);if(_controller.onPictureInPicture)_controller.onPictureInPicture(body);}
- (void)setPictureInPictureRequest:(NSInteger)value {if(value==_pictureInPictureRequest)return;_pictureInPictureRequest=value;
 // React may assign the request counter before its companion binding prop. Settle both
 // on the same main loop, then check the actual source-ready native binding again.
 __weak PorticoPlayerView *weakSelf=self;
 dispatch_async(dispatch_get_main_queue(),^{PorticoPlayerView *view=weakSelf;if(!view||view->_pictureInPictureRequest!=value)return;[view requestPictureInPicture:value];});
}
- (void)requestPictureInPicture:(NSInteger)value {
 _submittedPictureRequest=value;
 NSDictionary *current=_controller.externalPresentationBinding;
 if(![_pictureInPictureBinding isKindOfClass:NSDictionary.class]||!current||![_pictureInPictureBinding isEqual:current]){_activePictureBinding=nil;[self pictureInPictureChanged:@{@"state":@"unavailable"}];return;}
 _activePictureBinding=[current copy];
 // tvOS 14+ supports Picture in Picture from an AVPlayerLayer too (OS-04); the TV player decides
 // whether to offer it. Unsupported hardware answers "unavailable" rather than doing nothing.
 if(![AVPictureInPictureController isPictureInPictureSupported]||!_lease.length||![_lease isEqual:_controller.lease]){[self pictureInPictureChanged:@{@"state":@"unavailable"}];return;}
 if(self.pictureInPicture.isPictureInPictureActive){[self.pictureInPicture stopPictureInPicture];return;}
 // The coupled runtime command must finish the same-session burn/WebVTT replan first.
 // UIKit PiP has no composition path for an app-drawn caption or ASS/bitmap overlay.
 if(_controller.subtitleOverlayActive){[self pictureInPictureChanged:@{@"state":@"unavailable",@"subtitlesCarried":@NO}];return;}
 [self preparePictureInPicture];
 if(self.pictureInPicture.isPictureInPicturePossible)[self.pictureInPicture startPictureInPicture];else [self pictureInPictureChanged:@{@"state":@"unavailable"}];
}
// OS-02: `subtitlesCarried` is NO when the chosen subtitles are drawn by the app, which PiP can't
// show; the player can say so instead of letting them vanish silently.
- (void)pictureInPictureControllerDidStartPictureInPicture:(AVPictureInPictureController *)controller {
 if(_controller.subtitleOverlayActive||![_activePictureBinding isEqual:_controller.externalPresentationBinding]){[controller stopPictureInPicture];[self pictureInPictureChanged:@{@"state":@"unavailable",@"subtitlesCarried":@NO}];return;}
 [self pictureInPictureChanged:@{@"state":@"started",@"subtitlesCarried":@YES}];
}
- (void)pictureInPictureControllerWillStartPictureInPicture:(AVPictureInPictureController *)controller {
 if(!_activePictureBinding){_activePictureBinding=[_controller.externalPresentationBinding copy];_submittedPictureRequest=0;}
}
- (void)pictureInPictureControllerDidStopPictureInPicture:(AVPictureInPictureController *)controller {[self pictureInPictureChanged:@{@"state":@"stopped"}];_activePictureBinding=nil;}
- (void)pictureInPictureController:(AVPictureInPictureController *)controller failedToStartPictureInPictureWithError:(NSError *)error {[self pictureInPictureChanged:@{@"state":@"unavailable"}];_activePictureBinding=nil;}
- (void)pictureInPictureController:(AVPictureInPictureController *)controller restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:(void (^)(BOOL restored))completionHandler {[self pictureInPictureChanged:@{@"state":@"restore"}];completionHandler(YES);}
- (void)updateSubtitle {_subtitle.text=(_lease.length&&[_lease isEqual:_controller.lease])?_controller.subtitleText:@"";_subtitle.hidden=!_subtitle.text.length;[self preparePictureInPicture];[self setNeedsLayout];}
/**
 * The look of the line the app draws: Portico's caption style (the profile's size and background,
 * sent with the subtitle command) on top of the system's. The size the viewer set for captions in
 * Accessibility always multiplies. A colour, background or typeface is taken from the system only
 * where the viewer's style there says it overrides what a video provides; otherwise Portico's.
 */
- (void)styleSubtitle:(CGFloat)base {
 [PorticoSubtitleSelection applyCaptionAppearanceToLabel:_subtitle baseSize:base style:_controller.subtitleStyle italic:[_controller.subtitleCue[@"italic"]boolValue]];
}
- (void)layoutSubviews {
 [super layoutSubviews];
 if(!CGRectEqualToRect(_layer.frame,self.bounds)){
  // The persistent shell owns the single presentation cross-fade. Resize the same
  // aspect-fit layer immediately, without a second implicit Core Animation transition.
  [CATransaction begin];[CATransaction setDisableActions:YES];_layer.frame=self.bounds;[CATransaction commit];
 }
 CGRect video=_layer.videoRect;if(CGRectIsEmpty(video))video=self.bounds;
 _richSubtitle.frame=video;CGFloat width=video.size.width*0.9;
 [self styleSubtitle:MAX(12,MIN(40,video.size.width*0.035))];
 CGSize size=[_subtitle sizeThatFits:CGSizeMake(width,video.size.height*0.6)];CGFloat height=MIN(size.height+8,video.size.height*0.6);
 _subtitle.frame=CGRectMake(CGRectGetMidX(video)-width/2,(([_controller.subtitleCue[@"top"]boolValue]||[_controller.subtitleStyle[@"position"] isEqual:@"top"])?MAX(CGRectGetMinY(video)+8,self.safeAreaInsets.top):CGRectGetMaxY(video)-MAX(8,video.size.height*([_controller.subtitleStyle[@"position"] isEqual:@"raised"]?.20:.08))-height),width,height);
}
// The display is matched to the title by the controller before the title is announced ready
// (it used to be asked for here, at the first frame, when the title was already playing).
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {if(object==_layer&&_layer.readyForDisplay)[_controller displayReadyForLease:_lease];}
- (void)didMoveToWindow {[super didMoveToWindow];
 [_subtitleClock invalidate];_subtitleClock=nil;
 if(self.window){_subtitleClock=[CADisplayLink displayLinkWithTarget:self selector:@selector(subtitleFrame)];[_subtitleClock addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];}
#if TARGET_OS_TV
 if(self.window&&_lease.length&&[_lease isEqual:_controller.lease])_controller.displayWindow=self.window;
#endif
}
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
 [_subtitleClock invalidate];_controller.subtitleOverlay.onImage=nil;[_layer removeObserver:self forKeyPath:@"readyForDisplay"];[[NSNotificationCenter defaultCenter]removeObserver:self];_layer.player=nil;}
@end
@interface PorticoPlayerManager : RCTViewManager @end
@implementation PorticoPlayerManager
RCT_EXPORT_MODULE(PorticoPlayer)
// After a JavaScript reload the new playback module registers itself as the shared controller;
// looking it up through the bridge could hand a new player view the previous, invalidated one.
- (UIView *)view {PorticoPlayerView *view=[PorticoPlayerView new];PorticoPlaybackController *controller=PorticoPlaybackController.shared;if(!controller){id module=[self.bridge moduleForClass:NSClassFromString(@"PorticoPlaybackModule")];controller=[module valueForKey:@"controller"];}view.controller=controller;return view;}
RCT_EXPORT_VIEW_PROPERTY(lease,NSString)
RCT_EXPORT_VIEW_PROPERTY(pictureInPictureRequest,NSInteger)
RCT_EXPORT_VIEW_PROPERTY(pictureInPictureBinding,NSDictionary)
@end
// Queue HTTP requests carry a device proof. Never follow redirects, bypass TLS
// validation, or accumulate an unbounded response. There is no background media
// player here; this is only the bounded JSON control transport.
//
// PERF-04: every request used to open its own NSURLSession, so each API call paid a new TCP
// connection and TLS handshake, and a 17th concurrent request was rejected outright. Now two
// shared, ephemeral, cookie-less, cache-less session (so connections and TLS sessions are
// reused), at most 12 requests in flight and up to 64 waiting, with control work first. The security bounds are
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
@property(nonatomic) BOOL critical;
@property(nonatomic) NSUInteger responseLimit;
/** Set before -finish: when the failure was a refused certificate. */
@property(nonatomic,copy) NSString *failureCode;
- (void)finish:(NSString *)failure;
@end
static NSMutableDictionary<NSString *,PorticoQueueRequest *> *PorticoQueueRequests;
static NSMutableArray<PorticoQueueRequest *> *PorticoQueueWaiting;
static NSInteger PorticoQueueActive, PorticoQueueReads;
static const NSInteger PorticoQueueMaxActive=12;

@interface PorticoQueueTransport : NSObject<NSURLSessionDataDelegate,NSURLSessionTaskDelegate> @end
@implementation PorticoQueueTransport
+ (NSURLSession *)sessionFor:(BOOL)critical {
 static NSURLSession *reads,*writes;static dispatch_once_t once;
 dispatch_once(&once,^{
  // Separate socket pools keep ten slow reads from occupying the control connections.
  for(NSInteger lane=0;lane<2;lane++){
   NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
   configuration.timeoutIntervalForRequest=15;configuration.timeoutIntervalForResource=15;configuration.HTTPShouldSetCookies=NO;configuration.HTTPCookieStorage=nil;configuration.URLCache=nil;configuration.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;configuration.HTTPMaximumConnectionsPerHost=lane?2:10;
   NSOperationQueue *queue=[NSOperationQueue new];queue.maxConcurrentOperationCount=1;queue.name=lane?@"tv.getportico.control":@"tv.getportico.reads";
   NSURLSession *session=[NSURLSession sessionWithConfiguration:configuration delegate:[PorticoQueueTransport new] delegateQueue:queue];
   if(lane)writes=session;else reads=session;
  }
 });
 return critical?writes:reads;
}
/** Caller holds the class lock. */
+ (void)start:(PorticoQueueRequest *)request {
 request.started=YES;PorticoQueueActive++;if(!request.critical)PorticoQueueReads++;
 NSURLSessionDataTask *task=[[self sessionFor:request.critical] dataTaskWithRequest:request.wire];request.task=task;
 task.taskDescription=request.identifier;
 [task resume];
}
/** Caller holds the class lock. Two slots and eight waiting places are reserved for writes. */
+ (void)pump {
 while(PorticoQueueActive<PorticoQueueMaxActive&&PorticoQueueWaiting.count){
  NSUInteger index=[PorticoQueueWaiting indexOfObjectPassingTest:^BOOL(PorticoQueueRequest *r,NSUInteger i,BOOL *stop){return r.critical;}];
  if(index==NSNotFound){if(PorticoQueueReads>=10)break;index=0;}
  PorticoQueueRequest *next=PorticoQueueWaiting[index];[PorticoQueueWaiting removeObjectAtIndex:index];[self start:next];
 }
}
+ (void)submit:(PorticoQueueRequest *)request domain:(NSString *)domain busy:(NSString *)busy {
 @synchronized(PorticoQueueRequest.class){
  if(!PorticoQueueRequests)PorticoQueueRequests=[NSMutableDictionary dictionary];if(!PorticoQueueWaiting)PorticoQueueWaiting=[NSMutableArray array];
  request.critical=![@[@"GET",@"HEAD"] containsObject:request.wire.HTTPMethod];
  NSUInteger reads=0;for(PorticoQueueRequest *r in PorticoQueueRequests.allValues)if(!r.critical)reads++;
  if(PorticoQueueRequests[request.identifier]||PorticoQueueRequests.count>=76||(!request.critical&&reads>=66)){request.reject(domain,busy,nil);return;}
  PorticoQueueRequests[request.identifier]=request;[PorticoQueueWaiting addObject:request];[self pump];
  // Include queue residence in the operation's deadline. Cancellation releases admission once.
  NSTimeInterval timeout=request.wire.timeoutInterval;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,(int64_t)(timeout*NSEC_PER_SEC)),dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{@synchronized(request){if(!request.completed)request.failureCode=@"timeout";}[request finish:@"The request took too long."];});
 }
}
/** Caller holds the class lock. */
+ (void)release:(PorticoQueueRequest *)request {
 if(PorticoQueueRequests[request.identifier]==request)[PorticoQueueRequests removeObjectForKey:request.identifier];
 if(!request.started){[PorticoQueueWaiting removeObjectIdenticalTo:request];return;}
 PorticoQueueActive=MAX(0,PorticoQueueActive-1);if(!request.critical)PorticoQueueReads=MAX(0,PorticoQueueReads-1);
 [self pump];
}
+ (void)cancelOwnedBy:(id)owner {
 NSArray<PorticoQueueRequest *> *owned;
 @synchronized(PorticoQueueRequest.class){owned=[PorticoQueueRequests.allValues filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(PorticoQueueRequest *r,NSDictionary *b){return r.owner==owner||r.owner==nil;}]];}
 for(PorticoQueueRequest *request in owned)[request finish:@"The app reloaded."];
}
- (PorticoQueueRequest *)requestFor:(NSURLSessionTask *)task {@synchronized(PorticoQueueRequest.class){PorticoQueueRequest *request=PorticoQueueRequests[task.taskDescription];return request.task==task?request:nil;}}
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
- (void)URLSession:(NSURLSession *)session didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completionHandler {
 [PorticoServerTrust handleChallenge:challenge completion:completionHandler];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
 PorticoQueueRequest *request=[self requestFor:task];
 if([PorticoServerTrust isRefusal:error]){request.failureCode=@"certificate_untrusted";[request finish:@"The server's certificate is not trusted yet."];return;}
 // What the failure means to the person, as Android reports it: no answer in time, or nothing reached
 // the server. Anything else keeps the transport's own code (a write's outcome stays unknown).
 if([error.domain isEqualToString:NSURLErrorDomain])switch(error.code){
  case NSURLErrorTimedOut:request.failureCode=@"timeout";[request finish:@"The request took too long."];return;
  case NSURLErrorCannotFindHost:case NSURLErrorCannotConnectToHost:case NSURLErrorDNSLookupFailed:case NSURLErrorNotConnectedToInternet:
   request.failureCode=@"network";[request finish:@"The server could not be reached."];return;
  default:break;
 }
 [request finish:error?@"The queue request could not be confirmed.":nil];
}
@end

@implementation PorticoQueueRequest
- (void)finish:(NSString *)failure {
 @synchronized(self) {if(self.completed)return;self.completed=YES;
 if(self.task.state==NSURLSessionTaskStateRunning||self.task.state==NSURLSessionTaskStateSuspended)[self.task cancel];
 @synchronized(PorticoQueueRequest.class){[PorticoQueueTransport release:self];}
 if(failure){self.reject(self.failureCode?:@"queue_transport",failure,nil);}else{
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
- (void)URLSession:(NSURLSession *)session didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completionHandler {
 [PorticoServerTrust handleChallenge:challenge completion:completionHandler];
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
  // A time-out before the response has begun is a route that does not answer: route evidence, as
  // it is for an ordinary request. Only an open stream that goes quiet is an idle time-out.
  self.failureCode=[error.domain isEqual:NSURLErrorDomain]&&error.code==NSURLErrorTimedOut?(self.openingReject?@"event_transport":@"event_timeout"):([error.domain isEqual:NSURLErrorDomain]&&error.code==NSURLErrorCancelled?@"event_cancelled":@"event_transport");
  if(self.openingReject)self.openingReject(self.failureCode,@"The event connection could not be opened.",nil);
  self.opening=nil;self.openingReject=nil;[self deliver];[self.session finishTasksAndInvalidate];
 }
}
@end

// Keychain and PIN derivation never hold up API request submission. One queue also keeps
// storage operations ordered across React bridge replacements.
static dispatch_queue_t PorticoStorageQueue(void) {
 static dispatch_queue_t queue;static dispatch_once_t once;
 dispatch_once(&once,^{queue=dispatch_queue_create("tv.getportico.storage",DISPATCH_QUEUE_SERIAL);});
 return queue;
}

static OSStatus PorticoPrepareInstallationStorage(void) {
 BOOL available=YES;
#if !TARGET_OS_TV
 __block BOOL unlocked=NO;
 if(NSThread.isMainThread)unlocked=UIApplication.sharedApplication.isProtectedDataAvailable;
 else dispatch_sync(dispatch_get_main_queue(),^{unlocked=UIApplication.sharedApplication.isProtectedDataAvailable;});
 available=unlocked;
#endif
 return PorticoPrepareInstallation(NSUserDefaults.standardUserDefaults, available, ^OSStatus(NSString *service){
  return SecItemDelete((__bridge CFDictionaryRef)@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:service});
 });
}

// HttpLocalApi's avatar upload is JSON only across the JS/native bridge. Decode at this
// fixed endpoint so the existing redirect-refusing transport sends the original image bytes.
static BOOL PorticoAvatarUploadPath(NSString *path, NSString *method) {
 return [method isEqualToString:@"POST"]&&[path rangeOfString:@"^/v1/direct/profiles/[A-Za-z0-9_-]{1,128}/avatar$" options:NSRegularExpressionSearch].location!=NSNotFound;
}
static NSData *PorticoAvatarUploadBody(NSString *body) {
 if(![body isKindOfClass:NSString.class]||body.length>5592448)return nil;
 id envelope=[NSJSONSerialization JSONObjectWithData:[body dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
 if(![envelope isKindOfClass:NSDictionary.class]||[envelope count]!=1||![envelope[@"nativeAvatarBase64"] isKindOfClass:NSString.class])return nil;
 NSData *data=[[NSData alloc]initWithBase64EncodedString:envelope[@"nativeAvatarBase64"] options:0];
 return data.length>0&&data.length<=4194304?data:nil;
}
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
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}

 // Keychain records do not depend on a separate app-held sealing key.
 resolve(@NO);

 });
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
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.queues",(__bridge id)kSecAttrAccount:key,(__bridge id)kSecReturnData:@YES};CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
 id stored=CFBridgingRelease(result);
 // The Keychain returned the item, but its bytes are not text: not a record this app wrote, and
 // waiting will not mend it. That is `secure_record_damaged` (the Android runtime's code too).
 // Every Keychain failure, a locked device before first unlock included, stays `secure_storage`.
 if(status==errSecSuccess&&[stored isKindOfClass:NSData.class]&&![[NSString alloc] initWithData:stored encoding:NSUTF8StringEncoding]){reject(@"secure_record_damaged",@"Queue recovery could not be read.",nil);return;}
 PorticoResolveSecureStorageRead(status,stored,NSNull.null,@"Queue recovery could not be read.",resolve,reject);
 });
}
RCT_REMAP_METHOD(saveQueueRecord,saveQueueRecord:(NSString *)key json:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>262144){reject(@"queue_journal_size",@"Queue recovery is full.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.queues",(__bridge id)kSecAttrAccount:key};NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);
 if(status==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}if(status==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"Queue recovery could not be saved.",nil);
 });
}
RCT_REMAP_METHOD(queueRequest,queueRequest:(NSString *)identifier url:(NSString *)url method:(NSString *)method headers:(NSDictionary *)headers body:(NSString *)body resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 [self boundedRequest:identifier url:url method:method headers:headers body:body fullAPI:NO resolver:resolve rejecter:reject];
}
RCT_REMAP_METHOD(openNetworkStream,openNetworkStream:(NSString *)identifier url:(NSString *)url headers:(NSDictionary *)headers resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 if(![url isKindOfClass:NSString.class]||!url.length||url.length>8192||![identifier isKindOfClass:NSString.class]||!identifier.length||identifier.length>128){reject(@"event_local",@"Invalid event request.",nil);return;}
 NSURL *target=[NSURL URLWithString:url];
 BOOL pathAllowed=[target.path isEqual:@"/v1/events"]||[target.path rangeOfString:@"^/v1/groups/[A-Za-z0-9_-]{1,128}/events$" options:NSRegularExpressionSearch].location!=NSNotFound;
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

 NSURL *target=[NSURL URLWithString:url];BOOL avatar=PorticoAvatarUploadPath(target.path,method);NSData *data=avatar?PorticoAvatarUploadBody(body):[body dataUsingEncoding:NSUTF8StringEncoding];
 if(!target||![@[@"http",@"https"] containsObject:target.scheme]||target.user.length||target.password.length||target.fragment.length||url.length>8192||(fullAPI ? (![target.path hasPrefix:@"/v1/"]&&![target.path hasPrefix:@"/v2/"]) : (![target.path hasPrefix:@"/v2/"]&&[target.path rangeOfString:@"^/v1/items/[A-Za-z0-9_-]+/playback/[A-Za-z0-9_-]+/subtitles$" options:NSRegularExpressionSearch].location==NSNotFound))||![ (fullAPI ? @[@"GET",@"POST",@"PUT",@"PATCH",@"DELETE",@"HEAD"] : @[@"GET",@"POST",@"PUT"]) containsObject:method]||(avatar?!data:data.length>1048576)||identifier.length>128){reject(@"queue_transport",@"Invalid queue request.",nil);return;}
 PorticoQueueRequest *request=[PorticoQueueRequest new];request.identifier=identifier;request.resolve=resolve;request.reject=reject;request.data=[NSMutableData data];request.owner=self;
 // PERF-S18: API reads that grow with the library (Home rows, queue views, admin pages) get 8 MB;
 // writes and the narrow queue-control surface keep the 1 MB bound.
 request.responseLimit=(fullAPI&&[method isEqualToString:@"GET"])?8388608:1048576;
 NSMutableURLRequest *wire=[NSMutableURLRequest requestWithURL:target];wire.HTTPMethod=method;wire.HTTPBody=data;wire.cachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
 for(id name in headers){if([name isKindOfClass:NSString.class]&&[headers[name] isKindOfClass:NSString.class])[wire setValue:headers[name] forHTTPHeaderField:name];}
 request.wire=wire;[PorticoQueueTransport submit:request domain:@"queue_transport" busy:@"Too many queue requests."];
}
RCT_REMAP_METHOD(profileRequest,profileRequest:(NSString *)identifier url:(NSString *)url method:(NSString *)method headers:(NSDictionary *)headers body:(NSString *)body resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 NSURL *target=[NSURL URLWithString:url];BOOL avatar=PorticoAvatarUploadPath(target.path,method);NSData *data=avatar?PorticoAvatarUploadBody(body):([body isKindOfClass:NSString.class]?[body dataUsingEncoding:NSUTF8StringEncoding]:nil);
 if(!target||![@[@"https",@"http"] containsObject:target.scheme]||!target.host.length||target.user||target.password||target.fragment||url.length>8192||!identifier.length||![target.path hasPrefix:@"/v1/"]||![@[@"GET",@"POST",@"PUT",@"PATCH",@"DELETE"]containsObject:method]||(avatar?!data:data.length>65536)||identifier.length>128){reject(@"profile_transport",@"A bounded profile request is required.",nil);return;}
 PorticoQueueRequest *request=[PorticoQueueRequest new];request.identifier=identifier;request.resolve=resolve;request.reject=reject;request.data=[NSMutableData data];request.owner=self;
 NSMutableURLRequest *wire=[NSMutableURLRequest requestWithURL:target];wire.HTTPMethod=method;wire.HTTPBody=data;wire.cachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
 for(id name in headers){if([name isKindOfClass:NSString.class]&&[headers[name] isKindOfClass:NSString.class])[wire setValue:headers[name] forHTTPHeaderField:name];}
 request.wire=wire;[PorticoQueueTransport submit:request domain:@"profile_transport" busy:@"Too many requests are in progress."];
}

RCT_REMAP_METHOD(cancelQueueRequest,cancelQueueRequest:(NSString *)identifier){
 PorticoQueueRequest *request;@synchronized(PorticoQueueRequest.class){request=PorticoQueueRequests[identifier];}@synchronized(request){if(!request.completed)request.failureCode=@"cancelled";}[request finish:@"Queue request cancelled."];
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(playbackRequestId){return NSUUID.UUID.UUIDString;}
RCT_REMAP_METHOD(newRequestId,newRequestIdResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){resolve(NSUUID.UUID.UUIDString);}
// Each PIN attempt, including a failed decrypt, is durably charged before the
// expensive operation. A restart or second React bridge cannot reset the delay.
RCT_REMAP_METHOD(profileInstallation,profileInstallationResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 @synchronized(PorticoRuntime.class){OSStatus e;NSString *value=PorticoProfileInstallation(&e);if(value)resolve(value);else reject(@"secure_storage",@"This device's profile installation could not be read.",nil);}
 });
}
RCT_REMAP_METHOD(saveProfileTrust,saveProfileTrust:(NSString *)scope metadata:(NSString *)metadataJSON payload:(NSString *)payloadJSON pin:(NSString *)pin resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 @synchronized(PorticoRuntime.class){OSStatus e;NSString *key=PorticoProfileRecordKey(scope),*installation=PorticoProfileInstallation(&e);id metadata=PorticoProfileParse([metadataJSON dataUsingEncoding:NSUTF8StringEncoding]);
  if(!key||!installation||!PorticoProfileMetadata(scope,metadata,installation)||!PorticoProfilePIN(pin,[metadata[@"pinRequired"]boolValue])){reject(@"profile_trust_invalid",@"A current, fully scoped selection and its PIN are required to trust this profile.",nil);return;}
  NSArray *index=PorticoProfileActiveIndex(&e);if(!index){reject(@"secure_storage",@"Trusted profiles could not be read.",nil);return;}if(index.count>=64&&![index containsObject:key]){reject(@"profile_trust_full",@"Remove an unused trusted profile before remembering another.",nil);return;}
  NSDictionary *record=PorticoProfileEnvelope(scope,metadataJSON,payloadJSON,pin,&e);if(!record){reject(@"secure_storage",@"The profile proof could not be protected on this device.",nil);return;}
  NSData *old=PorticoProfileRead(key,&e);if(e!=errSecSuccess&&e!=errSecItemNotFound){reject(@"secure_storage",@"The existing profile proof could not be read.",nil);return;}
  e=PorticoProfileWrite(key,PorticoProfileJSON(record));if(e==errSecSuccess&&![index containsObject:key]){NSMutableArray *next=[index mutableCopy];[next addObject:key];e=PorticoProfileWrite(@"index.v1",PorticoProfileJSON(next));}
  if(e!=errSecSuccess){PorticoProfileWrite(key,old);PorticoProfileWrite(@"index.v1",PorticoProfileJSON(index));}
  if(e==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"This profile selection could not be remembered.",nil);
 }
 });
}
RCT_REMAP_METHOD(listProfileTrust,listProfileTrustResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 @synchronized(PorticoRuntime.class){OSStatus e;NSArray *index=PorticoProfileActiveIndex(&e);if(!index){reject(@"secure_storage",@"Trusted profiles could not be read.",nil);return;}NSMutableArray *out=[NSMutableArray array];double now=NSDate.date.timeIntervalSince1970*1000;
  for(NSString *key in index){NSData *raw=PorticoProfileRead(key,&e);if(e==errSecItemNotFound)continue;if(e!=errSecSuccess){reject(@"secure_storage",@"A trusted profile could not be read.",nil);return;}id record=PorticoProfileParse(raw);if(![record isKindOfClass:NSDictionary.class]||!PorticoProfileText(record[@"metadata"],8192)){reject(@"secure_storage",@"A trusted profile record is invalid.",nil);return;}id metadata=PorticoProfileParse([record[@"metadata"]dataUsingEncoding:NSUTF8StringEncoding]);if(![metadata isKindOfClass:NSDictionary.class]){reject(@"secure_storage",@"A trusted profile record is invalid.",nil);return;}if([metadata[@"expiresAtMs"]isKindOfClass:NSNumber.class]&&[metadata[@"expiresAtMs"]doubleValue]>now)[out addObject:metadata];}
  resolve([[NSString alloc]initWithData:PorticoProfileJSON(out) encoding:NSUTF8StringEncoding]);
 }
 });
}
RCT_REMAP_METHOD(unlockProfileTrust,unlockProfileTrust:(NSString *)scope pin:(NSString *)pin resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 @synchronized(PorticoRuntime.class){OSStatus e;NSString *key=PorticoProfileRecordKey(scope);if(!key){reject(@"profile_trust_invalid",@"Choose a previously trusted profile.",nil);return;}id value=PorticoProfileParse(PorticoProfileRead(key,&e));if(e!=errSecSuccess||![value isKindOfClass:NSDictionary.class]){reject(@"profile_trust_missing",@"This profile is not available for offline selection on this device.",nil);return;}NSMutableDictionary *record=[value mutableCopy];if(!PorticoProfileText(record[@"metadata"],8192)||!PorticoProfileAttempts(record)){reject(@"secure_storage",@"The trusted profile record is invalid. Select it online again.",nil);return;}id metadata=PorticoProfileParse([record[@"metadata"]dataUsingEncoding:NSUTF8StringEncoding]);NSString *installation=PorticoProfileInstallation(&e);
  if(!installation||!PorticoProfileMetadata(scope,metadata,installation)){reject(@"profile_trust_expired",@"This trusted profile expired or belongs to another installation. Select it online again.",nil);return;}
  double now=NSDate.date.timeIntervalSince1970;if([record[@"lockedUntil"]doubleValue]>now){reject(@"profile_pin_locked",@"Profile PIN attempts are temporarily locked. Try again later.",nil);return;}
  if(!PorticoProfilePIN(pin,[metadata[@"pinRequired"]boolValue])){reject(@"profile_pin_required",@"Enter this profile's four-digit PIN.",nil);return;}
  NSInteger attempts=MIN(1000,[record[@"attempts"]integerValue]+1);double delay=attempts>=10?900:attempts>=5?300:attempts>=3?30:2;
  record[@"attempts"]=@(attempts);record[@"lockedUntil"]=@(now+delay);e=PorticoProfileWrite(key,PorticoProfileJSON(record));if(e!=errSecSuccess){reject(@"secure_storage",@"The profile unlock attempt could not be saved.",nil);return;}
  NSString *payload=PorticoProfileDecrypt(record,scope,pin,&e);if(!payload){reject(e==errSecAuthFailed?@"profile_pin_required":@"secure_storage",e==errSecAuthFailed?@"That profile PIN is not correct. Try again after the delay.":@"The protected profile proof could not be read.",nil);return;}
  record[@"attempts"]=@0;record[@"lockedUntil"]=@0;e=PorticoProfileWrite(key,PorticoProfileJSON(record));if(e!=errSecSuccess){reject(@"secure_storage",@"The profile unlock could not be saved.",nil);return;}resolve(payload);
 }
 });
}
RCT_REMAP_METHOD(removeProfileTrust,removeProfileTrust:(NSString *)scope resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 @synchronized(PorticoRuntime.class){NSString *key=PorticoProfileRecordKey(scope);if(!key){reject(@"profile_trust_invalid",@"A complete profile scope is required.",nil);return;}OSStatus e=PorticoProfileWrite(key,nil);if(e==errSecSuccess){NSArray *index=PorticoProfileIndex(&e);if(index){NSMutableArray *next=[index mutableCopy];[next removeObject:key];e=PorticoProfileWrite(@"index.v1",PorticoProfileJSON(next));}}if(e==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"The trusted profile could not be removed.",nil);}
 });
}

RCT_REMAP_METHOD(loadSelectedViewer,loadSelectedViewerResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 @synchronized(PorticoRuntime.class){if([NSUserDefaults.standardUserDefaults boolForKey:@"PorticoSelectedViewerQuarantined"]){resolve(NSNull.null);return;}
  NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:@"portico:selected-viewer:v1",(__bridge id)kSecReturnData:@YES};CFTypeRef value=NULL;OSStatus e=SecItemCopyMatching((__bridge CFDictionaryRef)query,&value);PorticoResolveSecureStorageRead(e,CFBridgingRelease(value),NSNull.null,@"The saved server selection could not be read.",resolve,reject);
 }
 });
}
RCT_REMAP_METHOD(saveSelectedViewer,saveSelectedViewer:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 @synchronized(PorticoRuntime.class){BOOL removing=[json isEqual:@"null"];if(removing){[NSUserDefaults.standardUserDefaults setBool:YES forKey:@"PorticoSelectedViewerQuarantined"];[NSUserDefaults.standardUserDefaults synchronize];}
  NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>65536){reject(@"secure_storage",@"The server credential record is invalid.",nil);return;}
  NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:@"portico:selected-viewer:v1"};OSStatus e;
  if(removing){e=SecItemDelete((__bridge CFDictionaryRef)query);if(e==errSecItemNotFound)e=errSecSuccess;}else{NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};e=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);if(e==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];e=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}}
  if(e!=errSecSuccess){reject(@"secure_storage",@"The server credential could not be saved. The account credential is unchanged.",nil);return;}
  NSMutableDictionary *read=[query mutableCopy];read[(__bridge id)kSecReturnData]=@YES;CFTypeRef value=NULL;e=SecItemCopyMatching((__bridge CFDictionaryRef)read,&value);NSData *confirmed=CFBridgingRelease(value);
  if((removing&&e!=errSecItemNotFound)||(!removing&&(e!=errSecSuccess||![confirmed isKindOfClass:NSData.class]||![confirmed isEqualToData:data]))){[NSUserDefaults.standardUserDefaults setBool:YES forKey:@"PorticoSelectedViewerQuarantined"];[NSUserDefaults.standardUserDefaults synchronize];reject(@"secure_storage",@"Server credential storage could not be verified. Sign in to the server again.",nil);return;}
  if(!removing){[NSUserDefaults.standardUserDefaults setBool:NO forKey:@"PorticoSelectedViewerQuarantined"];[NSUserDefaults.standardUserDefaults synchronize];}resolve(@YES);
 }
 });
}

RCT_REMAP_METHOD(loadCredentials,loadCredentials:(NSString *)origin resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:origin,(__bridge id)kSecReturnData:@YES};CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
 PorticoResolveSecureStorageRead(status,CFBridgingRelease(result),NSNull.null,@"Account credentials could not be read.",resolve,reject);
 });
}
RCT_REMAP_METHOD(saveCredentials,saveCredentials:(NSString *)origin json:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(!data||data.length>262144){reject(@"credential_size",@"Account credential storage is full.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.credentials",(__bridge id)kSecAttrAccount:origin};NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);if(status==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}if(status==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"Account credentials could not be saved.",nil);
 });
}
RCT_REMAP_METHOD(loadJournal,loadJournal:(NSString *)scope resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.playback",(__bridge id)kSecAttrAccount:scope,(__bridge id)kSecReturnData:@YES};CFTypeRef result=NULL;OSStatus status=SecItemCopyMatching((__bridge CFDictionaryRef)query,&result);
 PorticoResolveSecureStorageRead(status,CFBridgingRelease(result),@"[]",@"Playback recovery could not be read.",resolve,reject);
 });
}
RCT_REMAP_METHOD(saveJournal,saveJournal:(NSString *)scope json:(NSString *)json resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject){
 dispatch_async(PorticoStorageQueue(), ^{
 if(PorticoPrepareInstallationStorage()!=errSecSuccess){reject(@"secure_storage",@"This installation’s saved records could not be prepared.",nil);return;}
 NSData *data=[json dataUsingEncoding:NSUTF8StringEncoding];if(data.length>262144){reject(@"journal_size",@"Playback recovery is full.",nil);return;}
 NSDictionary *query=@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:@"tv.getportico.portico.playback",(__bridge id)kSecAttrAccount:scope};NSDictionary *attributes=@{(__bridge id)kSecValueData:data,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)attributes);if(status==errSecItemNotFound){NSMutableDictionary *insert=[query mutableCopy];[insert addEntriesFromDictionary:attributes];status=SecItemAdd((__bridge CFDictionaryRef)insert,NULL);}if(status==errSecSuccess)resolve(@YES);else reject(@"secure_storage",@"Playback recovery could not be saved.",nil);
 });
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
