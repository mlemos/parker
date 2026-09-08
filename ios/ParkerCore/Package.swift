// swift-tools-version: 6.0
// ParkerCore — the UI-free heart of Parker's mobile companion: the to-do
// grammar and state machine, later the folder model and the search index.
// No UIKit, no SwiftUI: everything here must port to Kotlin mechanically.
import PackageDescription

let package = Package(
    name: "ParkerCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "ParkerCore", targets: ["ParkerCore"])],
    targets: [
        .target(name: "ParkerCore", swiftSettings: [.swiftLanguageMode(.v5)]),
        // Fixtures live in ../../shared/fixtures, read by path (#filePath): SwiftPM
        // resources cannot point outside the target, and the TypeScript suite reads
        // the very same files.
        .testTarget(
            name: "ParkerCoreTests",
            dependencies: ["ParkerCore"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
