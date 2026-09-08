import Foundation
import ImageIO
import CoreGraphics

let args = CommandLine.arguments
let dir = args[1]
let px = Int(args[2]) ?? 512
let mode = args.count > 3 ? args[3] : "serial"

let files = try! FileManager.default.contentsOfDirectory(atPath: dir)
    .filter { $0.hasSuffix(".ARW") }.sorted().map { dir + "/" + $0 }

func thumb(_ path: String) -> (Int, Int)? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    let opts: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageIfAbsent: true,
        kCGImageSourceThumbnailMaxPixelSize: px,
        kCGImageSourceCreateThumbnailWithTransform: true,
    ]
    guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
    return (img.width, img.height)
}

// warm the page cache the same way for everyone
for f in files { _ = try? Data(contentsOf: URL(fileURLWithPath: f), options: .alwaysMapped).count }

let t0 = Date()
var dims = (0,0)
if mode == "serial" {
    for f in files { if let d = thumb(f) { dims = d } }
} else {
    let q = DispatchQueue.global(qos: .userInitiated)
    let g = DispatchGroup()
    let lock = NSLock()
    DispatchQueue.concurrentPerform(iterations: files.count) { i in
        if let d = thumb(files[i]) { lock.lock(); dims = d; lock.unlock() }
    }
    g.wait()
}
let ms = Date().timeIntervalSince(t0) * 1000
print(String(format: "ImageIO %@ %dpx: %d file, %.0f ms totali, %.1f ms/file (ultimo %dx%d)", mode, px, files.count, ms, ms/Double(files.count), dims.0, dims.1))
