// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DWBPlatform",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "DWBPlatform", targets: ["DWBPlatform"])
    ],
    targets: [
        .target(
            name: "DWBPlatform",
            linkerSettings: [
                .linkedFramework("Security")
            ]
        ),
        .testTarget(
            name: "DWBPlatformTests",
            dependencies: ["DWBPlatform"]
        )
    ]
)
