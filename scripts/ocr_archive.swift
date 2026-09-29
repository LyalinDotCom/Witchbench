// Optional macOS chart-text extraction. Original images remain the primary evidence.
import Foundation
import Vision

let directory = URL(fileURLWithPath: CommandLine.arguments[1])
let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
var output: [String: [String]] = [:]
for file in files where ["png", "jpg", "webp"].contains(file.pathExtension) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]
    do {
        try VNImageRequestHandler(url: file, options: [:]).perform([request])
        output[file.lastPathComponent] = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    } catch {
        output[file.lastPathComponent] = []
    }
}
let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
print("Extracted chart text from \(output.count) images")
