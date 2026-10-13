#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
@interface PorticoPlaybackController : NSObject
@property(nonatomic,copy) void (^onFact)(NSDictionary *fact);
/** Picture in Picture changes from the player view, for JavaScript ({lease, state, subtitlesCarried}). */
@property(nonatomic,copy) void (^onPictureInPicture)(NSDictionary *change);
@property(nonatomic,readonly) AVPlayer *player;
@property(nonatomic,readonly) NSString *lease;
@property(nonatomic,readonly) NSString *subtitleText;
@property(nonatomic,readonly) NSDictionary *subtitleCue;
/** Portico's caption style for the line the app draws ({scale, background}), from the subtitle
 * command in force; empty when the command carries none. */
@property(nonatomic,readonly) NSDictionary *subtitleStyle;
#if TARGET_OS_TV
/** The window the picture is shown in, whose display is asked to match the title. The player
 * view sets it; without one the app's key window is used. */
@property(nonatomic,weak) UIWindow *displayWindow;
#endif
// Canonical audio controls belong to the native listening owner. JS supplies only
// attachment identity/options while this token is active.
- (void)listeningOwner:(NSString *)owner state:(NSDictionary *)state origin:(NSString *)origin allowed:(BOOL)allowed seek:(NSDictionary *)seek render:(NSDictionary *)render;
- (void)listeningRoute:(NSString *)owner ready:(BOOL)ready revision:(NSInteger)revision;
- (void)clearListeningOwner:(NSString *)owner;
- (NSDictionary *)listeningSnapshot;
- (void)resetListeningEngine:(NSString *)owner;
- (void)invalidate;
- (NSDictionary *)acquire:(NSString *)owner;
- (NSString *)acceptCommand:(NSDictionary *)command;
- (void)testClampNext;
#if DEBUG
/** Exit-test harness: the render engine behaves as if the audio route changed. */
- (void)debugAudioConfigurationChange;
#endif
- (NSDictionary *)testStaleCommands;
- (void)displayReadyForLease:(NSString *)lease;
- (void)releaseLease:(NSString *)lease;
// System integration (PorticoSystemMedia): the app's one playback controller, whether music or an
// audiobook currently owns the system surfaces, and the position in the media's own timeline.
@property(class,nonatomic,weak) PorticoPlaybackController *shared;
@property(nonatomic,readonly) BOOL listeningActive;
- (double)currentSourcePosition;
/** OS-02: the chosen subtitles are drawn by the app, so PiP and AirPlay won't carry them. */
@property(nonatomic,readonly) BOOL subtitleOverlayActive;
@end
