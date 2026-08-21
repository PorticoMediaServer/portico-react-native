#import <AVKit/AVKit.h>
#import <React/RCTViewManager.h>

@interface PorticoAirPlayRoutePickerManager : RCTViewManager
@end

@implementation PorticoAirPlayRoutePickerManager

RCT_EXPORT_MODULE(PorticoAirPlayRoutePicker)

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (UIView *)view {
  AVRoutePickerView *picker = [AVRoutePickerView new];
  picker.prioritizesVideoDevices = YES;
  picker.tintColor = [UIColor colorWithRed:0.76 green:0.80 blue:0.84 alpha:1.0];
  picker.activeTintColor = [UIColor colorWithRed:0.25 green:0.73 blue:0.97 alpha:1.0];
  picker.accessibilityLabel = @"AirPlay";
  picker.accessibilityHint = @"Choose an AirPlay playback destination";
  return picker;
}

@end
