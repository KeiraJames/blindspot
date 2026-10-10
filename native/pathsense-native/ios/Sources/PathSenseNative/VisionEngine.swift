import Foundation
import ARKit
import CoreML
import Vision

/// On-device hazard and sign detection over ARKit frames. Everything runs locally (Neural
/// Engine / GPU via Core ML and Vision); no image ever leaves the phone.
///
/// Sources:
/// - LiDAR depth: nearest surface straight ahead → "obstacle" (needs sceneDepth).
/// - VNDetectHumanRectanglesRequest → "person".
/// - Optional bundled Core ML detector (PathSenseDetector.mlmodelc) → "door" / "stairs".
/// - VNRecognizeTextRequest → room numbers and signs.
final class VisionEngine {
    static let shared = VisionEngine()

    struct Config {
        var rate: Double = 4
        var detectPeople = true
        var detectText = true
        var depthObstacles = true
        var obstacleDistance: Float = 1.5
        var customModel = true
    }

    enum ThermalLevel: String { case nominal, fair, serious, critical }

    var onHazard: ((_ kind: String, _ distance: Float?, _ bearing: Double, _ confidence: Float, _ source: String) -> Void)?
    var onText: ((_ text: String, _ confidence: Float, _ bearing: Double) -> Void)?
    var onThermal: ((_ level: ThermalLevel, _ rate: Double) -> Void)?

    private(set) var config = Config()
    private(set) var customModelLoaded = false
    var enabled = false

    private let queue = DispatchQueue(label: "app.pathsense.vision", qos: .userInitiated)
    private var busy = false
    private var lastRun: TimeInterval = 0
    private var lastText: TimeInterval = 0
    private var coreMLRequest: VNCoreMLRequest?
    private var thermal: ThermalLevel = .nominal
    /// Portrait horizontal field of view of the wide camera, approximately.
    private let horizontalFOV = 50.0 * Double.pi / 180

