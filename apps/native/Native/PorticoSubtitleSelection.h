#import <AVFoundation/AVFoundation.h>
// Subtitle-only adapter. The existing controller supplies AVPlayer source time.
@interface PorticoSubtitleSelection : NSObject
@property(nonatomic,copy) void (^onText)(NSDictionary *cue);
@property(nonatomic,copy) void (^onStatus)(NSString *error);
- (void)apply:(NSDictionary *)command item:(AVPlayerItem *)item source:(NSString *)source;
- (void)tick:(CMTime)time;
- (void)invalidate;
/** True while a chosen track is drawn by the app rather than by AVPlayer (so it can't appear in
 * Picture in Picture or on an AirPlay receiver). */
@property(nonatomic,readonly) BOOL overlayActive;
@end
