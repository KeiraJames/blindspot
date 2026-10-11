import Foundation
import Capacitor

/// JS face of VisionEngine. Frames come from ARNavPlugin's session; this plugin only
/// configures detection and forwards results.
@objc(PathSenseVisionPlugin)
public class PathSenseVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PathSenseVisionPlugin"
    public let jsName = "Vision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        let engine = VisionEngine.shared
        engine.onHazard = { [weak self] kind, distance, bearing, confidence, source in
            var data: JSObject = ["kind": kind, "relativeBearing": bearing, "confidence": confidence, "source": source]
            if let distance { data["distance"] = distance }
            self?.notifyListeners("hazard", data: data)
        }
        engine.onText = { [weak self] text, confidence, bearing in
            self?.notifyListeners("text", data: ["text": text, "confidence": confidence, "relativeBearing": bearing])
        }
        engine.onClearance = { [weak self] left, center, right in
            var data: JSObject = [:]
            if let left { data["left"] = Double(left) }
            if let center { data["center"] = Double(center) }
            if let right { data["right"] = Double(right) }
            self?.notifyListeners("clearance", data: data)
        }
        engine.onThermal = { [weak self] level, rate in
            self?.notifyListeners("thermal", data: ["state": level.rawValue, "rate": rate])
        }
    }

    @objc func configure(_ call: CAPPluginCall) {
        var c = VisionEngine.Config()
        c.rate = call.getDouble("rate") ?? c.rate
        c.detectPeople = call.getBool("detectPeople") ?? c.detectPeople
        c.detectText = call.getBool("detectText") ?? c.detectText
        c.depthObstacles = call.getBool("depthObstacles") ?? c.depthObstacles
        c.obstacleDistance = Float(call.getDouble("obstacleDistance") ?? Double(c.obstacleDistance))
        c.customModel = call.getBool("customModel") ?? c.customModel
        let loaded = VisionEngine.shared.configure(c)
        call.resolve(["customModelLoaded": loaded])
    }

    @objc func setEnabled(_ call: CAPPluginCall) {
        VisionEngine.shared.enabled = call.getBool("enabled") ?? false
        call.resolve()
    }
}
