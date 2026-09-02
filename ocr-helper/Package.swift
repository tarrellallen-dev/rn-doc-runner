// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "ocr-helper",
  platforms: [.macOS(.v12)],
  targets: [
    .executableTarget(name: "ocr-helper", path: "Sources/ocr-helper")
  ]
)
