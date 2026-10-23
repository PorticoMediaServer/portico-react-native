#import "PorticoSubtitleOverlay.h"
#import "PorticoServerTrust.h"
#import "PorticoSubtitleSelection.h"
#import <Libporticosubtitle/PorticoSubtitleCore.h>

/* One bounded scoped fetch. No ambient credentials, redirect, cookies or URL cache. */
@interface PSFetch : NSObject<NSURLSessionDataDelegate>
@property(nonatomic,strong) NSURLSession *session;
@property(nonatomic,strong) NSURLSessionDataTask *task;
@property(nonatomic,strong) NSMutableData *bytes;
@property(nonatomic) NSUInteger limit;
@property(nonatomic,copy) void (^done)(NSData *,NSString *);
- (void)start:(NSURL *)url limit:(NSUInteger)limit done:(void (^)(NSData *,NSString *))done;
- (void)cancel;
@end
@implementation PSFetch
- (void)start:(NSURL *)url limit:(NSUInteger)limit done:(void (^)(NSData *,NSString *))done {
 self.limit=limit;self.done=done;self.bytes=[NSMutableData new];
 NSURLSessionConfiguration *c=NSURLSessionConfiguration.ephemeralSessionConfiguration;c.URLCache=nil;c.HTTPCookieStorage=nil;c.URLCredentialStorage=nil;c.HTTPShouldSetCookies=NO;c.timeoutIntervalForRequest=15;c.timeoutIntervalForResource=25;
 self.session=[NSURLSession sessionWithConfiguration:c delegate:self delegateQueue:NSOperationQueue.mainQueue];
 self.task=[self.session dataTaskWithURL:url];[self.task resume];
}
- (void)cancel {self.done=nil;[self.task cancel];[self.session invalidateAndCancel];self.session=nil;self.task=nil;}
- (void)URLSession:(NSURLSession *)session didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition,NSURLCredential *))completion {[PorticoServerTrust handleChallenge:challenge completion:completion];}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion {completion(nil);}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completion {
 NSHTTPURLResponse *http=[response isKindOfClass:NSHTTPURLResponse.class]?(id)response:nil;
 completion(http.statusCode==200&&response.expectedContentLength<=(int64_t)self.limit?NSURLSessionResponseAllow:NSURLSessionResponseCancel);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
 if(data.length>self.limit-self.bytes.length){[task cancel];return;}[self.bytes appendData:data];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
 void (^done)(NSData *,NSString *)=self.done;NSData *bytes=self.bytes;self.done=nil;[self.session finishTasksAndInvalidate];self.session=nil;self.task=nil;
 if(done)done(!error&&bytes.length?bytes:nil,error?@"The subtitle file is unavailable or access expired.":@"");
}
- (void)dealloc {[self cancel];}
@end