    private init() {
        NotificationCenter.default.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil
        ) { [weak self] _ in self?.updateThermal() }
        updateThermal()
    }

    func configure(_ c: Config) -> Bool {
        config = c
        if c.customModel && coreMLRequest == nil { loadModel() }
        return customModelLoaded
    }

    private func loadModel() {
        guard let url = Bundle.main.url(forResource: "PathSenseDetector", withExtension: "mlmodelc") else { return }
        let mlConfig = MLModelConfiguration()
        mlConfig.computeUnits = .all // prefers the Neural Engine
        guard let model = try? MLModel(contentsOf: url, configuration: mlConfig),
              let vnModel = try? VNCoreMLModel(for: model) else { return }
        let request = VNCoreMLRequest(model: vnModel)
        request.imageCropAndScaleOption = .scaleFill
        coreMLRequest = request
        customModelLoaded = true
    }

    private func updateThermal() {
        let level: ThermalLevel
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: level = .nominal
        case .fair: level = .fair
        case .serious: level = .serious
        case .critical: level = .critical
        @unknown default: level = .fair
        }
        thermal = level
        onThermal?(level, effectiveRate)
    }

    /// Detection rate after thermal throttling (PRD §10: drop detect rate if thermal).
    var effectiveRate: Double {
        switch thermal {
        case .nominal: return config.rate
        case .fair: return config.rate * 0.75
        case .serious: return config.rate * 0.4
        case .critical: return 0.5
        }
    }

    func process(_ frame: ARFrame) {
        guard enabled else { return }
        let now = frame.timestamp
        guard !busy, now - lastRun >= 1 / max(0.2, effectiveRate) else { return }
        busy = true
        lastRun = now
        let pixelBuffer = frame.capturedImage
        let depth = frame.sceneDepth ?? frame.smoothedSceneDepth
        let runText = config.detectText && now - lastText > 1.0
        if runText { lastText = now }
        let heavy = thermal != .critical

        queue.async { [weak self] in
            guard let self else { return }
            // ARSession delivers frames on the main queue; release the gate there too.
            defer { DispatchQueue.main.async { self.busy = false } }
            if self.config.depthObstacles, let depth { self.checkDepth(depth) }

            var requests: [VNRequest] = []
            let people = VNDetectHumanRectanglesRequest()
            people.upperBodyOnly = false
            if self.config.detectPeople && heavy { requests.append(people) }
            let text = VNRecognizeTextRequest()
            text.recognitionLevel = .fast
            text.usesLanguageCorrection = false
            if runText { requests.append(text) }
            if let ml = self.coreMLRequest, heavy { requests.append(ml) }
            guard !requests.isEmpty else { return }

            // Portrait device, back camera: sensor image is landscape, so orientation .right.
            let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right, options: [:])
            try? handler.perform(requests)

            for obs in people.results ?? [] where obs.confidence > 0.6 {
                let box = obs.boundingBox
                let distance = depth.flatMap { self.depthAt(normalizedPortrait: CGPoint(x: box.midX, y: box.midY), depth: $0) }
                // Only warn about people who are close or fill much of the view.
                if let d = distance, d > 3 { continue }
                if distance == nil && box.height < 0.45 { continue }
                self.onHazard?("person", distance, self.bearing(forPortraitX: box.midX), obs.confidence, "vision")
            }
            for obs in text.results ?? [] {
                guard let candidate = obs.topCandidates(1).first, candidate.confidence > 0.5 else { continue }
                let s = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
                if Self.isRoomLabel(s) {
                    self.onText?(s, candidate.confidence, self.bearing(forPortraitX: obs.boundingBox.midX))
                }
            }
            for case let obs as VNRecognizedObjectObservation in self.coreMLRequest?.results ?? [] {
                guard let label = obs.labels.first, label.confidence > 0.6 else { continue }
                let kind = label.identifier.lowercased()
                guard ["door", "stairs", "obstacle", "person"].contains(kind) else { continue }
                let box = obs.boundingBox
                let distance = depth.flatMap { self.depthAt(normalizedPortrait: CGPoint(x: box.midX, y: box.midY), depth: $0) }
                self.onHazard?(kind, distance, self.bearing(forPortraitX: box.midX), label.confidence, "coreml")
            }
        }
    }

    static func isRoomLabel(_ s: String) -> Bool {
        s.range(of: #"^[A-Z]?-?\d{2,4}[A-Z]?$"#, options: .regularExpression) != nil
    }

    /// Positive bearing = left (matches the JS convention).
    private func bearing(forPortraitX x: CGFloat) -> Double {
        (0.5 - Double(x)) * horizontalFOV
    }

    /// Nearest confident depth in a horizontal band at walking height, split into three
    /// columns (left/centre/right). Reports the nearest column under the threshold.
    private func checkDepth(_ sceneDepth: ARDepthData) {
        let map = sceneDepth.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        if let conf = sceneDepth.confidenceMap { CVPixelBufferLockBaseAddress(conf, .readOnly) }
        defer { if let conf = sceneDepth.confidenceMap { CVPixelBufferUnlockBaseAddress(conf, .readOnly) } }

        let width = CVPixelBufferGetWidth(map)   // sensor x → portrait vertical
        let height = CVPixelBufferGetHeight(map) // sensor y → portrait horizontal (row 0 = right side)
        guard let base = CVPixelBufferGetBaseAddress(map) else { return }
        let rowBytes = CVPixelBufferGetBytesPerRow(map)
        let confBase = sceneDepth.confidenceMap.flatMap { CVPixelBufferGetBaseAddress($0) }
        let confRowBytes = sceneDepth.confidenceMap.map { CVPixelBufferGetBytesPerRow($0) } ?? 0

        // Portrait vertical band around the horizon: sensor columns 30%…70%.
        let xStart = Int(Double(width) * 0.3), xEnd = Int(Double(width) * 0.7)
        var best: (distance: Float, column: Int)?
        for column in 0..<3 {
            let yStart = height * column / 3, yEnd = height * (column + 1) / 3
            var samples: [Float] = []
            for y in stride(from: yStart, to: yEnd, by: 4) {
                let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
                let confRow = confBase?.advanced(by: y * confRowBytes).assumingMemoryBound(to: UInt8.self)
                for x in stride(from: xStart, to: xEnd, by: 4) {
                    if let confRow, confRow[x] < UInt8(ARConfidenceLevel.medium.rawValue) { continue }
                    let d = row[x]
                    if d.isFinite && d > 0.15 { samples.append(d) }
                }
            }
            guard samples.count > 12 else { continue }
            samples.sort()
            // 10th percentile is robust to single noisy pixels.
            let d = samples[samples.count / 10]
            if d < config.obstacleDistance, best == nil || d < best!.distance { best = (d, column) }
        }
        guard let best else { return }
        // Row 0 is the device's right side in portrait: column 0 = right, 2 = left.
        let bearing = Double(best.column - 1) * horizontalFOV / 3
        onHazard?("obstacle", best.distance, bearing, 0.9, "lidar")
    }

    private func depthAt(normalizedPortrait p: CGPoint, depth: ARDepthData) -> Float? {
        let map = depth.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        let width = CVPixelBufferGetWidth(map), height = CVPixelBufferGetHeight(map)
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }
        // Portrait (x right, y up, Vision coords) → sensor (x along portrait up, y along portrait right→left).
        let sx = Int(Double(width) * (1 - Double(p.y)))
        let sy = Int(Double(height) * Double(p.x))
        guard sx >= 0, sx < width, sy >= 0, sy < height else { return nil }
        let row = base.advanced(by: sy * CVPixelBufferGetBytesPerRow(map)).assumingMemoryBound(to: Float32.self)
        let d = row[sx]
        return d.isFinite && d > 0 ? d : nil
    }
}
