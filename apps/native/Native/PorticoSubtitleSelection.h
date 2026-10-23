#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
// Subtitle-only adapter. The existing controller supplies AVPlayer source time.
@interface PorticoSubtitleSelection : NSObject
/** App caption style, with explicit opt-in to the system caption appearance. */
+ (void)applyCaptionAppearanceToLabel:(UILabel * _Nonnull)label baseSize:(CGFloat)base style:(NSDictionary * _Nullable)style italic:(BOOL)italic NS_SWIFT_NAME(applyCaptionAppearance(to:baseSize:style:italic:));
@property(nonatomic,copy) void (^onText)(NSDictionary *cue);
@property(nonatomic,copy) void (^onStatus)(NSString *error);
/** Whether a `file:` address is one this app may read (a file inside its own Downloads folder).
 * A downloaded title's subtitles are WebVTT files there; without this block none is read. */
@property(nonatomic,copy) BOOL (^allowsLocalFile)(NSURL *url);
- (void)apply:(NSDictionary *)command item:(AVPlayerItem *)item source:(NSString *)source;
- (void)tick:(CMTime)time;
- (void)invalidate;
/** True while a chosen track is drawn by the app rather than by AVPlayer (so it can't appear in
 * Picture in Picture or on an AirPlay receiver). */
@property(nonatomic,readonly) BOOL overlayActive;
@end
