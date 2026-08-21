#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ios = path.join(root, 'apps', 'apple-mobile', 'ios', 'PorticoIOS');
const downloads = fs.readFileSync(path.join(ios, 'PorticoDownloadManager.m'), 'utf8');
const player = fs.readFileSync(path.join(ios, 'PorticoPlayerViewManager.m'), 'utf8');
const tvWrapper = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTVOS', 'PorticoPlayerViewManager.m'), 'utf8');
const mobileProject = fs.readFileSync(path.join(root, 'apps', 'apple-mobile', 'ios', 'PorticoIOS.xcodeproj', 'project.pbxproj'), 'utf8');
const tvProject = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTVOS.xcodeproj', 'project.pbxproj'), 'utf8');
const mobileReleaseGuard = fs.readFileSync(path.join(root, 'apps', 'apple-mobile', 'ios', 'verify-release-metadata.sh'), 'utf8');
const tvReleaseGuard = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'verify-release-metadata.sh'), 'utf8');
const mobileInfo = fs.readFileSync(path.join(root, 'apps', 'apple-mobile', 'ios', 'PorticoIOS', 'Info.plist'), 'utf8');
const mobileEntitlements = fs.readFileSync(path.join(root, 'apps', 'apple-mobile', 'ios', 'PorticoIOS', 'PorticoIOS.entitlements'), 'utf8');
const castBridge = fs.readFileSync(path.join(root, 'apps', 'apple-mobile', 'ios', 'PorticoIOS', 'PorticoGoogleCast.m'), 'utf8');
const tvInfo = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTVOS', 'Info.plist'), 'utf8');
const tvEntitlements = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTVOS', 'PorticoTVOS.entitlements'), 'utf8');
const topShelfBridge = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTVOS', 'PorticoTopShelf.m'), 'utf8');
const topShelfInfo = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTopShelf', 'Info.plist'), 'utf8');
const topShelfEntitlements = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTopShelf', 'PorticoTopShelf.entitlements'), 'utf8');
const topShelfProvider = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'PorticoTopShelf', 'ContentProvider.swift'), 'utf8');
const app = fs.readFileSync(path.join(root, 'packages', 'app', 'src', 'PorticoApp.tsx'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'packages', 'app', 'src', 'ui', 'screens', 'DetailPlayerScreens.tsx'), 'utf8');
const playerScreen = fs.readFileSync(path.join(root, 'packages', 'app', 'src', 'ui', 'player', 'PlayerScreen.tsx'), 'utf8');
const detailAndPlayer = `${detail}\n${playerScreen}`;
const appDelegate = fs.readFileSync(path.join(ios, 'AppDelegate.swift'), 'utf8');
const mobilePackage = fs.readFileSync(path.join(root, 'apps', 'apple-mobile', 'package.json'), 'utf8');
const tvPackage = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'package.json'), 'utf8');
const mobilePods = fs.readFileSync(path.join(root, 'apps', 'apple-mobile', 'ios', 'Podfile.lock'), 'utf8');
const tvPods = fs.readFileSync(path.join(root, 'apps', 'apple-tv', 'ios', 'Podfile.lock'), 'utf8');

