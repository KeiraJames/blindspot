import Foundation
import ARKit
import Capacitor
import RoomPlan
import UIKit
import Vision

/// LiDAR room capture with RoomPlan (PRD §5 ScanPlugin). Presents a native capture screen,
/// streams coaching instructions and progress to JS (which speaks them in the guide voice),
/// reads room numbers with Vision OCR, and returns a simplified room in plan coordinates
/// plus local files: RoomPlan JSON, USDZ, ARWorldMap and an OBJ mesh.
@objc(PathSenseScanPlugin)
public class PathSenseScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PathSenseScanPlugin"
    public let jsName = "Scan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteScanFiles", returnType: CAPPluginReturnPromise)
    ]

    private var controller: ScanViewController?

    @objc func isSupported(_ call: CAPPluginCall) {
        if RoomCaptureSession.isSupported {
            call.resolve(["supported": true])
        } else {
            call.resolve(["supported": false, "reason": "Scanning needs an iPhone or iPad Pro with LiDAR. You can still navigate maps that others scanned."])
        }
    }

    @objc func startCapture(_ call: CAPPluginCall) {
        guard RoomCaptureSession.isSupported else {
            call.reject("This device has no LiDAR scanner.")
            return
        }
        let scanId = call.getString("scanId") ?? "scan_\(UUID().uuidString.prefix(8).lowercased())"
        let detectText = call.getBool("detectText") ?? true
        call.keepAlive = false
        DispatchQueue.main.async {
            let vc = ScanViewController(scanId: scanId, detectText: detectText)
            vc.modalPresentationStyle = .fullScreen
            vc.onInstruction = { [weak self] i in self?.notifyListeners("instruction", data: ["instruction": i]) }
            vc.onProgress = { [weak self] p in self?.notifyListeners("progress", data: p) }
            vc.onLandmark = { [weak self] text, confidence in
                self?.notifyListeners("landmark", data: ["kind": "room_number", "text": text, "confidence": confidence])
            }
            vc.onFinish = { [weak self] result in
                self?.controller = nil
                switch result {
                case .success(let room): call.resolve(["result": room])
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
            self.controller = vc
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    @objc func finishCapture(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.controller?.finish()
            call.resolve()
        }
    }

    @objc func cancelCapture(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.controller?.cancel()
            call.resolve()
        }
    }

    @objc func deleteScanFiles(_ call: CAPPluginCall) {
        guard let scanId = call.getString("scanId") else {
            call.reject("scanId is required")
            return
        }
        try? FileManager.default.removeItem(at: ScanExport.directory(for: scanId))
        call.resolve()
    }
}

// MARK: - Capture screen

final class ScanViewController: UIViewController, RoomCaptureViewDelegate, RoomCaptureSessionDelegate {
    var onInstruction: ((String) -> Void)?
    var onProgress: ((JSObject) -> Void)?
    var onLandmark: ((String, Float) -> Void)?
    var onFinish: ((Result<JSObject, Error>) -> Void)?

    private let scanId: String
    private let detectText: Bool
    private var captureView: RoomCaptureView!
    private var worldMapURL: URL?
    private var meshURL: URL?
    private var landmarks: [String: Float] = [:]
    private var ocrTimer: Timer?
    private var ocrBusy = false
    private var finishing = false
    private var completed = false
    private var lastInstruction: RoomCaptureSession.Instruction?

    init(scanId: String, detectText: Bool) {
        self.scanId = scanId
        self.detectText = detectText
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        captureView = RoomCaptureView(frame: view.bounds)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.captureSession.delegate = self
        captureView.delegate = self
        view.addSubview(captureView)

        let done = makeButton(title: "Finish", hint: "Ends the scan and saves the room.", primary: true, action: #selector(doneTapped))
        let cancel = makeButton(title: "Cancel", hint: "Discards this scan.", primary: false, action: #selector(cancelTapped))
        let stack = UIStackView(arrangedSubviews: [cancel, done])
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            stack.heightAnchor.constraint(greaterThanOrEqualToConstant: 64)
        ])
        accessibilityElements = [stack]
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
        UIApplication.shared.isIdleTimerDisabled = true
        if detectText {
            ocrTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.runOCR() }
        }
        UIAccessibility.post(notification: .screenChanged, argument: "Scanning. Walk slowly along the walls.")
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        ocrTimer?.invalidate()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func makeButton(title: String, hint: String, primary: Bool, action: Selector) -> UIButton {
        var config = primary ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
        config.title = title
        config.cornerStyle = .large
        config.baseBackgroundColor = primary ? UIColor(red: 0.76, green: 0.09, blue: 0.36, alpha: 1) : UIColor(red: 1, green: 0.94, blue: 0.965, alpha: 1)
        config.baseForegroundColor = primary ? .white : UIColor(red: 0.24, green: 0.06, blue: 0.16, alpha: 1)
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attrs in
            var a = attrs
            a.font = UIFont.preferredFont(forTextStyle: .title3).withTraits(.traitBold)
            return a
        }
        let button = UIButton(configuration: config)
        button.accessibilityHint = hint
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    @objc private func doneTapped() { finish() }
    @objc private func cancelTapped() { cancel() }

    func finish() {
        guard !finishing else { return }
        finishing = true
        UIAccessibility.post(notification: .announcement, argument: "Processing the room.")
        let session = captureView.captureSession.arSession
        // Grab the world map and mesh before RoomPlan stops the AR session.
        meshURL = try? ScanExport.writeMesh(session.currentFrame?.anchors ?? [], scanId: scanId)
        session.getCurrentWorldMap { [weak self] map, _ in
            guard let self else { return }
            if let map { self.worldMapURL = try? ScanExport.writeWorldMap(map, scanId: self.scanId) }
            DispatchQueue.main.async { self.captureView.captureSession.stop() }
        }
    }

    func cancel() {
        guard !completed else { return }
        completed = true
        captureView.captureSession.stop()
        dismiss(animated: true) {
            self.onFinish?(.failure(NSError(domain: "PathSense", code: 2, userInfo: [NSLocalizedDescriptionKey: "cancelled"])))
        }
    }

    // MARK: RoomCaptureSessionDelegate

    func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
        guard instruction != lastInstruction else { return }
        lastInstruction = instruction
        let name: String
        switch instruction {
        case .moveCloseToWall: name = "moveCloseToWall"
        case .moveAwayFromWall: name = "moveAwayFromWall"
        case .slowDown: name = "slowDown"
        case .turnOnLight: name = "turnOnLight"
        case .lowTexture: name = "lowTexture"
        case .normal: name = "normal"
        @unknown default: name = "normal"
        }
        onInstruction?(name)
    }

    func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        let stairs = room.objects.filter { $0.category == .stairs }.count
        let walls = room.walls.count
        let doorways = room.doors.count + room.openings.count
        let coverage = min(1.0, Double(walls) / 4.0 * 0.7 + (doorways > 0 ? 0.3 : 0))
        var tracking = "normal"
        var reason: String?
        if let state = session.arSession.currentFrame?.camera.trackingState {
            switch state {
            case .normal: break
            case .notAvailable: tracking = "notAvailable"
            case .limited(let r):
                tracking = "limited"
                switch r {
                case .initializing: reason = "initializing"
                case .excessiveMotion: reason = "excessiveMotion"
                case .insufficientFeatures: reason = "insufficientFeatures"
                case .relocalizing: reason = "relocalizing"
                @unknown default: reason = nil
                }
            }
        }
        var data: JSObject = [
            "coverage": coverage,
            "tracking": tracking,
            "walls": walls,
            "doors": room.doors.count,
            "openings": room.openings.count,
            "stairs": stairs
        ]
        if let reason { data["trackingReason"] = reason }
        onProgress?(data)
    }

    // MARK: RoomCaptureViewDelegate

    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        guard !completed else { return }
        completed = true
        if let error {
            dismiss(animated: true) { self.onFinish?(.failure(error)) }
            return
        }
        do {
            var files: [String: String] = [:]
            files["roomJson"] = try ScanExport.writeJSON(processedResult, scanId: scanId).absoluteString
            if let usdz = try? ScanExport.writeUSDZ(processedResult, scanId: scanId) { files["usdz"] = usdz.absoluteString }
            if let worldMapURL { files["worldMap"] = worldMapURL.absoluteString }
            if let meshURL { files["mesh"] = meshURL.absoluteString }
            let result = ScanExport.simplify(processedResult, scanId: scanId, landmarks: landmarks, files: files)
            // Let the user hear the processed model announced before closing.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                self.dismiss(animated: true) { self.onFinish?(.success(result)) }
            }
        } catch {
            dismiss(animated: true) { self.onFinish?(.failure(error)) }
        }
    }

    // MARK: OCR for room numbers

    private func runOCR() {
        guard !ocrBusy, let frame = captureView.captureSession.arSession.currentFrame else { return }
        ocrBusy = true
        let buffer = frame.capturedImage
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .right, options: [:])
            try? handler.perform([request])
            let found: [(String, Float)] = (request.results ?? []).compactMap { obs in
                guard let c = obs.topCandidates(1).first, c.confidence > 0.6 else { return nil }
                let s = c.string.trimmingCharacters(in: .whitespacesAndNewlines)
                return VisionEngine.isRoomLabel(s) ? (s, c.confidence) : nil
            }
            DispatchQueue.main.async {
                guard let self else { return }
                self.ocrBusy = false
                for (text, conf) in found where self.landmarks[text] == nil {
                    self.landmarks[text] = conf
                    self.onLandmark?(text, conf)
                }
            }
        }
    }
}

