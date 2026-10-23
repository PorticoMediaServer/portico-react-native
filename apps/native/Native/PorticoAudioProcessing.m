#import "PorticoAudioProcessing.h"
#import "PorticoEqualizer.h"
#import <sqlite3.h>
#import <CommonCrypto/CommonDigest.h>

NSNotificationName const PorticoAudioProcessingChanged=@"PorticoAudioProcessingChanged";
static BOOL EQNumber(id n,double lo,double hi){return [n isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)n)!=CFBooleanGetTypeID()&&isfinite([n doubleValue])&&[n doubleValue]>=lo&&[n doubleValue]<=hi;}
static NSError *EQError(NSString *message){return [NSError errorWithDomain:@"PorticoAudio" code:1 userInfo:@{NSLocalizedDescriptionKey:message}];}

@implementation PorticoAudioProcessing {
 sqlite3 *_db;NSString *_route,*_mode,*_sessionRoute,*_preset;BOOL _enabled;float _preamp,_bands[10];double _requestedRate;NSInteger _requestedChannels;
 NSString *_requestError;
}
+ (instancetype)shared {static PorticoAudioProcessing *s;static dispatch_once_t once;dispatch_once(&once,^{s=[self new];});return s;}
- (instancetype)init {
 if((self=[super init])){
  _mode=@"smart";_preset=@"custom";
  NSURL *base=[NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  NSURL *dir=[base URLByAppendingPathComponent:@"AudioProcessing" isDirectory:YES];[NSFileManager.defaultManager createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
  NSURL *file=[dir URLByAppendingPathComponent:@"equalizer.sqlite3"];
  if(sqlite3_open_v2(file.fileSystemRepresentation,&_db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX,NULL)==SQLITE_OK){
   sqlite3_busy_timeout(_db,1500);char *error=NULL;
   int result=sqlite3_exec(_db,"PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS equalizer_output (route TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), preamp REAL NOT NULL CHECK(preamp BETWEEN -24 AND 12), preset TEXT NOT NULL); CREATE TABLE IF NOT EXISTS equalizer_band (route TEXT NOT NULL REFERENCES equalizer_output(route) ON DELETE CASCADE, band INTEGER NOT NULL CHECK(band BETWEEN 0 AND 9), gain REAL NOT NULL CHECK(gain BETWEEN -12 AND 12), PRIMARY KEY(route,band));",NULL,NULL,&error);
   if(result!=SQLITE_OK){sqlite3_free(error);sqlite3_close(_db);_db=NULL;}
  }else{if(_db)sqlite3_close(_db);_db=NULL;}
  [file setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(routeChanged:) name:AVAudioSessionRouteChangeNotification object:nil];
  [self loadOutput];
 }return self;
}
- (NSString *)routeKey {
 NSMutableArray *uids=[NSMutableArray new];for(AVAudioSessionPortDescription *port in AVAudioSession.sharedInstance.currentRoute.outputs)if(port.UID.length)[uids addObject:port.UID];
 NSString *raw=[[uids sortedArrayUsingSelector:@selector(compare:)] componentsJoinedByString:@"\n"];if(!raw.length)return @"unavailable";
 NSData *data=[raw dataUsingEncoding:NSUTF8StringEncoding];unsigned char hash[CC_SHA256_DIGEST_LENGTH];CC_SHA256(data.bytes,(CC_LONG)data.length,hash);
 NSMutableString *key=[NSMutableString new];for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++)[key appendFormat:@"%02x",hash[i]];return key;
}
- (void)loadOutput {
 NSString *route=[self routeKey];if([route isEqual:_route])return;_route=route;_enabled=NO;_preamp=0;_preset=@"custom";memset(_bands,0,sizeof(_bands));
 if(!_db)return;sqlite3_stmt *stmt=NULL;
 if(sqlite3_prepare_v2(_db,"SELECT enabled,preamp,preset FROM equalizer_output WHERE route=?",-1,&stmt,NULL)==SQLITE_OK){
  sqlite3_bind_text(stmt,1,route.UTF8String,-1,SQLITE_TRANSIENT);
  if(sqlite3_step(stmt)==SQLITE_ROW){_enabled=sqlite3_column_int(stmt,0)!=0;_preamp=(float)sqlite3_column_double(stmt,1);const unsigned char *preset=sqlite3_column_text(stmt,2);if(preset)_preset=[NSString stringWithUTF8String:(const char *)preset];}
 }sqlite3_finalize(stmt);stmt=NULL;
 if(sqlite3_prepare_v2(_db,"SELECT band,gain FROM equalizer_band WHERE route=? ORDER BY band",-1,&stmt,NULL)==SQLITE_OK){
  sqlite3_bind_text(stmt,1,route.UTF8String,-1,SQLITE_TRANSIENT);int count=0;while(sqlite3_step(stmt)==SQLITE_ROW){int band=sqlite3_column_int(stmt,0);if(band>=0&&band<10){_bands[band]=(float)sqlite3_column_double(stmt,1);count++;}}
  if(count!=10){_enabled=NO;_preamp=0;memset(_bands,0,sizeof(_bands));}
 }sqlite3_finalize(stmt);
}
- (void)routeChanged:(NSNotification *)note {
 if(!NSThread.isMainThread){dispatch_async(dispatch_get_main_queue(),^{[self routeChanged:note];});return;}
 [self loadOutput];_sessionRoute=nil;[NSNotificationCenter.defaultCenter postNotificationName:PorticoAudioProcessingChanged object:self];
}
- (BOOL)setEqualizer:(NSDictionary *)settings error:(NSError **)error {
 NSArray *bands=[settings[@"bands"] isKindOfClass:NSArray.class]?settings[@"bands"]:nil;
 id enabled=settings[@"enabled"];BOOL valid=[enabled isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)enabled)==CFBooleanGetTypeID()&&EQNumber(settings[@"preampDb"],-24,12)&&bands.count==10;
 for(id gain in bands)valid=valid&&EQNumber(gain,-12,12);
 NSString *preset=[settings[@"presetId"] isKindOfClass:NSString.class]?settings[@"presetId"]:@"custom";
 /* No third-party AutoEQ dataset ships without its own redistribution provenance. */
 valid=valid&&preset.length>0&&preset.length<=128&&![preset hasPrefix:@"autoeq:"];
 if(!valid){if(error)*error=EQError(@"Choose ten finite EQ gains, a valid preamp, and a licensed preset.");return NO;}
 [self loadOutput];if(!_db||[_route isEqual:@"unavailable"]){if(error)*error=EQError(@"The output preset could not be saved.");return NO;}
 BOOL ok=sqlite3_exec(_db,"BEGIN IMMEDIATE",NULL,NULL,NULL)==SQLITE_OK;sqlite3_stmt *stmt=NULL;
 if(ok)ok=sqlite3_prepare_v2(_db,"INSERT INTO equalizer_output(route,enabled,preamp,preset) VALUES(?,?,?,?) ON CONFLICT(route) DO UPDATE SET enabled=excluded.enabled,preamp=excluded.preamp,preset=excluded.preset",-1,&stmt,NULL)==SQLITE_OK;
 if(ok){sqlite3_bind_text(stmt,1,_route.UTF8String,-1,SQLITE_TRANSIENT);sqlite3_bind_int(stmt,2,[enabled boolValue]);sqlite3_bind_double(stmt,3,[settings[@"preampDb"] doubleValue]);sqlite3_bind_text(stmt,4,preset.UTF8String,-1,SQLITE_TRANSIENT);ok=sqlite3_step(stmt)==SQLITE_DONE;}sqlite3_finalize(stmt);stmt=NULL;
 if(ok)ok=sqlite3_prepare_v2(_db,"INSERT INTO equalizer_band(route,band,gain) VALUES(?,?,?) ON CONFLICT(route,band) DO UPDATE SET gain=excluded.gain",-1,&stmt,NULL)==SQLITE_OK;
 for(int i=0;ok&&i<10;i++){sqlite3_reset(stmt);sqlite3_bind_text(stmt,1,_route.UTF8String,-1,SQLITE_TRANSIENT);sqlite3_bind_int(stmt,2,i);sqlite3_bind_double(stmt,3,[bands[i] doubleValue]);ok=sqlite3_step(stmt)==SQLITE_DONE;}sqlite3_finalize(stmt);
 if(ok)ok=sqlite3_exec(_db,"COMMIT",NULL,NULL,NULL)==SQLITE_OK;if(!ok){sqlite3_exec(_db,"ROLLBACK",NULL,NULL,NULL);if(error)*error=EQError(@"The output preset could not be saved.");return NO;}
 _enabled=[enabled boolValue];_preamp=[settings[@"preampDb"] floatValue];_preset=preset;for(int i=0;i<10;i++)_bands[i]=[bands[i] floatValue];
 [NSNotificationCenter.defaultCenter postNotificationName:PorticoAudioProcessingChanged object:self];return YES;
}
- (void)applyEqualizer:(AVAudioUnitEQ *)equalizer {
 [self loadOutput];PorticoConfigureEqualizer(equalizer,_enabled,_preamp,_bands);
}
- (BOOL)configureRate:(double)rate channels:(AVAudioChannelCount)channels mode:(NSString *)mode error:(NSError **)error {
 if(!isfinite(rate)||rate<8000||rate>768000||channels<1||channels>32||![@[@"smart",@"strict",@"off"] containsObject:mode]){if(error)*error=EQError(@"The sample-rate request is invalid.");return NO;}
 [self loadOutput];AVAudioSession *audio=AVAudioSession.sharedInstance;BOOL strict=[mode isEqual:@"strict"];
 double requested=[mode isEqual:@"off"]?0:rate;
 BOOL change=![_mode isEqual:mode]||![_sessionRoute isEqual:_route]||fabs(_requestedRate-requested)>.01||_requestedChannels!=channels;
 _mode=[mode copy];_requestedChannels=channels;NSError *failure=nil;
 if(change){
  /* Preferences are requests. Read back sampleRate/channels after activation and report rejection. */
  [audio setActive:NO error:&failure];
  if(!failure)[audio setCategory:AVAudioSessionCategoryPlayback mode:AVAudioSessionModeDefault options:0 error:&failure];
  if(@available(iOS 15.0,tvOS 15.0,*)){if(!failure)[audio setSupportsMultichannelContent:YES error:&failure];}
  if(!failure&&![mode isEqual:@"off"])[audio setPreferredSampleRate:rate error:&failure];
  if(!failure)[audio setActive:YES error:&failure];
  NSInteger maximum=audio.maximumOutputNumberOfChannels;
  if(!failure&&maximum>0)[audio setPreferredOutputNumberOfChannels:MIN((NSInteger)channels,maximum) error:&failure];
  if(!failure){_requestedRate=requested;_sessionRoute=[_route copy];}
 }
 if(!failure&&strict&&fabs(audio.sampleRate-rate)>.01)failure=EQError(@"This output did not accept the file’s sample rate in Strict mode.");
 _requestError=failure.localizedDescription;
 if(failure&&error)*error=failure;return failure==nil;
}
- (NSDictionary *)snapshot {
 [self loadOutput];AVAudioSession *audio=AVAudioSession.sharedInstance;NSMutableArray *bands=[NSMutableArray new];for(int i=0;i<10;i++)[bands addObject:@(_bands[i])];
 return @{@"sampleRateMatching":_mode?:@"smart",@"requestedSampleRate":@(_requestedRate),@"outputSampleRate":@(audio.sampleRate),@"requestedChannels":@(_requestedChannels),@"outputChannels":@(audio.outputNumberOfChannels),@"maximumOutputChannels":@(audio.maximumOutputNumberOfChannels),@"routeKey":_route?:@"unavailable",@"sampleRateMatched":@(_requestedRate>0&&fabs(audio.sampleRate-_requestedRate)<.01),@"requestError":_requestError?:@"",@"eqEnabled":@(_enabled),@"eqPreampDb":@(_preamp),@"eqBands":bands,@"eqPresetId":_preset?:@"custom",@"bitPerfectVerified":@NO};
}
- (void)dealloc {if(_db)sqlite3_close(_db);[NSNotificationCenter.defaultCenter removeObserver:self];}
@end
