#import <Foundation/Foundation.h>
#import "../Native/PorticoDownloadStorage.h"
static BOOL expect(BOOL value,const char *what){if(!value)fprintf(stderr,"FAIL %s\n",what);return value;}
int main(void){@autoreleasepool{
 NSFileManager *files=NSFileManager.defaultManager;NSURL *base=[[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES]URLByAppendingPathComponent:NSUUID.UUID.UUIDString isDirectory:YES];
 NSURL *root=[base URLByAppendingPathComponent:@"downloads" isDirectory:YES],*viewer=[root URLByAppendingPathComponent:@"other-viewer" isDirectory:YES],*outside=[base URLByAppendingPathComponent:@"outside" isDirectory:YES];NSError *error=nil;BOOL ok=YES;
 ok=expect([files createDirectoryAtURL:viewer withIntermediateDirectories:YES attributes:nil error:&error]&&[files createDirectoryAtURL:outside withIntermediateDirectories:YES attributes:nil error:&error],"create isolated fixture directories")&&ok;
 NSURL *partial=[root URLByAppendingPathComponent:@"file.partial"],*ready=[viewer URLByAppendingPathComponent:@"ready.bin"],*extra=[viewer URLByAppendingPathComponent:@"font.extra"],*external=[outside URLByAppendingPathComponent:@"large.bin"],*alias=[root URLByAppendingPathComponent:@"same-inode.bin"],*pointer=[root URLByAppendingPathComponent:@"file-link"],*directoryLink=[root URLByAppendingPathComponent:@"directory-link"];
 ok=expect([[NSMutableData dataWithLength:13]writeToURL:partial atomically:NO]&&[[NSMutableData dataWithLength:17]writeToURL:ready atomically:NO]&&[[NSMutableData dataWithLength:4]writeToURL:extra atomically:NO]&&[[NSMutableData dataWithLength:1048576]writeToURL:external atomically:NO],"write actual regular/partial/extra/external files")&&ok;
 ok=expect(link(ready.fileSystemRepresentation,alias.fileSystemRepresentation)==0&&symlink(external.fileSystemRepresentation,pointer.fileSystemRepresentation)==0&&symlink(outside.fileSystemRepresentation,directoryLink.fileSystemRepresentation)==0,"create hardlink and nontraversable symbolic links")&&ok;
 // An independent, explicit list of distinct fixture inodes. No recursive traversal in the oracle.
 uint64_t allocated=0;for(NSURL *url in @[root,viewer,partial,ready,extra,pointer,directoryLink]){struct stat attributes;if(lstat(url.fileSystemRepresentation,&attributes)){ok=NO;break;}allocated+=(uint64_t)attributes.st_blocks*512;}
 NSDictionary *actual=PorticoDownloadStorage(root);
 ok=expect([actual[@"storedBytes"]unsignedLongLongValue]==34&&actual[@"storedBytes"],"logical regular-file total across viewers deduplicates hardlinks and excludes links/targets")&&ok;
 ok=expect(actual[@"allocatedBytes"]&&[actual[@"allocatedBytes"]unsignedLongLongValue]==allocated,"allocation counts unique file/directory/link-own OS blocks")&&ok;
 ok=expect(PorticoDownloadStorage([base URLByAppendingPathComponent:@"missing"]).count==0&&PorticoDownloadStorage(directoryLink).count==0&&PorticoDownloadStorage(ready).count==0,"missing/non-directory/link roots remain unknown")&&ok;
 NSDictionary *capacity=[root resourceValuesForKeys:@[NSURLVolumeTotalCapacityKey]error:&error];ok=expect([capacity[NSURLVolumeTotalCapacityKey]longLongValue]>0,"same-root OS volume capacity available")&&ok;
 printf("{\"downloadStorageAccountingPass\":%s,\"storedBytes\":%llu,\"allocatedBytes\":%llu,\"referenceAllocatedBytes\":%llu,\"volumeTotalBytes\":%llu}\n",ok?"true":"false",[actual[@"storedBytes"]unsignedLongLongValue],[actual[@"allocatedBytes"]unsignedLongLongValue],(unsigned long long)allocated,[capacity[NSURLVolumeTotalCapacityKey]unsignedLongLongValue]);
 [files removeItemAtURL:base error:nil];return ok?0:1;
}}
