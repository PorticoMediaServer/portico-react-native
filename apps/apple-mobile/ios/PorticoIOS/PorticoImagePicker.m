#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <PhotosUI/PhotosUI.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@interface PorticoImagePicker : NSObject <RCTBridgeModule, PHPickerViewControllerDelegate>
@property(nonatomic, copy) RCTPromiseResolveBlock resolve;
@property(nonatomic, copy) RCTPromiseRejectBlock reject;
@end

@implementation PorticoImagePicker
RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(pickImage:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.resolve) { reject(@"picker_busy", @"The image picker is already open.", nil); return; }
    self.resolve = resolve; self.reject = reject;
    PHPickerConfiguration *configuration = [[PHPickerConfiguration alloc] initWithPhotoLibrary:PHPhotoLibrary.sharedPhotoLibrary];
    configuration.filter = PHPickerFilter.imagesFilter;
    configuration.selectionLimit = 1;
    PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:configuration];
    picker.delegate = self;
    UIViewController *controller = RCTPresentedViewController();
    if (!controller) { [self finishWithError:@"picker_unavailable" message:@"Portico could not open the image picker."]; return; }
    [controller presentViewController:picker animated:YES completion:nil];
  });
}

- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results {
  [picker dismissViewControllerAnimated:YES completion:nil];
  PHPickerResult *result = results.firstObject;
  if (!result) { [self finishWithValue:[NSNull null]]; return; }
  [result.itemProvider loadFileRepresentationForTypeIdentifier:UTTypeImage.identifier completionHandler:^(NSURL *url, NSError *error) {
    if (error || !url) { [self finishWithError:@"picker_read_failed" message:@"Portico could not read that image."]; return; }
    NSString *extension = url.pathExtension.length ? url.pathExtension.lowercaseString : @"jpg";
    NSURL *destination = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"portico-avatar-%@.%@", NSUUID.UUID.UUIDString, extension]]];
    NSError *copyError;
    if (![NSFileManager.defaultManager copyItemAtURL:url toURL:destination error:&copyError]) { [self finishWithError:@"picker_copy_failed" message:@"Portico could not prepare that image."]; return; }
    NSString *mime = [extension isEqualToString:@"png"] ? @"image/png" : ([extension isEqualToString:@"gif"] ? @"image/gif" : @"image/jpeg");
    [self finishWithValue:@{ @"uri": destination.absoluteString, @"name": destination.lastPathComponent, @"type": mime }];
  }];
}

- (void)finishWithValue:(id)value { dispatch_async(dispatch_get_main_queue(), ^{ if (self.resolve) self.resolve(value); self.resolve = nil; self.reject = nil; }); }
- (void)finishWithError:(NSString *)code message:(NSString *)message { dispatch_async(dispatch_get_main_queue(), ^{ if (self.reject) self.reject(code, message, nil); self.resolve = nil; self.reject = nil; }); }
@end
