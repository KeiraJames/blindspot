// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PathsenseNative",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "PathsenseNative", targets: ["PathSenseNative"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "PathSenseNative",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/PathSenseNative")
    ]
)
