// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DWBMCPStudioApp",
    platforms: [
        .macOS(.v13)
    ],
    dependencies: [
        .package(path: "../DWBPlatform")
    ],
    targets: [
        .executableTarget(
            name: "DWBMCPStudio",
            dependencies: [
                .product(name: "DWBPlatform", package: "DWBPlatform")
            ]
        )
    ]
)