private extension UIFont {
    func withTraits(_ traits: UIFontDescriptor.SymbolicTraits) -> UIFont {
        guard let d = fontDescriptor.withSymbolicTraits(traits) else { return self }
        return UIFont(descriptor: d, size: 0)
    }
}

// MARK: - Export

enum ScanExport {
    static func directory(for scanId: String) -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("scans", isDirectory: true)
            .appendingPathComponent(scanId, isDirectory: true)
    }

    private static func prepare(_ scanId: String, _ name: String) throws -> URL {
        let dir = directory(for: scanId)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(name)
    }

    static func writeJSON(_ room: CapturedRoom, scanId: String) throws -> URL {
        let url = try prepare(scanId, "room.json")
        try JSONEncoder().encode(room).write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    static func writeUSDZ(_ room: CapturedRoom, scanId: String) throws -> URL {
        let url = try prepare(scanId, "room.usdz")
        try room.export(to: url, exportOptions: .parametric)
        return url
    }

    static func writeWorldMap(_ map: ARWorldMap, scanId: String) throws -> URL {
        let url = try prepare(scanId, "world.arexperience")
        let data = try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    /// Writes LiDAR mesh anchors as one OBJ (world coordinates), keeping every other face to
    /// halve the size. Returns nil when the session produced no mesh.
    static func writeMesh(_ anchors: [ARAnchor], scanId: String) throws -> URL? {
        let meshes = anchors.compactMap { $0 as? ARMeshAnchor }
        guard !meshes.isEmpty else { return nil }
        var obj = "# PathSense LiDAR mesh (downsampled)\n"
        var offset = 1
        for anchor in meshes {
            let g = anchor.geometry
            let vertices = g.vertices
            let vptr = vertices.buffer.contents()
            for i in 0..<vertices.count {
                let p = vptr.advanced(by: vertices.offset + vertices.stride * i).assumingMemoryBound(to: SIMD3<Float>.self).pointee
                let w = anchor.transform * SIMD4<Float>(p.x, p.y, p.z, 1)
                obj += String(format: "v %.3f %.3f %.3f\n", w.x, w.y, w.z)
            }
            let faces = g.faces
            let fptr = faces.buffer.contents()
            for f in stride(from: 0, to: faces.count, by: 2) {
                var idx: [Int] = []
                for k in 0..<faces.indexCountPerPrimitive {
                    let at = fptr.advanced(by: (f * faces.indexCountPerPrimitive + k) * faces.bytesPerIndex)
                    let v = faces.bytesPerIndex == 4 ? Int(at.assumingMemoryBound(to: UInt32.self).pointee) : Int(at.assumingMemoryBound(to: UInt16.self).pointee)
                    idx.append(v + offset)
                }
                obj += "f " + idx.map(String.init).joined(separator: " ") + "\n"
            }
            offset += vertices.count
        }
        let url = try prepare(scanId, "mesh.obj")
        try obj.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    // ARKit (x right, y up, z toward viewer) → plan (x, y = −z).
    private static func plan(_ p: SIMD3<Float>) -> JSObject { ["x": Double(p.x), "y": Double(-p.z)] }
    private static func position(_ t: simd_float4x4) -> SIMD3<Float> { SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z) }
    /// Plan bearing of a transform's local axis.
    private static func bearing(_ axis: SIMD4<Float>) -> Double { Double(atan2(-axis.z, axis.x)) }
    private static func confidence(_ c: CapturedRoom.Confidence) -> String {
        switch c {
        case .high: return "high"
        case .medium: return "medium"
        case .low: return "low"
        @unknown default: return "low"
        }
    }

    /// Reduce a CapturedRoom to the ScanResult shape in src/lib/scan/types.ts.
    static func simplify(_ room: CapturedRoom, scanId: String, landmarks: [String: Float], files: [String: String]) -> JSObject {
        var walls: JSArray = []
        var wallPoints: [SIMD3<Float>] = []
        var wallBottoms: [Float] = []
        var confidenceSum = 0.0
        for w in room.walls {
            let c = position(w.transform)
            let dir = SIMD3<Float>(w.transform.columns.0.x, w.transform.columns.0.y, w.transform.columns.0.z)
            let half = dir * (w.dimensions.x / 2)
            let a = c - half, b = c + half
            wallPoints.append(contentsOf: [a, b])
            wallBottoms.append(c.y - w.dimensions.y / 2)
            walls.append(["start": plan(a), "end": plan(b), "height": Double(w.dimensions.y)])
            confidenceSum += w.confidence == .high ? 1 : w.confidence == .medium ? 0.7 : 0.4
        }

        var floorPolygon: JSArray = []
        if let floor = room.floors.first, !floor.polygonCorners.isEmpty {
            for corner in floor.polygonCorners {
                let w = floor.transform * SIMD4<Float>(corner.x, corner.y, corner.z, 1)
                floorPolygon.append(plan(SIMD3(w.x, w.y, w.z)))
            }
        } else if !wallPoints.isEmpty {
            // Fallback: wall endpoints ordered around their centroid.
            let cx = wallPoints.map(\.x).reduce(0, +) / Float(wallPoints.count)
            let cz = wallPoints.map(\.z).reduce(0, +) / Float(wallPoints.count)
            for p in wallPoints.sorted(by: { atan2($0.z - cz, $0.x - cx) < atan2($1.z - cz, $1.x - cx) }) {
                floorPolygon.append(plan(p))
            }
        }

        var openings: JSArray = []
        for (i, d) in room.doors.enumerated() {
            var isOpen = false
            if case .door(let open) = d.category { isOpen = open }
            openings.append([
                "id": "\(scanId)-door-\(i)",
                "category": "door",
                "position": plan(position(d.transform)),
                "width": Double(d.dimensions.x),
                "normal": bearing(d.transform.columns.2),
                "isOpen": isOpen,
                "confidence": confidence(d.confidence)
            ])
        }
        for (i, o) in room.openings.enumerated() {
            openings.append([
                "id": "\(scanId)-opening-\(i)",
                "category": "opening",
                "position": plan(position(o.transform)),
                "width": Double(o.dimensions.x),
                "normal": bearing(o.transform.columns.2),
                "confidence": confidence(o.confidence)
            ])
        }
        let windows: JSArray = room.windows.map { ["position": plan(position($0.transform)), "width": Double($0.dimensions.x)] as JSObject }

        var stairs: JSArray = []
        var objects: JSArray = []
        for (i, o) in room.objects.enumerated() {
            if o.category == .stairs {
                stairs.append([
                    "id": "\(scanId)-stairs-\(i)",
                    "position": plan(position(o.transform)),
                    "size": ["w": Double(o.dimensions.x), "d": Double(o.dimensions.z)],
                    "bearing": bearing(o.transform.columns.2),
                    "confidence": confidence(o.confidence)
                ])
            } else {
                objects.append([
                    "id": "\(scanId)-obj-\(i)",
                    "category": String(describing: o.category),
                    "position": plan(position(o.transform)),
                    "size": ["w": Double(o.dimensions.x), "d": Double(o.dimensions.z), "h": Double(o.dimensions.y)]
                ])
            }
        }

        let floorHeight = room.floors.first.map { Double($0.transform.columns.3.y) } ?? Double(wallBottoms.min() ?? -1.4)
        let landmarkArray: JSArray = landmarks.sorted { $0.value > $1.value }.map {
            ["kind": "room_number", "text": $0.key, "confidence": Double($0.value)] as JSObject
        }
        var fileObject: JSObject = [:]
        for (k, v) in files { fileObject[k] = v }

        return [
            "scanId": scanId,
            "capturedAt": Date().timeIntervalSince1970 * 1000,
            "floorPolygon": floorPolygon,
            "walls": walls,
            "openings": openings,
            "windows": windows,
            "stairs": stairs,
            "objects": objects,
            "landmarks": landmarkArray,
            "floorHeight": floorHeight,
            "quality": room.walls.isEmpty ? 0 : confidenceSum / Double(room.walls.count),
            "files": fileObject
        ]
    }
}
