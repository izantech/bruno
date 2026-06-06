// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BrunoNative",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "BrunoNative",
            targets: ["BrunoNative"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.0")
    ],
    targets: [
        .target(
            name: "BrunoNative",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ]
        ),
        .testTarget(
            name: "BrunoNativeTests",
            dependencies: ["BrunoNative"]
        )
    ]
)
