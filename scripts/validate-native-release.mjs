#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const reactNativeRoot = "apps/portico-react-native";
const sharedSourceHooks = Object.freeze([
  `${reactNativeRoot}/scripts/validate-native-release.mjs`,
  `${reactNativeRoot}/scripts/verify-apple-native-source.cjs`,
  `${reactNativeRoot}/scripts/verify-product-copy.cjs`,
]);

const NATIVE_TARGETS = {
  "android-mobile": {
    key: "android-mobile",
    platform: "android",
    project: `${reactNativeRoot}/apps/apple-mobile/android`,
    gradle: `${reactNativeRoot}/apps/apple-mobile/android/app/build.gradle`,
    settings: `${reactNativeRoot}/apps/apple-mobile/android/settings.gradle`,
    manifest: `${reactNativeRoot}/apps/apple-mobile/android/app/src/main/AndroidManifest.xml`,
    flavor: "mobile",
    applicationId: "tv.getportico.android",
    runtimeFamily: "android-mobile",
    debugTask: ":app:assembleMobileDebug",
    releaseTask: ":app:assembleMobileRelease",
    releaseDependencyConfiguration: "mobileReleaseRuntimeClasspath",
    packageRelativePath: `${reactNativeRoot}/apps/apple-mobile/android/app/build/outputs/apk/mobile/debug`,
    acceptanceHooks: [`${reactNativeRoot}/apps/apple-mobile/__tests__/App.test.tsx`],
    requireLeanback: false,
  },
  "fire-tv": {
    key: "fire-tv",
    platform: "android",
    project: `${reactNativeRoot}/apps/apple-mobile/android`,
    gradle: `${reactNativeRoot}/apps/apple-mobile/android/app/build.gradle`,
    settings: `${reactNativeRoot}/apps/apple-mobile/android/settings.gradle`,
    manifest: `${reactNativeRoot}/apps/apple-mobile/android/app/src/main/AndroidManifest.xml`,
    flavor: "fireTv",
    applicationId: "tv.getportico.firetv",
    runtimeFamily: "fire-tv",
    debugTask: ":app:assembleFireTvDebug",
    releaseTask: ":app:assembleFireTvRelease",
    releaseDependencyConfiguration: "fireTvReleaseRuntimeClasspath",
    packageRelativePath: `${reactNativeRoot}/apps/apple-mobile/android/app/build/outputs/apk/fireTv/debug`,
    acceptanceHooks: [`${reactNativeRoot}/apps/apple-mobile/__tests__/App.test.tsx`],
    requireLeanback: false,
  },
  "android-tv": {
    key: "android-tv",
    platform: "android",
    project: `${reactNativeRoot}/apps/apple-tv/android`,
    gradle: `${reactNativeRoot}/apps/apple-tv/android/app/build.gradle`,
    settings: `${reactNativeRoot}/apps/apple-tv/android/settings.gradle`,
    manifest: `${reactNativeRoot}/apps/apple-tv/android/app/src/main/AndroidManifest.xml`,
    flavor: "androidTv",
    applicationId: "tv.getportico.androidtv",
    runtimeFamily: "android-tv",
    debugTask: ":app:assembleAndroidTvDebug",
    releaseTask: ":app:assembleAndroidTvRelease",
    releaseDependencyConfiguration: "androidTvReleaseRuntimeClasspath",
    packageRelativePath: `${reactNativeRoot}/apps/apple-tv/android/app/build/outputs/apk/androidTv/debug`,
    acceptanceHooks: [`${reactNativeRoot}/apps/apple-tv/__tests__/App.test.tsx`],
    requireLeanback: true,
  },
  "apple-ios": {
    key: "apple-ios",
    platform: "apple",
    project: `${reactNativeRoot}/apps/apple-mobile/ios`,
    workspace: "PorticoIOS.xcworkspace",
    scheme: "PorticoIOS",
    sdk: "iphonesimulator",
    destination: "generic/platform=iOS Simulator",
    projectFile: `${reactNativeRoot}/apps/apple-mobile/ios/PorticoIOS.xcodeproj/project.pbxproj`,
    targetName: "PorticoIOS",
    plist: `${reactNativeRoot}/apps/apple-mobile/ios/PorticoIOS/Info.plist`,
    entitlements: `${reactNativeRoot}/apps/apple-mobile/ios/PorticoIOS/PorticoIOS.entitlements`,
    plistReference: "PorticoIOS/Info.plist",
    entitlementsReference: "PorticoIOS/PorticoIOS.entitlements",
    bundleIdentifier: "tv.getportico.ios",
    packageRelativePath: `${reactNativeRoot}/apps/apple-mobile/ios/.native-derived-data/Build/Products/Debug-iphonesimulator/PorticoIOS.app`,
    acceptanceHooks: [`${reactNativeRoot}/apps/apple-mobile/__tests__/App.test.tsx`],
    requiredInfoStrings: [["CFBundleIdentifier", "$(PRODUCT_BUNDLE_IDENTIFIER)"], ["CFBundleExecutable", "$(EXECUTABLE_NAME)"], ["CFBundleName", "$(PRODUCT_NAME)"], ["PorticoGoogleCastReceiverApplicationID", "$(PORTICO_CAST_RECEIVER_APPLICATION_ID)"], ["NSLocalNetworkUsageDescription", "Portico discovers nearby servers, TVs, and Cast devices so you can connect and play media on your local network."]],
    requiredInfoBooleans: [["NSAllowsArbitraryLoads", false], ["NSAllowsLocalNetworking", true], ["LSRequiresIPhoneOS", true]],
    requiredInfoArrays: [["NSBonjourServices", ["_googlecast._tcp", "_portico._tcp", "_portico-receiver._tcp", "_portico-setup._tcp"]], ["UIBackgroundModes", ["audio", "remote-notification"]]],
    requiredEntitlementStrings: [["aps-environment", "$(APS_ENVIRONMENT)"]],
    requiredEntitlementArrays: [["com.apple.developer.associated-domains", ["applinks:app.getportico.tv"]]],
  },
  "apple-tvos": {
    key: "apple-tvos",
    platform: "apple",
    project: `${reactNativeRoot}/apps/apple-tv/ios`,
    workspace: "PorticoTVOS.xcworkspace",
    scheme: "PorticoTVOS",
    sdk: "appletvsimulator",
    destination: "generic/platform=tvOS Simulator",
    projectFile: `${reactNativeRoot}/apps/apple-tv/ios/PorticoTVOS.xcodeproj/project.pbxproj`,
    targetName: "PorticoTVOS",
    plist: `${reactNativeRoot}/apps/apple-tv/ios/PorticoTVOS/Info.plist`,
    entitlements: `${reactNativeRoot}/apps/apple-tv/ios/PorticoTVOS/PorticoTVOS.entitlements`,
    plistReference: "PorticoTVOS/Info.plist",
    entitlementsReference: "PorticoTVOS/PorticoTVOS.entitlements",
    bundleIdentifier: "tv.getportico.tvos",
    packageRelativePath: `${reactNativeRoot}/apps/apple-tv/ios/.native-derived-data/Build/Products/Debug-appletvsimulator/PorticoTVOS.app`,
    acceptanceHooks: [`${reactNativeRoot}/apps/apple-tv/__tests__/App.test.tsx`],
    requiredInfoStrings: [["CFBundleIdentifier", "$(PRODUCT_BUNDLE_IDENTIFIER)"], ["CFBundleExecutable", "$(EXECUTABLE_NAME)"], ["CFBundleName", "$(PRODUCT_NAME)"], ["NSLocalNetworkUsageDescription", "Portico advertises secure setup availability and discovers nearby Portico services on your local network."]],
    requiredInfoBooleans: [["NSAllowsArbitraryLoads", false], ["NSAllowsLocalNetworking", true], ["LSRequiresIPhoneOS", true]],
    requiredInfoArrays: [["NSBonjourServices", ["_portico._tcp", "_portico-receiver._tcp", "_portico-setup._tcp"]]],
    requiredEntitlementArrays: [["com.apple.security.application-groups", ["group.tv.getportico"]]],
    extensions: [{
      targetName: "PorticoTopShelf",
      plist: `${reactNativeRoot}/apps/apple-tv/ios/PorticoTopShelf/Info.plist`,
      entitlements: `${reactNativeRoot}/apps/apple-tv/ios/PorticoTopShelf/PorticoTopShelf.entitlements`,
      plistReference: "PorticoTopShelf/Info.plist",
      entitlementsReference: "PorticoTopShelf/PorticoTopShelf.entitlements",
      requiredInfoStrings: [["CFBundleIdentifier", "$(PRODUCT_BUNDLE_IDENTIFIER)"], ["NSExtensionPointIdentifier", "com.apple.tv-services"], ["NSExtensionPrincipalClass", "$(PRODUCT_MODULE_NAME).ContentProvider"]],
      requiredEntitlementArrays: [["com.apple.security.application-groups", ["group.tv.getportico"]]],
    }],
  },
};