const invariants = [
  [downloads, /recoveryMarkerURL/, 'durable download recovery marker'],
  [downloads, /recordsBackupURL/, 'bounded download metadata backup'],
  [downloads, /if \(self\.allowOrphanCleanup \|\| self\.recoveryPending\) \{[\s\S]*removeOrphanedOfflineFiles[\s\S]*persistAndEmit/, 'recovery-aware orphan cleanup gate'],
  [downloads, /if \(!\[self persistAndEmit\]\) \{[\s\S]*reconciliationSucceeded = NO;[\s\S]*markDownloadRecoveryNeeded/, 'reconciliation persistence failure retains recovery marker'],
  [downloads, /if \(self\.recoveryPending\) \{[\s\S]*if \(reconciliationSucceeded && \[self clearDownloadRecoveryMarker\]\)[\s\S]*else \{[\s\S]*markDownloadRecoveryNeeded/, 'recovery marker clears only after successful reconciliation'],
  [downloads, /\[record\[@"state"\] isEqualToString:@"completed"\][\s\S]*isCompleteMediaFileAtURL/, 'no partial media exposure'],
  [downloads, /self\.allowOrphanCleanup = NO;/, 'fail-closed corrupt metadata recovery'],
  [downloads, /if \(backupValid \|\| mediaFiles\.count > 0\)[\s\S]*markDownloadRecoveryNeeded[\s\S]*self\.allowOrphanCleanup = NO/, 'missing metadata media quarantine'],
  [player, /@"state": @"restore-requested"/, 'PiP route restoration request'],
  [player, /self\.window != nil[\s\S]*self\.superview != nil[\s\S]*!self\.hidden/, 'visible PiP restoration proof'],
  [player, /- \(void\)dealloc \{[\s\S]*_pictureInPictureRestoreCompletion[\s\S]*completion\(NO\)/, 'honest pending PiP restoration teardown'],
  [player, /#if !TARGET_OS_TV[\s\S]*AVPictureInPictureController/, 'mobile-only PiP guard'],
  [player, /setCategory:AVAudioSessionCategoryPlayback[\s\S]*options:0/, 'valid Playback audio-session configuration'],
  [player, /resourceLoader:.*shouldWaitForLoadingOfRequestedResource/, 'supported AVAssetResourceLoader authorization path'],
  [player, /content\.contentType = PorticoContentType[\s\S]*content\.contentLength[\s\S]*byteRangeAccessSupported/, 'AVFoundation content information and range contract'],
  [player, /requestedOffset[\s\S]*currentOffset[\s\S]*requestedLength[\s\S]*requestsAllDataToEnd/, 'AVFoundation data-request offset and all-data semantics'],
  [player, /PorticoPlaylistData[\s\S]*PorticoSyntheticURL/, 'HLS child-resource URI rewriting'],
  [player, /didCancelLoadingRequest[\s\S]*\[self\.loads\[identifier\]\.task cancel\]/, 'resource-loader cancellation'],
  [player, /willPerformHTTPRedirection[\s\S]*PorticoApprovedResourceURL\(request\.URL, self\.allowedOrigins, self\.routePolicy\)[\s\S]*completionHandler\(nil\)/, 'selected-origin redirect boundary'],
  [player, /setPlaybackDescriptor:[\s\S]*_descriptorRevision[\s\S]*_descriptorAllowedOrigins/, 'atomic Apple playback descriptor'],
  [player, /stateQueue = dispatch_queue_create[\s\S]*delegateQueue\.underlyingQueue = _stateQueue/, 'serial resource-loader state'],
  [player, /maybeRenewGrantInBackground[\s\S]*PorticoPlayback[\s\S]*continuationExpiresAt/, 'scoped continuation background renewal'],
  [player, /expectedContinuationPath[\s\S]*PorticoOriginInAllowlist[\s\S]*continuationGeneration/, 'exact scoped continuation descriptor'],
  [player, /PorticoISO8601Date[\s\S]*NSISO8601DateFormatWithFractionalSeconds/, 'fractional server timestamp compatibility'],
  [player, /setAllowsCellularAccess[\s\S]*localAsset[\s\S]*_playbackDescriptor/, 'cellular access requires a complete online descriptor'],
  [player, /PorticoTrustedInsecureHost[\s\S]*allowInsecureLan/, 'private-origin-only insecure LAN policy'],
  [player, /seekToTime:[\s\S]*completionHandler:[\s\S]*playbackGeneration/, 'generation-safe asynchronous resume seek'],
  [player, /PorticoAudioSessionOwners[\s\S]*setActive:NO/, 'shared final audio-session ownership'],
  [player, /constantsToExport[\s\S]*applePlaybackProfile[\s\S]*probeCapabilities:[\s\S]*PorticoApplePlaybackProfile/, 'native Apple view-manager capability authority'],
  [player, /@"maxAudioChannels": @2/, 'route-evidence-safe stereo capability ceiling'],
  [player, /@"maxVideoBitDepth": @8[\s\S]*@"supportsHdr": @NO/, 'display-evidence-safe SDR capability ceiling'],
  [player, /@"supportedHdrFormats": @\[\]/, 'empty HDR claims without exact active-display evidence'],
  [tvWrapper, /^#import "\.\.\/\.\.\/\.\.\/apple-mobile\/ios\/PorticoIOS\/PorticoPlayerViewManager\.m"\s*$/m, 'single guarded tvOS player implementation'],
  [app, /value=\{pin\}/, 'server-authoritative profile PIN input'],
  [app, /keyboardType="number-pad"/, 'numeric profile PIN keyboard'],
  [app, /maxLength=\{4\}/, 'four-digit profile PIN input limit'],
  [appDelegate, /reviewedNotificationTarget\(in: payload\)/, 'reviewed notification routing boundary'],
  [appDelegate, /backgroundSessionWatchdogs[\s\S]*asyncAfter[\s\S]*backgroundSessionWatchdogSeconds/, 'bounded background download completion watchdog'],
  [appDelegate, /reviewedPorticoNotificationURL/, 'notification Portico URL allowlist'],
  [appDelegate, /reviewedStructuredNotificationAction/, 'structured notification action allowlist'],
  [appDelegate, /notificationUniversalLinkHost = "app\.getportico\.tv"/, 'exact Portico universal-link host'],
  [mobilePackage, /"@react-native-community\/netinfo": "12\.0\.1"/, 'direct iOS NetInfo native dependency'],
  [tvPackage, /"@react-native-community\/netinfo": "12\.0\.1"/, 'direct tvOS NetInfo native dependency'],
  [mobilePods, /react-native-netinfo \(12\.0\.1\)/, 'linked iOS NetInfo pod'],
  [tvPods, /react-native-netinfo \(12\.0\.1\)/, 'linked tvOS NetInfo pod'],
  [mobileProject, /E10000000000000000000001 \/\* Verify Release metadata \*\//, 'iOS release metadata build phase'],
  [mobileProject, /CODE_SIGN_STYLE = Manual;[\s\S]*CODE_SIGNING_REQUIRED = YES;[\s\S]*DEVELOPMENT_TEAM = "\$\(PORTICO_RELEASE_DEVELOPMENT_TEAM\)";[\s\S]*PORTICO_CAST_RECEIVER_APPLICATION_ID = "\$\(PORTICO_RELEASE_CAST_RECEIVER_APPLICATION_ID\)";[\s\S]*PRODUCT_BUNDLE_IDENTIFIER = tv\.getportico\.ios;[\s\S]*PROVISIONING_PROFILE_SPECIFIER = "\$\(PORTICO_RELEASE_PROVISIONING_PROFILE_SPECIFIER\)";/, 'iOS fail-closed release identity and metadata'],
  [tvProject, /E20000000000000000000001 \/\* Verify Release metadata \*\//, 'tvOS release metadata build phase'],
  [tvProject, /E20000000000000000000002 \/\* Verify Release metadata \*\//, 'tvOS extension release metadata build phase'],
  [tvProject, /CODE_SIGN_STYLE = Manual;[\s\S]*CODE_SIGNING_REQUIRED = YES;[\s\S]*DEVELOPMENT_TEAM = "\$\(PORTICO_RELEASE_DEVELOPMENT_TEAM\)";[\s\S]*PROVISIONING_PROFILE_SPECIFIER = "\$\(PORTICO_RELEASE_PROVISIONING_PROFILE_SPECIFIER\)";/, 'tvOS fail-closed release identity'],
  [tvProject, /PRODUCT_BUNDLE_IDENTIFIER = tv\.getportico\.tvos\.topshelf;[\s\S]*PROVISIONING_PROFILE_SPECIFIER = "\$\(PORTICO_RELEASE_TOPSHELF_PROVISIONING_PROFILE_SPECIFIER\)";/, 'tvOS extension release identity'],
  [mobileReleaseGuard, /CONFIGURATION:-.*Release/, 'iOS Release-only metadata guard'],
  [mobileReleaseGuard, /PORTICO_CAST_RECEIVER_APPLICATION_ID/, 'iOS required Cast receiver release metadata'],
  [downloads, /PorticoDownloadSessionIdentifier = @"tv\.getportico\.ios\.offline-downloads"/, 'iOS background session public identity'],
  [castBridge, /applicationID\.length ===? 0|applicationID\.length == 0[\s\S]*CC1AD845/, 'Cast placeholder rejection'],
  [castBridge, /boundReceiverID[\s\S]*isEqualToString:configuredReceiverID/, 'Cast receiver envelope identity binding'],
  [castBridge, /- \(void\)startObserving[\s\S]*dispatch_async\(dispatch_get_main_queue\(\)[\s\S]*addListener:self/, 'Cast listener registration on the required main queue'],
  [castBridge, /- \(void\)stopObserving[\s\S]*dispatch_async\(dispatch_get_main_queue\(\)[\s\S]*removeListener:self/, 'Cast listener removal on the required main queue'],
  [tvReleaseGuard, /CONFIGURATION:-.*Release/, 'tvOS Release-only metadata guard'],
  [tvReleaseGuard, /PRODUCT_BUNDLE_IDENTIFIER/, 'tvOS target-specific release metadata guard'],
  [mobileInfo, /<key>CFBundleIdentifier<\/key>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/, 'iOS Info.plist bundle identity indirection'],
  [mobileInfo, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/, 'iOS Info.plist marketing version indirection'],
  [mobileInfo, /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/, 'iOS Info.plist build number indirection'],
  [mobileEntitlements, /<key>aps-environment<\/key>\s*<string>\$\(APS_ENVIRONMENT\)<\/string>/, 'iOS push entitlement environment indirection'],
  [tvInfo, /<key>CFBundleIdentifier<\/key>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/, 'tvOS Info.plist bundle identity indirection'],
  [tvInfo, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/, 'tvOS Info.plist marketing version indirection'],
  [tvInfo, /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/, 'tvOS Info.plist build number indirection'],
  [tvEntitlements, /group\.tv\.getportico/, 'tvOS application-group entitlement'],
  [topShelfInfo, /<key>CFBundleIdentifier<\/key>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/, 'tvOS Top Shelf bundle identity indirection'],
  [topShelfEntitlements, /group\.tv\.getportico/, 'tvOS Top Shelf application-group entitlement'],
  [topShelfBridge, /group\.tv\.getportico/, 'tvOS Top Shelf bridge application group'],
  [topShelfProvider, /group\.tv\.getportico/, 'tvOS Top Shelf provider application group'],
];

for (const [source, pattern, label] of invariants) {
  if (!pattern.test(source)) {
    console.error(`Apple native source invariant missing: ${label}.`);
    process.exit(1);
  }
}

for (const [pattern, label] of [
  [/<MediaRow[\s\S]{0,180}shape="poster"/, 'detail row overriding Product Contract artwork roles'],
  [/if let value = payload\["url"\][\s\S]{0,160}RCTLinkingManager/, 'unreviewed notification payload URL forwarding'],
  [/const originalSessionId = value\.sessionId/, 'duplicate Apple playback start after initial negotiation'],
]) {
  const source = label.startsWith('detail row') ? detail : label.startsWith('unreviewed notification') ? appDelegate : label.startsWith('duplicate Apple') ? detailAndPlayer : app;
  if (pattern.test(source)) {
    console.error(`Apple native source invariant violated: ${label}.`);
    process.exit(1);
  }
}

if (/AVURLAssetHTTPHeaderFieldsKey/.test(player)) {
  console.error('Apple native source invariant violated: undocumented AVURLAsset header option is active.');
  process.exit(1);
}
if (/AVAudioSessionCategoryOptionAllowAirPlay/.test(player)) {
  console.error('Apple native source invariant violated: AllowAirPlay was explicitly applied to Playback.');
  process.exit(1);
}
if (/potentialEDRHeadroom|maximumOutputNumberOfChannels/.test(player)) {
  console.error('Apple native source invariant violated: screen or route maxima were promoted to playback capability evidence.');
  process.exit(1);
}
if (/routeType\s*===\s*['"]lan['"]/.test(detailAndPlayer)) {
  console.error('Apple native source invariant violated: insecure-origin policy is derived from a route label.');
  process.exit(1);
}
if (/\$\([^)]*:-/.test(mobileProject) || /\$\([^)]*:-/.test(tvProject)) {
  console.error('Apple native source invariant violated: release metadata contains a fallback build-setting alias.');
  process.exit(1);
}
for (const [source, label] of [
  [mobileProject, 'iOS Xcode project'],
  [tvProject, 'tvOS Xcode project'],
  [downloads, 'iOS background session'],
  [tvEntitlements, 'tvOS application entitlements'],
  [topShelfBridge, 'tvOS Top Shelf bridge'],
  [topShelfProvider, 'tvOS Top Shelf provider'],
]) {
  if (/justinehler\.portico|group\.justinehler\.portico/.test(source)) {
    console.error(`Apple native source invariant violated: ${label} retains the superseded public identity.`);
    process.exit(1);
  }
}

console.log(`Apple native source invariants passed (${invariants.length} checks).`);