static BOOL PSNumber(id n,double lo,double hi){return [n isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)n)!=CFBooleanGetTypeID()&&isfinite([n doubleValue])&&[n doubleValue]>=lo&&[n doubleValue]<=hi;}
@implementation PorticoSubtitleOverlay {
 dispatch_queue_t _queue;PSRenderer *_renderer;NSDictionary *_command;NSString *_source;NSUInteger _epoch;
 NSMutableArray<PSFetch *> *_fetches;BOOL _active,_busy,_loading;NSTimeInterval _authorized,_lastFetch;
}
- (instancetype)init {if((self=[super init])){_queue=dispatch_queue_create("tv.getportico.subtitles.render",DISPATCH_QUEUE_SERIAL);_fetches=[NSMutableArray new];}return self;}
- (BOOL)active {return _active;}
- (void)invalidate {
 _epoch++;_active=NO;_command=nil;_source=nil;_authorized=0;_loading=NO;
 for(PSFetch *f in _fetches)[f cancel];[_fetches removeAllObjects];
 dispatch_async(_queue,^{ps_close(self->_renderer);self->_renderer=NULL;});if(self.onImage)self.onImage(nil);
}
/* The URL must belong to this media grant's resource, including each font and IDX companion. */
- (NSURL *)scoped:(id)value source:(NSString *)source resource:(NSString *)resource {
 if(![value isKindOfClass:NSString.class]||[value length]>4096)return nil;
 NSURL *url=[NSURL URLWithString:value],*media=[NSURL URLWithString:source];NSArray *parts=media.path.pathComponents;
 if(parts.count<4||!url.host.length||![@[@"http",@"https"] containsObject:url.scheme.lowercaseString]||![url.scheme.lowercaseString isEqual:media.scheme.lowercaseString]||![url.host.lowercaseString isEqual:media.host.lowercaseString]||![(url.port?:@([url.scheme isEqual:@"https"]?443:80)) isEqual:(media.port?:@([media.scheme isEqual:@"https"]?443:80))]||url.user||url.password||url.query||url.fragment)return nil;
 NSString *prefix=[NSString stringWithFormat:@"/v1/media/subtitles/%@/",parts[3]];
 if(![url.path hasPrefix:prefix])return nil;
 NSString *tail=[url.path substringFromIndex:prefix.length];
 NSRegularExpression *pattern=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,128}/[1-9][0-9]*(?:/original\\.(?:ass|ssa|sup|idx|sub|mks)|/fonts/[0-9]{1,2})$" options:0 error:nil];
 if(![pattern firstMatchInString:tail options:0 range:NSMakeRange(0,tail.length)])return nil;
 if(resource.length&&![url.path hasPrefix:[resource stringByAppendingString:@"/"]])return nil;return url;
}
- (void)fetch:(NSURL *)url limit:(NSUInteger)limit epoch:(NSUInteger)epoch done:(void (^)(NSData *))done {
 PSFetch *f=[PSFetch new];[_fetches addObject:f];__weak PorticoSubtitleOverlay *weakSelf=self;
 [f start:url limit:limit done:^(NSData *data,NSString *error){PorticoSubtitleOverlay *s=weakSelf;if(!s||s->_epoch!=epoch)return;
  [s->_fetches removeObject:f];if(!data){s->_loading=NO;s->_authorized=0;if(s.onImage)s.onImage(nil);if(s.onStatus)s.onStatus(error.length?error:@"The subtitle payload is empty.");return;}done(data);
 }];
}
- (void)apply:(NSDictionary *)command source:(NSString *)source {
 NSDictionary *render=[command[@"render"] isKindOfClass:NSDictionary.class]?command[@"render"]:nil;
 NSString *kind=render[@"kind"];
 if(![@[@"ass",@"pgs",@"vobsub",@"dvb"] containsObject:kind]){if(_active)[self invalidate];return;}
 NSURL *url=[self scoped:render[@"url"] source:source resource:nil];
 if(!url){[self invalidate];if(self.onStatus)self.onStatus(@"The subtitle file does not belong to this playback grant.");return;}
 if([_command isEqual:command]&&[_source isEqual:source])return;
 [self invalidate];_active=YES;_command=[command copy];_source=[source copy];[self load];
}
- (void)load {
 if(_loading||!_active)return;_loading=YES;_lastFetch=NSProcessInfo.processInfo.systemUptime;
 NSUInteger epoch=_epoch;NSDictionary *render=_command[@"render"];NSString *kind=render[@"kind"];
 NSDictionary *style=[_command[@"style"] isKindOfClass:NSDictionary.class]?_command[@"style"]:@{};
 BOOL overrideStyle=[style[@"keepStyling"] isEqual:@NO]||[style[@"useSystemCaptionStyle"] isEqual:@YES];
 UILabel *appearance=[UILabel new];[PorticoSubtitleSelection applyCaptionAppearanceToLabel:appearance baseSize:26 style:style italic:NO];
 CGFloat red=1,green=1,blue=1,alpha=1;[appearance.textColor getRed:&red green:&green blue:&blue alpha:&alpha];
 uint32_t foreground=((uint32_t)lround(red*255)<<24)|((uint32_t)lround(green*255)<<16)|((uint32_t)lround(blue*255)<<8)|(uint32_t)lround((1-alpha)*255);
 red=green=blue=0;alpha=0;[appearance.backgroundColor getRed:&red green:&green blue:&blue alpha:&alpha];
 uint32_t background=((uint32_t)lround(red*255)<<24)|((uint32_t)lround(green*255)<<16)|((uint32_t)lround(blue*255)<<8)|(uint32_t)lround((1-alpha)*255);
 NSString *fontName=appearance.font.familyName;double fontSize=appearance.font.pointSize;
 NSURL *url=[self scoped:render[@"url"] source:_source resource:nil];
 NSString *resource=[url.path stringByDeletingLastPathComponent];
 __weak PorticoSubtitleOverlay *weakSelf=self;
 [self fetch:url limit:64*1024*1024 epoch:epoch done:^(NSData *data){
  PorticoSubtitleOverlay *s=weakSelf;if(!s)return;
  void (^finish)(NSData *,NSArray *)=^(NSData *pair,NSArray *fonts){
   PorticoSubtitleOverlay *owner=weakSelf;if(!owner||owner->_epoch!=epoch)return;
   if(data.length+pair.length>64*1024*1024){owner->_loading=NO;if(owner.onStatus)owner.onStatus(@"The subtitle payload exceeds its limit.");return;}
   dispatch_async(owner->_queue,^{
    PSFont attached[16]={0};for(NSUInteger i=0;i<fonts.count;i++){attached[i].name=[fonts[i][@"name"] UTF8String];attached[i].bytes=[fonts[i][@"data"] bytes];attached[i].size=[fonts[i][@"data"] length];}
    char error[256]={0};PSRenderer *next=ps_open(kind.UTF8String,data.bytes,data.length,pair.bytes,pair.length,attached,fonts.count,error,sizeof(error));
    if(next&&overrideStyle){BOOL box=[@[@"translucent",@"opaque"] containsObject:style[@"background"]];PSStyle override={fontName.UTF8String,fontSize,foreground,background,box?3:1,[style[@"position"] isEqual:@"top"]?8:2,[style[@"background"] isEqual:@"none"]?0:2,[style[@"background"] isEqual:@"shadow"]?2:0,[style[@"position"] isEqual:@"raised"]?.20:.08};ps_style(next,&override);}
    NSString *failure=next?@"":[NSString stringWithUTF8String:error];
    dispatch_async(dispatch_get_main_queue(),^{PorticoSubtitleOverlay *view=weakSelf;if(!view||view->_epoch!=epoch){dispatch_async(owner->_queue,^{ps_close(next);});return;}
     view->_loading=NO;view->_authorized=next?NSProcessInfo.processInfo.systemUptime+40:0;
     dispatch_async(view->_queue,^{ps_close(view->_renderer);view->_renderer=next;});
     if(view.onStatus)view.onStatus(failure);
    });
   });
  };
  if([kind isEqual:@"vobsub"]){
   NSString *companion=[render[@"companionUrl"] isKindOfClass:NSString.class]?render[@"companionUrl"]:[[url.absoluteString stringByDeletingPathExtension] stringByAppendingPathExtension:@"sub"];
   NSURL *pair=[s scoped:companion source:s->_source resource:resource];if(!pair){s->_loading=NO;return;}
   [s fetch:pair limit:64*1024*1024-data.length epoch:epoch done:^(NSData *bytes){finish(bytes,@[]);}];return;
  }
  NSArray *named=[render[@"fonts"] isKindOfClass:NSArray.class]?render[@"fonts"]:@[];
  if(named.count>16){s->_loading=NO;return;}
  NSMutableArray *fonts=[NSMutableArray new];__block NSUInteger index=0,total=0;__block void (^nextFont)(void);
  nextFont=^{PorticoSubtitleOverlay *view=weakSelf;if(!view||view->_epoch!=epoch){nextFont=nil;return;}
   if(index==named.count){finish(nil,fonts);nextFont=nil;return;}
   NSDictionary *font=[named[index++] isKindOfClass:NSDictionary.class]?named[index-1]:nil;
   NSString *name=font[@"name"];NSURL *address=[view scoped:font[@"url"] source:view->_source resource:resource];
   if(!address||![name isKindOfClass:NSString.class]||name.length>160||!name.length){view->_loading=NO;nextFont=nil;return;}
   [view fetch:address limit:MIN(8*1024*1024,32*1024*1024-total) epoch:epoch done:^(NSData *bytes){total+=bytes.length;[fonts addObject:@{@"name":name,@"data":bytes}];if(nextFont)nextFont();}];
  };nextFont();
 }];
}
- (void)renderAtSourceTime:(double)seconds size:(CGSize)pixels {
 if(!_active||!isfinite(seconds)||seconds<0)return;
 if(NSProcessInfo.processInfo.systemUptime-_lastFetch>=25)[self load];
 if(NSProcessInfo.processInfo.systemUptime>_authorized){if(self.onImage)self.onImage(nil);return;}
 if(_busy)return;int width=(int)llround(pixels.width),height=(int)llround(pixels.height);
 if(width<1||height<1)return;
 double scale=MIN(1,MIN(4096.0/width,2304.0/height));width=(int)llround(width*scale);height=(int)llround(height*scale);
 id raw=_command[@"offsetUs"];double offset=[raw isKindOfClass:NSString.class]?[raw doubleValue]:0;
 double intrinsic=PSNumber(_command[@"render"][@"offsetMs"],-86400000,86400000)?[_command[@"render"][@"offsetMs"] doubleValue]*1000:0;
 BOOL hasFileOffset=PSNumber(_command[@"render"][@"offsetMs"],-86400000,86400000);
 int64_t us=(int64_t)llround(seconds*1000000-(hasFileOffset?intrinsic:offset));NSUInteger epoch=_epoch;_busy=YES;
 __weak PorticoSubtitleOverlay *weakSelf=self;
 dispatch_async(_queue,^{
  int w=0,h=0,changed=0;const uint8_t *rgba=ps_render(self->_renderer,MAX(0,us),width,height,&w,&h,&changed);
  UIImage *image=nil;if(rgba&&changed&&w>0&&h>0){
   NSData *copy=[NSData dataWithBytes:rgba length:(NSUInteger)w*h*4];CGDataProviderRef provider=CGDataProviderCreateWithCFData((__bridge CFDataRef)copy);
   CGColorSpaceRef color=CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
   CGImageRef cg=CGImageCreate(w,h,8,32,w*4,color,kCGImageAlphaPremultipliedLast|kCGBitmapByteOrder32Big,provider,NULL,NO,kCGRenderingIntentDefault);
   if(cg){image=[UIImage imageWithCGImage:cg];CGImageRelease(cg);}CGColorSpaceRelease(color);CGDataProviderRelease(provider);
  }
  dispatch_async(dispatch_get_main_queue(),^{PorticoSubtitleOverlay *s=weakSelf;if(!s)return;s->_busy=NO;if(s->_epoch==epoch&&changed&&s.onImage)s.onImage(image);});
 });
}
- (void)dealloc {for(PSFetch *f in _fetches)[f cancel];PSRenderer *r=_renderer;dispatch_async(_queue,^{ps_close(r);});}
@end