export const NATIVE_TARGET_KEYS = Object.freeze(Object.keys(NATIVE_TARGETS));
export { NATIVE_TARGETS };

const sourceHookScripts = Object.freeze([
  "verify:apple-native-source",
  "verify:product-copy",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  throw new Error(message);
}

function requiredFile(root, path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) fail(`required native release input is missing: ${path}`);
  return absolute;
}

function requiredDirectory(root, path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) fail(`required native release directory is missing: ${path}`);
  return absolute;
}

function readRequired(root, path) {
  return readFileSync(requiredFile(root, path), "utf8");
}

function requireText(text, token, label) {
  if (!text.includes(token)) fail(`${label} is missing ${token}`);
}

function requirePattern(text, pattern, label) {
  if (!pattern.test(text)) fail(`${label} does not satisfy ${pattern}`);
}

function sha256File(path) {
  const bytes = readFileSync(path);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function sourceFileEvidence(root, path, kind) {
  const absolute = requiredFile(root, path);
  return { path, kind, ...sha256File(absolute) };
}

function plistString(text, key, value) {
  return new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>${escapeRegExp(value)}</string>`).test(text);
}

function plistBoolean(text, key, value) {
  const element = value ? "true" : "false";
  return new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<${element}\\s*/>`).test(text);
}

