import Foundation
import Capacitor
import CoreHaptics

/// Core Haptics patterns sent from JS (src/lib/haptics/patterns.ts). Safari's Vibration API
/// does nothing on iOS, so every cue goes through CHHapticEngine.
@objc(PathSenseHapticsPlugin)
public class PathSenseHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PathSenseHapticsPlugin"
    public let jsName = "Haptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var engine: CHHapticEngine?
    private var player: CHHapticPatternPlayer?
    private let queue = DispatchQueue(label: "app.pathsense.haptics")
    private lazy var supported = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": supported])
    }

    @objc func play(_ call: CAPPluginCall) {
        guard supported else { call.resolve(); return }
        guard let pattern = call.getObject("pattern"), let events = pattern["events"] as? JSArray else {
            call.reject("pattern.events is required")
            return
        }
        let scale = Float(call.getDouble("intensity") ?? 1)
        queue.async {
            do {
                let hapticEvents = events.compactMap { Self.event(from: $0, scale: scale) }
                let hapticPattern = try CHHapticPattern(events: hapticEvents, parameters: [])
                let engine = try self.startedEngine()
                try? self.player?.stop(atTime: CHHapticTimeImmediate)
                let player = try engine.makePlayer(with: hapticPattern)
                self.player = player
                try player.start(atTime: CHHapticTimeImmediate)
                call.resolve()
            } catch {
                // The engine can be reset by the system (e.g. audio interruption); rebuild next time.
                self.engine = nil
                call.reject("Haptic playback failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async {
            try? self.player?.stop(atTime: CHHapticTimeImmediate)
            call.resolve()
        }
    }

    private func startedEngine() throws -> CHHapticEngine {
        if let engine {
            try engine.start()
            return engine
        }
        let engine = try CHHapticEngine()
        engine.playsHapticsOnly = true
        engine.isAutoShutdownEnabled = true
        engine.resetHandler = { [weak self] in
            self?.queue.async { try? self?.engine?.start() }
        }
        engine.stoppedHandler = { [weak self] reason in
            if reason == .engineDestroyed || reason == .systemError { self?.queue.async { self?.engine = nil } }
        }
        try engine.start()
        self.engine = engine
        return engine
    }

    private static func number(_ value: JSValue?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    private static func event(from value: JSValue, scale: Float) -> CHHapticEvent? {
        guard let object = value as? JSObject else { return nil }
        let type = object["type"] as? String ?? "transient"
        let time = number(object["time"]) ?? 0
        let intensity = Float(number(object["intensity"]) ?? 1) * scale
        let sharpness = Float(number(object["sharpness"]) ?? 0.5)
        let parameters = [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: min(1, max(0, intensity))),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: min(1, max(0, sharpness)))
        ]
        if type == "continuous" {
            let duration = number(object["duration"]) ?? 0.2
            return CHHapticEvent(eventType: .hapticContinuous, parameters: parameters, relativeTime: time, duration: duration)
        }
        return CHHapticEvent(eventType: .hapticTransient, parameters: parameters, relativeTime: time)
    }
}
