#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>
#import <VideoToolbox/VideoToolbox.h>
#import <UIKit/UIKit.h>
#import <sys/utsname.h>

/** Answers what only the system knows about this device right now: which HDR formats the panel
 * (or the television behind an Apple TV) accepts, which codecs the chip decodes in hardware, and
 * what the current audio output carries. The app turns the answers into the capability profile
 * its server plans delivery against. Everything here is a read: the audio session is never
 * activated, so asking cannot interrupt anyone's audio. */
@interface PorticoCapabilities : RCTEventEmitter <RCTBridgeModule> @end
@implementation PorticoCapabilities { BOOL _listening; }
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return NO; }
- (NSArray<NSString *> *)supportedEvents { return @[@"portico.capabilities"]; }

- (void)startObserving {
 _listening = YES;
 NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
 [center addObserver:self selector:@selector(changed) name:AVAudioSessionRouteChangeNotification object:nil];
 [center addObserver:self selector:@selector(changed) name:AVPlayerEligibleForHDRPlaybackDidChangeNotification object:nil];
}
- (void)stopObserving { _listening = NO; [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (void)invalidate { [NSNotificationCenter.defaultCenter removeObserver:self]; [super invalidate]; }
- (void)changed { if (_listening) [self sendEventWithName:@"portico.capabilities" body:@{}]; }

RCT_REMAP_METHOD(facts, factsWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
 dispatch_async(dispatch_get_main_queue(), ^{
  struct utsname system; uname(&system);
  NSString *model = [NSString stringWithCString:system.machine encoding:NSUTF8StringEncoding] ?: @"";
#if TARGET_OS_SIMULATOR
  model = NSProcessInfo.processInfo.environment[@"SIMULATOR_MODEL_IDENTIFIER"] ?: model;
#endif
  // On Apple TV these follow the HDMI sink and the viewer's video settings.
  AVPlayerHDRMode modes = AVPlayer.availableHDRModes;
  UIScreen *screen = UIScreen.mainScreen;
  CGSize pixels = screen.nativeBounds.size;
  AVAudioSession *audio = AVAudioSession.sharedInstance;
#if TARGET_OS_TV
  // COMPAT-03: without this the session reports 2 channels on a 5.1/7.1 HDMI receiver, so the
  // server converted surround to stereo AAC. It must be set before the channels are read.
  if (@available(tvOS 15.0, *)) [audio setSupportsMultichannelContent:YES error:nil];
#endif
  AVAudioSessionPortDescription *port = audio.currentRoute.outputs.firstObject;
  BOOL spatial = NO, av1 = NO;
  if (@available(iOS 15.0, tvOS 15.0, *)) spatial = port.isSpatialAudioEnabled;
  if (@available(iOS 17.0, tvOS 17.0, *)) av1 = VTIsHardwareDecodeSupported(kCMVideoCodecType_AV1);
  resolve(@{
   @"model": model,
   @"osVersion": UIDevice.currentDevice.systemVersion ?: @"",
   // APL-AUTH-06: the name the owner gave this device ("Living Room") for sign-in approvals, and
   // the app's own version. On iOS 16+ the system may answer a generic name; the app falls back.
   @"deviceName": UIDevice.currentDevice.name ?: @"",
   @"appVersion": [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"",
   @"hardwareDecode": @{@"hevc": @(VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)), @"av1": @(av1), @"dolbyVision": @(VTIsHardwareDecodeSupported(kCMVideoCodecType_DolbyVisionHEVC))},
   @"hdrModes": @{@"hdr10": @((modes & AVPlayerHDRModeHDR10) != 0), @"hlg": @((modes & AVPlayerHDRModeHLG) != 0), @"dolbyVision": @((modes & AVPlayerHDRModeDolbyVision) != 0)},
   @"eligibleForHDRPlayback": @(AVPlayer.eligibleForHDRPlayback),
   @"screen": @{@"width": @(MAX(pixels.width, pixels.height)), @"height": @(MIN(pixels.width, pixels.height)), @"maxFrameRate": @(screen.maximumFramesPerSecond)},
   @"audio": @{@"maxOutputChannels": @(MAX(audio.maximumOutputNumberOfChannels, (NSInteger)port.channels.count)), @"route": [self route:port.portType], @"spatial": @(spatial)},
  });
 });
}

/** The port type as one of the words the profile uses. */
- (NSString *)route:(AVAudioSessionPort)port {
 if (!port) return @"";
 if ([port isEqualToString:AVAudioSessionPortHDMI]) return @"hdmi";
 if ([port isEqualToString:AVAudioSessionPortAirPlay]) return @"airplay";
 if ([port isEqualToString:AVAudioSessionPortBluetoothA2DP] || [port isEqualToString:AVAudioSessionPortBluetoothLE] || [port isEqualToString:AVAudioSessionPortBluetoothHFP]) return @"bluetooth";
 if ([port isEqualToString:AVAudioSessionPortHeadphones]) return @"headphones";
 if ([port isEqualToString:AVAudioSessionPortUSBAudio]) return @"usb";
 if ([port isEqualToString:AVAudioSessionPortBuiltInSpeaker] || [port isEqualToString:AVAudioSessionPortBuiltInReceiver]) return @"speaker";
 return @"other";
}
@end