function plistArrayContains(text, key, values) {
  const section = text.match(new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1];
  return Boolean(section) && values.every((value) => new RegExp(`<string>${escapeRegExp(value)}</string>`).test(section));
}

function validateSourceHooks(root, targetKeys) {
  const packageJSON = JSON.parse(readRequired(root, `${reactNativeRoot}/package.json`));
  for (const scriptName of sourceHookScripts) {
    if (typeof packageJSON.scripts?.[scriptName] !== "string" || !packageJSON.scripts[scriptName].trim()) fail(`React Native package is missing ${scriptName}`);
    if (!packageJSON.scripts.pretypecheck?.includes(scriptName.replace("verify:", "verify:"))) fail(`pretypecheck does not invoke ${scriptName}`);
    if (!packageJSON.scripts.pretest?.includes(scriptName.replace("verify:", "verify:"))) fail(`pretest does not invoke ${scriptName}`);
  }
  const paths = new Set(sharedSourceHooks);
  for (const key of targetKeys) for (const path of NATIVE_TARGETS[key].acceptanceHooks) paths.add(path);
  const evidence = [];
  for (const path of paths) {
    const kind = path.endsWith(".test.tsx") ? "acceptance-source-test" : path.endsWith("validate-native-release.mjs") ? "release-guard" : "source-guard";
    const item = sourceFileEvidence(root, path, kind);
    if (kind === "acceptance-source-test" && !/\b(?:describe|test|it)\s*\(/.test(readRequired(root, path))) fail(`${path} is not an executable source acceptance hook`);
    evidence.push(item);
  }
  return evidence;
}

export function validateReleaseSigningGuard(gradle, label) {
  requirePattern(gradle, /def releaseSigningValue\s*=\s*\{/, `${label} release signing guard`);
  for (const environmentName of [
    "PORTICO_ANDROID_RELEASE_STORE_FILE",
    "PORTICO_ANDROID_RELEASE_STORE_PASSWORD",
    "PORTICO_ANDROID_RELEASE_KEY_ALIAS",
    "PORTICO_ANDROID_RELEASE_KEY_PASSWORD",
  ]) requireText(gradle, environmentName, `${label} release signing guard`);
  requireText(gradle, "def releaseSigningReady = [releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword].every { it }", `${label} release signing guard`);
  requireText(gradle, "tasks.register('verifyReleaseSigning')", `${label} release signing guard`);
  requireText(gradle, "throw new GradleException(", `${label} release signing guard`);
  requirePattern(gradle, /if \(!file\(releaseStoreFile\)\.isFile\(\)\)/, `${label} release signing guard`);
  requirePattern(gradle, /task\.name ==~ \/\^\(assemble\|bundle\|package\)\.\+Release\$\//, `${label} release package dependency guard`);
  requirePattern(gradle, /release\s*\{[\s\S]*?if \(releaseSigningReady\) signingConfig signingConfigs\.release/, `${label} release signing selection`);
  if (/signingConfigs\.debug/.test(gradle)) fail(`${label} release signing guard permits the debug key`);
  if (/(?:releaseStoreFile|releaseStorePassword|releaseKeyAlias|releaseKeyPassword)\s*=\s*["'][^"']+["']/.test(gradle)) fail(`${label} contains an inline release credential`);
}

function validateAndroidTarget(root, target) {
  const gradle = readRequired(root, target.gradle);
  const settings = readRequired(root, target.settings);
  const manifest = readRequired(root, target.manifest);
  const flavorPattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(target.flavor)}\\s*\\{[\\s\\S]*?\\n\\s*\\}`);
  requirePattern(gradle, flavorPattern, `${target.key} flavor declaration`);
  const flavorBlock = gradle.match(flavorPattern)?.[0] || "";
  requireText(flavorBlock, 'dimension "runtime"', `${target.key} flavor declaration`);
  requireText(flavorBlock, `applicationId "${target.applicationId}"`, `${target.key} flavor application ID`);
  requireText(flavorBlock, `porticoRuntimeFamily: "${target.runtimeFamily}"`, `${target.key} runtime family`);
  requireText(gradle, 'flavorDimensions "runtime"', `${target.key} flavor dimensions`);
  requireText(settings, "include ':app'", `${target.key} Gradle settings`);
  requireText(settings, "includeBuild('../../../node_modules/@react-native/gradle-plugin')", `${target.key} Gradle settings`);
  requireText(manifest, 'android:usesCleartextTraffic="${usesCleartextTraffic}"', `${target.key} manifest`);
  requireText(manifest, 'android:name="tv.getportico.runtime_family"', `${target.key} manifest`);
  requireText(manifest, 'android:value="${porticoRuntimeFamily}"', `${target.key} manifest`);
  requireText(manifest, 'android:allowBackup="false"', `${target.key} manifest`);
  requireText(manifest, 'android:exported="true"', `${target.key} launcher manifest`);
  requireText(manifest, 'android.intent.action.MAIN', `${target.key} launcher manifest`);
  requireText(manifest, 'android.intent.category.LAUNCHER', `${target.key} launcher manifest`);
  if (target.requireLeanback) requireText(manifest, 'android.intent.category.LEANBACK_LAUNCHER', `${target.key} leanback manifest`);
  validateReleaseSigningGuard(gradle, target.key);
  return {
    target: target.key,
    platform: target.platform,
    flavor: target.flavor,
    applicationId: target.applicationId,
    runtimeFamily: target.runtimeFamily,
    debugTask: target.debugTask,
    releaseTask: target.releaseTask,
    releaseDependencyConfiguration: target.releaseDependencyConfiguration,
    releaseSigning: { guarded: true, credentialsRequiredForRelease: true, productionCredentialsUsedByGuard: false },
    sourceFiles: [
      sourceFileEvidence(root, target.gradle, "android-build-config"),
      sourceFileEvidence(root, target.settings, "android-settings"),
      sourceFileEvidence(root, target.manifest, "android-manifest"),
    ],
  };
}

function validatePlistRequirements(text, targetLabel, requirements = {}) {
  for (const [key, value] of requirements.strings || []) if (!plistString(text, key, value)) fail(`${targetLabel} plist is missing ${key}=${value}`);
  for (const [key, value] of requirements.booleans || []) if (!plistBoolean(text, key, value)) fail(`${targetLabel} plist has an invalid ${key}`);
  for (const [key, values] of requirements.arrays || []) if (!plistArrayContains(text, key, values)) fail(`${targetLabel} plist is missing required ${key} values`);
}

function validateEntitlementRequirements(text, targetLabel, requirements = {}) {
  for (const [key, value] of requirements.strings || []) if (!plistString(text, key, value)) fail(`${targetLabel} entitlements are missing ${key}=${value}`);
  for (const [key, values] of requirements.arrays || []) if (!plistArrayContains(text, key, values)) fail(`${targetLabel} entitlements are missing required ${key} values`);
}

function validateAppleTarget(root, target) {
  const project = readRequired(root, target.projectFile);
  requiredDirectory(root, `${target.project}/${target.workspace}`);
  requireText(project, `PBXNativeTarget \"${target.targetName}\"`, `${target.key} Xcode target`);
  requireText(project, `INFOPLIST_FILE = ${target.plistReference};`, `${target.key} Info.plist reference`);
  requireText(project, `CODE_SIGN_ENTITLEMENTS = ${target.entitlementsReference};`, `${target.key} entitlements reference`);
  requireText(project, `PRODUCT_BUNDLE_IDENTIFIER = ${target.bundleIdentifier};`, `${target.key} bundle identifier`);
  const plist = readRequired(root, target.plist);
  const entitlements = readRequired(root, target.entitlements);
  validatePlistRequirements(plist, `${target.key} app`, { strings: target.requiredInfoStrings, booleans: target.requiredInfoBooleans, arrays: target.requiredInfoArrays });
  validateEntitlementRequirements(entitlements, `${target.key} app`, { strings: target.requiredEntitlementStrings, arrays: target.requiredEntitlementArrays });
  const sourceFiles = [
    sourceFileEvidence(root, target.projectFile, "apple-project"),
    sourceFileEvidence(root, target.plist, "apple-info-plist"),
    sourceFileEvidence(root, target.entitlements, "apple-entitlements"),
  ];
  for (const extension of target.extensions || []) {
    requiredFile(root, extension.plist);
    requiredFile(root, extension.entitlements);
    requireText(project, `PBXNativeTarget \"${extension.targetName}\"`, `${target.key} extension target`);
    requireText(project, `INFOPLIST_FILE = ${extension.plistReference};`, `${target.key} extension Info.plist reference`);
    requireText(project, `CODE_SIGN_ENTITLEMENTS = ${extension.entitlementsReference};`, `${target.key} extension entitlements reference`);
    validatePlistRequirements(readRequired(root, extension.plist), `${target.key} ${extension.targetName}`, { strings: extension.requiredInfoStrings, booleans: extension.requiredInfoBooleans, arrays: extension.requiredInfoArrays });
    validateEntitlementRequirements(readRequired(root, extension.entitlements), `${target.key} ${extension.targetName}`, { strings: extension.requiredEntitlementStrings, arrays: extension.requiredEntitlementArrays });
    sourceFiles.push(sourceFileEvidence(root, extension.plist, "apple-extension-info-plist"), sourceFileEvidence(root, extension.entitlements, "apple-extension-entitlements"));
  }
  return {
    target: target.key,
    platform: target.platform,
    workspace: target.workspace,
    scheme: target.scheme,
    sdk: target.sdk,
    destination: target.destination,
    bundleIdentifier: target.bundleIdentifier,
    signing: { simulatorBuildMustDisableSigning: true, productionCredentialsUsedByGuard: false },
    sourceFiles,
  };
}

function validatePackage(root, target, packagePath) {
  const requested = isAbsolute(packagePath) ? packagePath : resolve(root, packagePath);
  if (target.platform === "android") {
    requiredDirectory(root, relative(root, requested));
    const packages = readdirSync(requested).filter((entry) => entry.endsWith(".apk"));
    if (packages.length !== 1) fail(`${target.key} debug package directory must contain exactly one APK; found ${packages.length}`);
    const packageFile = join(requested, packages[0]);
    const metadata = lstatSync(packageFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) fail(`${target.key} debug APK is not a regular nonempty file`);
    if (readFileSync(packageFile).subarray(0, 4).toString("binary") !== "PK\u0003\u0004") fail(`${target.key} debug APK is not a ZIP package`);
    const listing = spawnSync("unzip", ["-Z1", packageFile], { encoding: "utf8" });
    if (listing.error || listing.status !== 0 || !listing.stdout.split(/\r?\n/).includes("AndroidManifest.xml")) fail(`${target.key} debug APK does not contain AndroidManifest.xml`);
    return { kind: "android-apk", path: relative(root, packageFile).replaceAll("\\", "/"), ...sha256File(packageFile) };
  }
  const packageDirectory = requiredDirectory(root, relative(root, requested));
  if (!packageDirectory.endsWith(".app")) fail(`${target.key} simulator package must be an .app directory`);
  const infoPath = join(packageDirectory, "Info.plist");
  if (!existsSync(infoPath) || !statSync(infoPath).isFile() || statSync(infoPath).size === 0) fail(`${target.key} simulator package is missing Info.plist`);
  return { kind: "apple-simulator-app", path: relative(root, packageDirectory).replaceAll("\\", "/"), infoPlist: sha256File(infoPath) };
}

function exactSourceSHA(root) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) fail(`cannot identify exact source SHA: ${(result.stderr || result.error?.message || "git failed").trim()}`);
  const sourceSha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) fail(`checked-out source SHA is not a full lowercase commit: ${sourceSha}`);
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sourceSha) fail(`checked-out source SHA ${sourceSha} does not match GITHUB_SHA ${process.env.GITHUB_SHA}`);
  return sourceSha;
}

