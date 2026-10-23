#import <AVFoundation/AVFoundation.h>
FOUNDATION_EXPORT NSNotificationName const PorticoAudioProcessingChanged;
/* Device-local DSP only. The listening owner retains queue, account and playback authority. */
@interface PorticoAudioProcessing : NSObject
@property(class,nonatomic,readonly) PorticoAudioProcessing *shared;
- (BOOL)configureRate:(double)rate channels:(AVAudioChannelCount)channels mode:(NSString *)mode error:(NSError **)error;
- (NSDictionary *)snapshot;
- (BOOL)setEqualizer:(NSDictionary *)settings error:(NSError **)error;
- (void)applyEqualizer:(AVAudioUnitEQ *)equalizer;
@end
