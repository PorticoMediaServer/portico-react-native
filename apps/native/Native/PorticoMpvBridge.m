#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTViewManager.h>

// The mpv player engine (PorticoMpvPlaybackModule.swift, PorticoMpvPlayerView.swift).
@interface RCT_EXTERN_MODULE(PorticoMpvPlaybackModule, RCTEventEmitter)
RCT_EXTERN_METHOD(acquire:(NSString *)owner resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(command:(NSDictionary *)command resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(release:(NSString *)lease resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(facts:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end

@interface RCT_EXTERN_REMAP_MODULE(PorticoMpvPlayer, PorticoMpvPlayerManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(lease, NSString)
RCT_EXPORT_VIEW_PROPERTY(pictureInPictureRequest, NSInteger)
@end
