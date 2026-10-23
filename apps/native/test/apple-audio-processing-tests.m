#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import "../Native/PorticoAudioProcessing.h"

static BOOL expect(BOOL value,const char *what){if(!value)fprintf(stderr,"FAIL %s\n",what);return value;}
int main(void){@autoreleasepool{
 PorticoAudioProcessing *store=[PorticoAudioProcessing new];NSError *error=nil;BOOL ok=YES;
 NSDictionary *flat=@{@"enabled":@NO,@"preampDb":@0,@"bands":@[@0,@0,@0,@0,@0,@0,@0,@0,@0,@0]};
 ok=expect([store setEqualizer:flat error:&error],"write flat")&&ok;
 ok=expect([store setSampleRateMatching:@"smart" error:&error],"write smart")&&ok;
 NSDictionary *eq=@{@"enabled":@YES,@"preampDb":@(-12),@"bands":@[@(-12),@(-.5),@0,@.5,@12,@3.5,@(-2),@4,@(-4),@2]};
 ok=expect([store setEqualizer:eq error:&error],"write all exact boundary/half-step gains")&&ok;
 NSDictionary *before=[store snapshot];
 NSMutableDictionary *bad=[eq mutableCopy];bad[@"preampDb"]=@12.5;
 ok=expect(![store setEqualizer:bad error:&error],"reject preamp above12")&&ok;
 bad=[eq mutableCopy];bad[@"preampDb"]=@(-12.5);
 ok=expect(![store setEqualizer:bad error:&error],"reject preamp below-12")&&ok;
 bad=[eq mutableCopy];bad[@"bands"]=@[@.25,@0,@0,@0,@0,@0,@0,@0,@0,@0];
 ok=expect(![store setEqualizer:bad error:&error],"reject quarter-step gain")&&ok;
 bad=[eq mutableCopy];bad[@"outputUID"]=@"not-a-setting";
 ok=expect(![store setEqualizer:bad error:&error],"reject per-output selection")&&ok;
 ok=expect([before[@"eqBands"] isEqual:[store snapshot][@"eqBands"]]&&[before[@"eqPreampDb"] isEqual:[store snapshot][@"eqPreampDb"]],"failed writes preserve committed EQ")&&ok;
 ok=expect([store setSampleRateMatching:@"strict" error:&error],"commit local strict")&&ok;
 PorticoAudioProcessing *reopened=[PorticoAudioProcessing new];NSDictionary *persisted=[reopened snapshot];
 ok=expect([persisted[@"sampleRateMatching"] isEqual:@"strict"]&&[persisted[@"eqEnabled"] boolValue]&&[persisted[@"eqPreampDb"] isEqual:@(-12)]&&[persisted[@"eqBands"] isEqual:eq[@"bands"]],"new instance reads one app-local committed EQ/rate")&&ok;
 ok=expect(![reopened setSampleRateMatching:@"profile" error:&error]&&[[reopened snapshot][@"sampleRateMatching"] isEqual:@"strict"],"invalid rate mode preserves committed value")&&ok;
 ok=expect([reopened resetEqualizer:&error],"reset flat")&&ok;
 NSDictionary *reset=[reopened snapshot];
 ok=expect([reset[@"eqEnabled"] boolValue]&&[reset[@"eqPreampDb"] isEqual:@0]&&[reset[@"eqBands"] isEqual:flat[@"bands"]]&&[reset[@"sampleRateMatching"] isEqual:@"strict"],"reset preserves switch and separate local rate")&&ok;
 ok=expect([reopened setSampleRateMatching:@"off" error:&error]&&[[[PorticoAudioProcessing new] snapshot][@"sampleRateMatching"] isEqual:@"off"],"local off persists")&&ok;
 AVAudioSession *audio=AVAudioSession.sharedInstance;NSError *zeroError=nil;BOOL zero=[audio setPreferredSampleRate:0 error:&zeroError];
 printf("{\"localEqualizerAndRatePersistencePass\":%s,\"offZeroPreferenceAccepted\":%s,\"offZeroError\":%ld}\n",ok?"true":"false",zero?"true":"false",(long)zeroError.code);
 return ok?0:1;
}}
