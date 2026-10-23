#import <UIKit/UIKit.h>
#import <React/RCTViewManager.h>
#import <React/UIView+React.h>
#import <objc/runtime.h>
#import "../Native/PorticoPlayerView.h"
#import "../Native/PorticoPlaybackController.h"
#import "../Native/PorticoVideoSnapshot.h"
#import "../Native/PorticoServerTrust.h"

// Bridge registration/tag storage only. The production view, controller, AVPlayer, output,
// clock, frame conversion, private file ownership and cleanup run without media mocks.
void RCTRegisterModule(Class moduleClass) {}
@implementation RCTViewManager
@synthesize bridge=_bridge;
+ (NSString *)moduleName {return @"HarnessViewManager";}
@end
@implementation UIView (PorticoSnapshotHarnessTag)
- (NSNumber *)reactTag {return objc_getAssociatedObject(self,@selector(reactTag));}
- (void)setReactTag:(NSNumber *)tag {objc_setAssociatedObject(self,@selector(reactTag),tag,OBJC_ASSOCIATION_RETAIN_NONATOMIC);}
@end
@implementation PorticoServerTrust
+ (id<AVAssetResourceLoaderDelegate>)resourceLoaderDelegate {return nil;}
+ (dispatch_queue_t)resourceLoaderQueue {return dispatch_get_main_queue();}
+ (void)handleChallenge:(NSURLAuthenticationChallenge *)challenge completion:(void (^)(NSURLSessionAuthChallengeDisposition,NSURLCredential *))completion {completion(NSURLSessionAuthChallengeCancelAuthenticationChallenge,nil);}
@end
@interface PorticoVideoSnapshot : NSObject
- (void)capture:(NSString *)identifier source:(NSDictionary *)source resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)release:(NSString *)identifier resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)invalidate;
@end
static BOOL expect(BOOL value,const char *what){if(!value)fprintf(stderr,"FAIL %s\n",what);return value;}
static BOOL waitFor(BOOL (^ready)(void),double seconds){NSDate *until=[NSDate dateWithTimeIntervalSinceNow:seconds];while(!ready()&&until.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];return ready();}
static NSDictionary *capture(PorticoVideoSnapshot *module,NSString *identifier,NSDictionary *source,NSString *__strong *failure){
 __block BOOL done=NO;__block NSDictionary *result=nil;__block NSString *code=nil;
 [module capture:identifier source:source resolver:^(id value){result=value;done=YES;} rejecter:^(NSString *value,NSString *message,NSError *error){code=value;done=YES;}];
 if(!waitFor(^BOOL{return done;},3))code=@"harness_timeout";if(failure)*failure=code;return result;
}
static BOOL release(PorticoVideoSnapshot *module,NSString *identifier){__block BOOL released=NO;[module release:identifier resolver:^(id value){released=[value boolValue];} rejecter:^(NSString *code,NSString *message,NSError *error){}];return released;}
static NSString *receiptPath(NSDictionary *receipt){return [receipt[@"uri"]isKindOfClass:NSString.class]?[NSURL URLWithString:receipt[@"uri"]].path?:@"":@"";}
static NSArray<NSNumber *> *pixel(NSDictionary *receipt){
 UIImage *image=[UIImage imageWithContentsOfFile:receiptPath(receipt)];if(!image.CGImage)return @[];
 uint8_t bytes[4]={0};CGColorSpaceRef colors=CGColorSpaceCreateDeviceRGB();CGContextRef context=CGBitmapContextCreate(bytes,1,1,8,4,colors,kCGImageAlphaPremultipliedLast|kCGBitmapByteOrder32Big);CGContextDrawImage(context,CGRectMake(0,0,1,1),image.CGImage);CGContextRelease(context);CGColorSpaceRelease(colors);return @[@(bytes[0]),@(bytes[1]),@(bytes[2])];
}
static int runTests(UIWindow *window){@autoreleasepool{
 BOOL ok=YES;NSFileManager *files=NSFileManager.defaultManager;
 NSURL *downloads=[[files URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"Downloads" isDirectory:YES];[files createDirectoryAtURL:downloads withIntermediateDirectories:YES attributes:nil error:nil];NSURL *local=[downloads URLByAppendingPathComponent:@"snapshot-authored.mp4"];
 [files removeItemAtURL:local error:nil];ok=expect([files copyItemAtURL:[NSBundle.mainBundle URLForResource:@"snapshot-red-blue" withExtension:@"mp4"] toURL:local error:nil],"copy authored video to authorized local Downloads")&&ok;
 PorticoPlaybackController *controller=[PorticoPlaybackController new];NSDictionary *lease=[controller acquire:@"snapshot-fixture"];
 NSDictionary *binding=@{@"lease":lease[@"lease"],@"intentId":@1,@"sessionId":@"snapshot-session",@"generation":@1,@"itemId":@"authored-video"};
 PorticoPlayerView *view=[[PorticoPlayerView alloc]initWithFrame:CGRectMake(0,0,320,180)];view.reactTag=@42;view.controller=controller;view.lease=lease[@"lease"];[window.rootViewController.view addSubview:view];[view layoutIfNeeded];
 NSDictionary *command=@{@"binding":binding,@"commandRevision":@1,@"source":local.absoluteString,@"rate":@1,@"paused":@NO};NSString *rejection=[controller acceptCommand:command];
 ok=expect(!rejection,"actual public controller accepts valid local command")&&ok;
 ok=expect(waitFor(^BOOL{return controller.externalPresentationBinding&&controller.currentSourcePosition>.25;},12),"actual AVPlayer ready and source clock advances")&&ok;
 if(!ok){fprintf(stderr,"ready=%s position=%f error=%s\n",controller.externalPresentationBinding.description.UTF8String,controller.currentSourcePosition,controller.player.currentItem.error.description.UTF8String);[controller invalidate];return 1;}
 AVPlayer *player=controller.player;AVPlayerItem *item=player.currentItem;AVPlayerLayer *layer=(AVPlayerLayer *)view.layer.sublayers.firstObject;
 NSDictionary *source=@{@"reactTag":@42,@"engine":@"native",@"lease":lease[@"lease"],@"binding":@{@"intentId":@1,@"sessionId":@"snapshot-session",@"generation":@1,@"itemId":@"authored-video"}};
 PorticoVideoSnapshot *module=[PorticoVideoSnapshot new];__block NSString *failure=nil;__block NSDictionary *red=nil;
 ok=expect(waitFor(^BOOL{red=capture(module,@"before-bounds",source,&failure);return red!=nil;},1),"actual decoded red frame captured")&&ok;
 NSArray *redPixel=pixel(red);ok=expect(redPixel.count==3&&[redPixel[0]intValue]>180&&[redPixel[2]intValue]<60,"decoded JPEG contains authored red pixels")&&ok;
 NSString *redPath=receiptPath(red);double before=controller.currentSourcePosition;
 view.bounds=CGRectZero;view.hidden=YES;[view layoutIfNeeded];
 ok=expect(PorticoSnapshotController(@42,lease[@"lease"])==controller&&layer.player==player&&player.currentItem==item,"zero bounds retains exact view/controller/player/item/lease")&&ok;
 ok=expect([files fileExistsAtPath:redPath],"retained real JPEG survives geometry-only invalidation")&&ok;
 ok=expect(waitFor(^BOOL{return controller.currentSourcePosition>2.25;},5),"decoded timeline advances while bounds missing")&&ok;
 ok=expect(release(module,@"before-bounds")&&![files fileExistsAtPath:redPath],"release removes retained private JPEG")&&ok;
 NSDictionary *blue=capture(module,@"missing-bounds",source,&failure);NSArray *bluePixel=pixel(blue);double during=controller.currentSourcePosition;
 ok=expect(blue&&bluePixel.count==3&&[bluePixel[2]intValue]>180&&[bluePixel[0]intValue]<60,"fresh actual blue frame captured with zero bounds")&&ok;
 NSString *bluePath=receiptPath(blue);
 view.hidden=NO;view.bounds=CGRectMake(0,0,320,180);[view layoutIfNeeded];
 ok=expect(view.reactTag.intValue==42&&layer.player==player&&player.currentItem==item&&[binding isEqual:controller.externalPresentationBinding],"restore bounds preserves exact attachment and binding")&&ok;
 ok=expect([files fileExistsAtPath:bluePath]&&release(module,@"missing-bounds")&&![files fileExistsAtPath:bluePath],"restore and explicit release preserve correct ownership")&&ok;
 for(NSDictionary *wrong in @[@{@"reactTag":@43},@{@"lease":@"wrong-lease"},@{@"binding":@{@"intentId":@1,@"sessionId":@"snapshot-session",@"generation":@2,@"itemId":@"authored-video"}}]){
  NSMutableDictionary *bad=[source mutableCopy];[bad addEntriesFromDictionary:wrong];NSDictionary *result=capture(module,@"wrong-fence",bad,&failure);ok=expect(!result&&[failure isEqual:@"snapshot_stale"],"wrong tag/lease/generation rejected")&&ok;
 }
 __block BOOL cancelled=NO,resolved=NO;
 [module capture:@"cancelled" source:source resolver:^(id value){resolved=YES;} rejecter:^(NSString *code,NSString *message,NSError *error){cancelled=[code isEqual:@"snapshot_cancelled"];}];
 ok=expect(release(module,@"cancelled")&&cancelled&&!resolved,"in-flight cancellation rejects before encoding callback")&&ok;
 // Drain actual serial encoder/main completion before next request. No frame is fabricated.
 waitFor(^BOOL{return NO;},.3);
 NSDictionary *retained=capture(module,@"lease-cleanup",source,&failure);NSString *retainedPath=receiptPath(retained);
 ok=expect(retained!=nil,"post-cancel real capture succeeds")&&ok;
 [controller releaseLease:lease[@"lease"]];
 ok=expect(![files fileExistsAtPath:retainedPath]&&!release(module,@"lease-cleanup"),"lease loss deletes retained image exactly once")&&ok;
 [module invalidate];[view removeFromSuperview];[controller invalidate];[files removeItemAtURL:local error:nil];
 printf("{\"decodedMissingBoundsPass\":%s,\"beforeSeconds\":%.3f,\"duringSeconds\":%.3f,\"redPixel\":%s,\"bluePixel\":%s,\"sameViewTagControllerPlayerItemLeaseBinding\":true,\"frame9VisualAcceptance\":false}\n",ok?"true":"false",before,during,[[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:redPixel options:0 error:nil]encoding:NSUTF8StringEncoding].UTF8String,[[NSString alloc]initWithData:[NSJSONSerialization dataWithJSONObject:bluePixel options:0 error:nil]encoding:NSUTF8StringEncoding].UTF8String);return ok?0:1;
}}
@interface PorticoSnapshotTestScene : UIResponder<UIWindowSceneDelegate>
@property(nonatomic,strong) UIWindow *window;
@end
@implementation PorticoSnapshotTestScene
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
 self.window=[[UIWindow alloc]initWithWindowScene:(UIWindowScene *)scene];self.window.rootViewController=[UIViewController new];[self.window makeKeyAndVisible];
 [NSTimer scheduledTimerWithTimeInterval:1 repeats:NO block:^(NSTimer *timer){int result=runTests(self.window);NSURL *file=[[NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"result.json"];[[NSJSONSerialization dataWithJSONObject:@{@"exit":@(result)} options:0 error:nil]writeToURL:file atomically:YES];exit(result);}];
}
@end
@interface PorticoSnapshotTestApp : UIResponder<UIApplicationDelegate> @end
@implementation PorticoSnapshotTestApp
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {return YES;}
@end
int main(int argc,char **argv){@autoreleasepool{setvbuf(stdout,NULL,_IONBF,0);return UIApplicationMain(argc,argv,nil,NSStringFromClass(PorticoSnapshotTestApp.class));}}
