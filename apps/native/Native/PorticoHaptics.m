#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>
#import <TargetConditionals.h>

/** Selection entry only. UIKit retains control of hardware availability and feedback policy. */
@interface PorticoHaptics : NSObject <RCTBridgeModule> @end
@implementation PorticoHaptics
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

RCT_EXPORT_METHOD(selection:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_TV || TARGET_OS_SIMULATOR
  resolve(@NO);
#else
  if (UIDevice.currentDevice.userInterfaceIdiom != UIUserInterfaceIdiomPhone || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
    resolve(@NO); return;
  }
  BOOL visible = NO;
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive || ![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) if (window.isKeyWindow && !window.hidden) visible = YES;
  }
  if (!visible) { resolve(@NO); return; }
  UISelectionFeedbackGenerator *feedback = [UISelectionFeedbackGenerator new];
  [feedback selectionChanged];
  // UIKit exposes no physical-delivery receipt. YES means the request was submitted, not measured vibration.
  resolve(@YES);
#endif
}
@end
