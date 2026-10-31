import ExpoModulesCore
import UIKit

public class SignatureInkModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SignatureInk")

    AsyncFunction("hasVisibleInk") { (image: SharedRef<UIImage>) throws -> Bool in
      guard let source = image.ref.cgImage else { return false }
      let width = source.width
      let height = source.height
      guard width > 0, height > 0, width <= 1_000_000 / height else {
        return false
      }
      // Only alpha is relevant. RGB ink is recolored by Expo Image, while the
      // original transparency must distinguish strokes from the background.
      var pixels = [UInt8](repeating: 0, count: width * height * 4)
      return pixels.withUnsafeMutableBytes { buffer in
        guard let context = CGContext(
          data: buffer.baseAddress, width: width, height: height,
          bitsPerComponent: 8, bytesPerRow: width * 4,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
        ) else { return false }
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        let bytes = buffer.bindMemory(to: UInt8.self)
        let first = bytes[3]
        return stride(from: 3, to: bytes.count, by: 4).contains { bytes[$0] != first }
      }
    }
  }
}
