#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>
#import <TargetConditionals.h>

#if !TARGET_OS_TV
@interface PorticoHighlightsSave : NSObject <RCTBridgeModule, UIDocumentPickerDelegate>
@property(nonatomic,copy) NSString *operation;
@property(nonatomic,strong) NSURL *directory;
@property(nonatomic,strong) UIDocumentPickerViewController *picker;
@property(nonatomic,copy) RCTPromiseResolveBlock resolve;
@property(nonatomic,copy) RCTPromiseRejectBlock reject;
@end
@implementation PorticoHighlightsSave
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (void)finish:(NSString *)result error:(BOOL)failed {
  RCTPromiseResolveBlock resolve=self.resolve; RCTPromiseRejectBlock reject=self.reject;
  NSURL *directory=self.directory;
  self.resolve=nil; self.reject=nil; self.operation=nil; self.picker=nil; self.directory=nil;
  // This app-created unique directory is the only filesystem cleanup target.
  if(directory) [[NSFileManager defaultManager] removeItemAtURL:directory error:nil];
  if(failed) { if(reject) reject(@"highlights_save_failed",@"Could not save highlights",nil); }
  else if(resolve) resolve(result);
}
RCT_REMAP_METHOD(saveHighlights, saveHighlights:(NSString *)operation name:(NSString *)name markdown:(NSString *)markdown resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSRegularExpression *ids=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{32}$" options:0 error:nil];
  NSRegularExpression *names=[NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9 -]{1,64}-highlights\\.md$" options:0 error:nil];
  if(![operation isKindOfClass:NSString.class]||![name isKindOfClass:NSString.class]||![markdown isKindOfClass:NSString.class]||operation.length!=32||name.length>78||markdown.length>4194304||![ids numberOfMatchesInString:operation options:0 range:NSMakeRange(0,operation.length)]||![names numberOfMatchesInString:name options:0 range:NSMakeRange(0,name.length)]||![markdown hasPrefix:@"# Highlights\n"]) { reject(@"invalid_highlights",@"Invalid highlights export",nil); return; }
  NSData *bytes=[markdown dataUsingEncoding:NSUTF8StringEncoding];
  UIViewController *presenter=RCTPresentedViewController();
  if(self.operation||!presenter||!bytes||bytes.length>4194304) { reject(@"highlights_unavailable",@"Save unavailable",nil); return; }
  NSURL *directory=[[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES] URLByAppendingPathComponent:[@"portico-highlights-" stringByAppendingString:NSUUID.UUID.UUIDString] isDirectory:YES];
  NSError *error=nil;
  if(![[NSFileManager defaultManager] createDirectoryAtURL:directory withIntermediateDirectories:NO attributes:@{NSFileProtectionKey:NSFileProtectionComplete} error:&error]) { reject(@"highlights_save_failed",@"Could not prepare highlights",nil); return; }
  self.operation=operation; self.directory=directory; self.resolve=resolve; self.reject=reject;
  [directory setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
  NSURL *file=[directory URLByAppendingPathComponent:name isDirectory:NO];
  if(![bytes writeToURL:file options:NSDataWritingAtomic|NSDataWritingFileProtectionComplete error:&error]) { [self finish:nil error:YES]; return; }
  UIDocumentPickerViewController *picker=[[UIDocumentPickerViewController alloc] initForExportingURLs:@[file] asCopy:YES];
  picker.delegate=self; self.picker=picker;
  [presenter presentViewController:picker animated:YES completion:nil];
}
RCT_REMAP_METHOD(cancelHighlights, cancelHighlights:(NSString *)operation) {
  if(![operation isEqual:self.operation]) return;
  UIDocumentPickerViewController *picker=self.picker;
  [picker dismissViewControllerAnimated:YES completion:nil];
  [self finish:@"cancelled" error:NO];
}
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller { if(controller==self.picker) [self finish:@"cancelled" error:NO]; }
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  if(controller!=self.picker) return;
  // User destinations are never retained or deleted. OS completion alone reports saved.
  [self finish:urls.count ? @"saved" : @"cancelled" error:NO];
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ if(self.operation) { [self.picker dismissViewControllerAnimated:NO completion:nil]; [self finish:@"cancelled" error:NO]; } }); }
@end
#endif
