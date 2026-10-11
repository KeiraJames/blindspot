import Foundation
import ARKit
import Capacitor
import SceneKit
import UIKit

/// ARKit world tracking for the navigator. The AR view is a native full-screen surface
/// *behind* a transparent WKWebView (PRD §12), so camera frames render at 60 Hz while the
/// web UI stays on top. Poses are streamed to JS at a low rate (default 10 Hz).
@objc(PathSenseARNavPlugin)
public class PathSenseARNavPlugin: CAPPlugin, CAPBridgedPlugin, ARSessionDelegate {
    public let identifier = "PathSenseARNavPlugin"
    public let jsName = "ARNav"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGuidePath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorldMap", returnType: CAPPluginReturnPromise)
    ]

    private var session: ARSession?
    private var arView: ARSCNView?
    private var blackout: UIView?
    private var gestureOverlay: GestureOverlayView?
    private var guideNode = SCNNode()
    private var poseInterval: TimeInterval = 0.1
    private var lastPoseAt: TimeInterval = 0
    private var usingWorldMap = false
    private var relocalized = false
    private var wantsNativeGestures = false

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(voiceOverChanged),
            name: UIAccessibility.voiceOverStatusDidChangeNotification, object: nil)
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve([
            "worldTracking": ARWorldTrackingConfiguration.isSupported,
            "sceneDepth": ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
            "meshReconstruction": ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh)
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard ARWorldTrackingConfiguration.isSupported else {
            call.reject("ARKit world tracking is not supported on this device.")
            return
        }
        let worldMapPath = call.getString("worldMapPath")
        let showCamera = call.getBool("showCamera") ?? true
        let rate = max(1, min(30, call.getDouble("poseRate") ?? 10))
        wantsNativeGestures = call.getBool("nativeGestures") ?? true
        poseInterval = 1 / rate

        var worldMap: ARWorldMap?
        if let worldMapPath {
            do {
                worldMap = try Self.loadWorldMap(path: worldMapPath)
            } catch {
                call.reject("Could not load the saved world map: \(error.localizedDescription)")
                return
            }
        }

        DispatchQueue.main.async {
            self.tearDown()
            let session = ARSession()
            session.delegate = self
            self.session = session

            let config = ARWorldTrackingConfiguration()
            config.worldAlignment = .gravity
            config.planeDetection = [.horizontal]
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                config.frameSemantics.insert(.sceneDepth)
            }
            if showCamera && ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
                config.sceneReconstruction = .mesh
            }
            config.initialWorldMap = worldMap
            self.usingWorldMap = worldMap != nil
            self.relocalized = false

            self.installViews(session: session, showCamera: showCamera)
            session.run(config, options: [.resetTracking, .removeExistingAnchors])
            UIApplication.shared.isIdleTimerDisabled = true
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tearDown()
            UIApplication.shared.isIdleTimerDisabled = false
            call.resolve()
        }
    }

    @objc func setGuidePath(_ call: CAPPluginCall) {
        let raw = call.getArray("points", JSObject.self) ?? []
        let points: [SCNVector3] = raw.compactMap { p in
            guard let x = (p["x"] as? NSNumber)?.floatValue,
                  let y = (p["y"] as? NSNumber)?.floatValue,
                  let z = (p["z"] as? NSNumber)?.floatValue else { return nil }
            return SCNVector3(x, y, z)
        }
        DispatchQueue.main.async {
            self.guideNode.childNodes.forEach { $0.removeFromParentNode() }
            Self.buildGuide(points: points).forEach { self.guideNode.addChildNode($0) }
            call.resolve()
        }
    }

    @objc func saveWorldMap(_ call: CAPPluginCall) {
        guard let session else {
            call.reject("AR session is not running.")
            return
        }
        let name = (call.getString("name") ?? UUID().uuidString).replacingOccurrences(of: "/", with: "_")
        session.getCurrentWorldMap { map, error in
            guard let map else {
                call.reject(error?.localizedDescription ?? "World map is not ready yet. Move the phone around a little more.")
                return
            }
            do {
                let url = try Self.saveWorldMap(map, name: name)
                call.resolve(["path": url.absoluteString])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: Views

    private func installViews(session: ARSession, showCamera: Bool) {
        guard let webView = bridge?.webView, let container = webView.superview else { return }
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        if showCamera {
            let view = ARSCNView(frame: container.bounds)
            view.session = session
            view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.automaticallyUpdatesLighting = true
            view.isAccessibilityElement = false
            view.accessibilityElementsHidden = true
            view.scene.rootNode.addChildNode(guideNode)
            container.insertSubview(view, belowSubview: webView)
            arView = view
        } else {
            // Session runs headless; a black backdrop keeps the UI readable and saves power.
            let black = UIView(frame: container.bounds)
            black.backgroundColor = .black
            black.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.insertSubview(black, belowSubview: webView)
            blackout = black
        }
        updateGestureOverlay()
    }

    private func tearDown() {
        session?.pause()
        session?.delegate = nil
        session = nil
        guideNode.childNodes.forEach { $0.removeFromParentNode() }
        guideNode.removeFromParentNode()
        arView?.removeFromSuperview()
        arView = nil
        blackout?.removeFromSuperview()
        blackout = nil
        gestureOverlay?.removeFromSuperview()
        gestureOverlay = nil
        if let webView = bridge?.webView {
            webView.isOpaque = true
            webView.backgroundColor = UIColor(red: 1, green: 0.94, blue: 0.965, alpha: 1)
        }
    }

    /// With VoiceOver on, iOS consumes touches in the web view. A native view with the
    /// allowsDirectInteraction trait receives raw gestures instead. It covers the screen above
    /// the web control bar so the on-screen buttons stay reachable.
    @objc private func voiceOverChanged() {
        DispatchQueue.main.async { self.updateGestureOverlay() }
    }

    private func updateGestureOverlay() {
        let needed = wantsNativeGestures && UIAccessibility.isVoiceOverRunning && session != nil
        if !needed {
            gestureOverlay?.removeFromSuperview()
            gestureOverlay = nil
            return
        }
        guard gestureOverlay == nil, let webView = bridge?.webView, let container = webView.superview else { return }
        let controlsHeight: CGFloat = 220
        let overlay = GestureOverlayView(frame: CGRect(x: 0, y: 0, width: container.bounds.width, height: max(0, container.bounds.height - controlsHeight)))
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.onGesture = { [weak self] name in
            self?.notifyListeners("gesture", data: ["gesture": name])
        }
        container.insertSubview(overlay, aboveSubview: webView)
        gestureOverlay = overlay
    }

    // MARK: ARSessionDelegate

    public func session(_ session: ARSession, didUpdate frame: ARFrame) {
        VisionEngine.shared.process(frame)
        guard frame.timestamp - lastPoseAt >= poseInterval else { return }
        lastPoseAt = frame.timestamp

        let camera = frame.camera
        let t = camera.transform
        var tracking = "normal"
        var reason: String?
        switch camera.trackingState {
        case .normal:
            if usingWorldMap && !relocalized { relocalized = true }
        case .notAvailable:
            tracking = "notAvailable"
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
        // With a world map, poses before relocalization are in a throwaway frame.
        if usingWorldMap && !relocalized && tracking == "normal" { tracking = "limited" }

        var data: JSObject = [
            "x": t.columns.3.x,
            "y": t.columns.3.y,
            "z": t.columns.3.z,
            "yaw": Self.yaw(of: t),
            "tracking": tracking,
            "relocalized": relocalized,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        if let reason { data["reason"] = reason }
        notifyListeners("pose", data: data)
    }

    public func sessionWasInterrupted(_ session: ARSession) {
        notifyListeners("interrupted", data: ["interrupted": true])
    }

    public func sessionInterruptionEnded(_ session: ARSession) {
        notifyListeners("interrupted", data: ["interrupted": false])
    }

    public func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

    /// Heading about gravity: 0 = facing −z, positive = turned left. Uses the camera's
    /// forward axis, falling back to the phone's top edge when the phone is pitched down.
    static func yaw(of t: simd_float4x4) -> Double {
        let forward = -SIMD3<Float>(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        var h = SIMD2<Float>(forward.x, forward.z)
        if simd_length(h) < 0.3 {
            let top = SIMD3<Float>(t.columns.0.x, t.columns.0.y, t.columns.0.z)
            h = SIMD2<Float>(top.x, top.z)
        }
        return Double(atan2(-h.x, -h.y))
    }

    // MARK: World maps

    static func loadWorldMap(path: String) throws -> ARWorldMap {
        let url = path.hasPrefix("file://") ? URL(string: path)! : URL(fileURLWithPath: path)
        let data = try Data(contentsOf: url)
        guard let map = try NSKeyedUnarchiver.unarchivedObject(ofClass: ARWorldMap.self, from: data) else {
            throw NSError(domain: "PathSense", code: 1, userInfo: [NSLocalizedDescriptionKey: "World map file is empty."])
        }
        return map
    }

    static func saveWorldMap(_ map: ARWorldMap, name: String) throws -> URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("worldmaps", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("\(name).arexperience")
        let data = try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    // MARK: Guide path (low vision)

    static func buildGuide(points: [SCNVector3]) -> [SCNNode] {
        guard points.count >= 2 else { return [] }
        let material = SCNMaterial()
        // Bright pink stands out against most indoor surfaces.
        material.diffuse.contents = UIColor(red: 1, green: 0.31, blue: 0.6, alpha: 0.9)
        material.emission.contents = UIColor(red: 1, green: 0.31, blue: 0.6, alpha: 1)
        material.lightingModel = .constant
        var nodes: [SCNNode] = []
        for i in 0..<(points.count - 1) {
            let a = points[i], b = points[i + 1]
            let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
            let length = sqrt(dx * dx + dy * dy + dz * dz)
            guard length > 0.05 else { continue }
            let tube = SCNCylinder(radius: 0.04, height: CGFloat(length))
            tube.materials = [material]
            let node = SCNNode(geometry: tube)
            node.position = SCNVector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
            // Cylinder axis is +y; rotate it onto the segment direction.
            node.look(at: b, up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 1, 0))
            nodes.append(node)
            let marker = SCNNode(geometry: SCNSphere(radius: 0.09))
            marker.geometry?.materials = [material]
            marker.position = b
            nodes.append(marker)
        }
        return nodes
    }
}

/// Full-screen gesture surface for VoiceOver users (direct interaction). Emits the same
/// gesture names as the JS recognizer (src/lib/gestures/recognizer.ts).
final class GestureOverlayView: UIView {
    var onGesture: ((String) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isAccessibilityElement = true
        accessibilityLabel = "Navigation gestures"
        accessibilityHint = "Swipe up to repeat, swipe down to end, swipe left or right to preview, double-tap to confirm, tap for where am I, touch and hold to pause, two-finger swipe for floors."
        accessibilityTraits = [.allowsDirectInteraction]

        let swipes: [(UISwipeGestureRecognizer.Direction, Int, String)] = [
            (.up, 1, "swipeForward"), (.down, 1, "swipeBack"), (.left, 1, "swipeLeft"), (.right, 1, "swipeRight"),
            (.up, 2, "twoFingerUp"), (.down, 2, "twoFingerDown")
        ]
        for (direction, touches, name) in swipes {
            let g = UISwipeGestureRecognizer(target: self, action: #selector(handle(_:)))
            g.direction = direction
            g.numberOfTouchesRequired = touches
            g.name = name
            addGestureRecognizer(g)
        }
        let double = UITapGestureRecognizer(target: self, action: #selector(handle(_:)))
        double.numberOfTapsRequired = 2
        double.name = "doubleTap"
        addGestureRecognizer(double)
        let single = UITapGestureRecognizer(target: self, action: #selector(handle(_:)))
        single.name = "tap"
        single.require(toFail: double)
        addGestureRecognizer(single)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(handle(_:)))
        hold.minimumPressDuration = 0.65
        hold.name = "longPress"
        addGestureRecognizer(hold)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func handle(_ g: UIGestureRecognizer) {
        if g is UILongPressGestureRecognizer && g.state != .began { return }
        guard let name = g.name else { return }
        onGesture?(name)
    }
}
