#import <AVFoundation/AVFoundation.h>
@interface PorticoAudioSelection : NSObject
@property(nonatomic,copy) void (^onFact)(NSDictionary *fact);
- (void)apply:(NSDictionary *)command item:(AVPlayerItem *)item;
- (void)invalidate;
@end