export function validateNativeRelease({ root = repositoryRoot, target = "all", packagePath = null } = {}) {
  const targetKeys = target === "all" ? [...NATIVE_TARGET_KEYS] : [target];
  if (targetKeys.some((key) => !NATIVE_TARGETS[key])) fail(`unknown native target ${target}`);
  if (packagePath && targetKeys.length !== 1) fail("--package-path requires one native target");
  const sourceHooks = validateSourceHooks(root, targetKeys);
  const targets = targetKeys.map((key) => NATIVE_TARGETS[key].platform === "android" ? validateAndroidTarget(root, NATIVE_TARGETS[key]) : validateAppleTarget(root, NATIVE_TARGETS[key]));
  const packageEvidence = packagePath ? validatePackage(root, NATIVE_TARGETS[targetKeys[0]], packagePath) : null;
  return {
    kind: "portico.native-release-validation.v1",
    status: "passed",
    sourceSha: exactSourceSHA(root),
    targets: targetKeys,
    targetEvidence: targets,
    package: packageEvidence,
    acceptance: {
      mode: "source-and-package-static",
      deviceRun: false,
      simulatorRun: false,
      sourceHooks,
      note: "This record proves source/configuration and, when supplied, package-shape checks; it does not claim a device or simulator run.",
    },
    externalGates: [
      "protected Android release signing and store package verification",
      "Apple provisioning, signing, notarization, and store validation",
      "physical iOS, tvOS, Android, Android TV, and Fire TV acceptance runs",
    ],
  };
}

function parseArguments(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail(`invalid argument near ${key || "end of input"}`);
    args.set(key.slice(2), value);
  }
  return args;
}

function main(argv) {
  const args = parseArguments(argv);
  const target = args.get("target") || "all";
  const output = args.get("output");
  if (!output) fail("--output is required");
  const evidence = validateNativeRelease({ target, packagePath: args.get("package-path") || null });
  const outputPath = isAbsolute(output) ? output : resolve(repositoryRoot, output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`native release guard: ${error.message}\n`);
    process.exitCode = 2;
  }
}
