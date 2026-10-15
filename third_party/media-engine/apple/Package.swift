// swift-tools-version:5.9
//
// The Portico media engine for iOS and tvOS: libmpv and the libraries it uses, each a dynamic
// framework built by ../build-apple.sh into Frameworks/ (not checked in). Both Xcode projects
// depend on this package's PorticoMediaEngine product; the engine's Swift code imports the
// Libmpv module (`#if canImport(Libmpv)`).
//
// If Xcode reports a missing binary target, run third_party/media-engine/build-apple.sh first.
import PackageDescription

let frameworks = [
    "Libmpv",
    "Libavcodec", "Libavformat", "Libavutil", "Libavfilter", "Libswresample", "Libswscale",
    "Libssl", "Libcrypto",
    "Libass", "Libfreetype", "Libharfbuzz", "Libfribidi", "Libunibreak",
    "Libdav1d", "Libplacebo", "Liblcms2", "Libdovi", "Libuchardet",
    "MoltenVK",
]

let package = Package(
    name: "PorticoMediaEngine",
    platforms: [.iOS("15.1"), .tvOS("15.1")],
    products: [
        .library(name: "PorticoMediaEngine", targets: frameworks),
    ],
    targets: frameworks.map { .binaryTarget(name: $0, path: "Frameworks/\($0).xcframework") }
)
