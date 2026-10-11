import Foundation
import AVFoundation
import Capacitor
import Speech
import UIKit

/// AVSpeechSynthesizer fallback voice (offline / ElevenLabs failure), on-device dictation for
/// voice room naming and destination search, audio session setup and VoiceOver status.
@objc(PathSenseSpeechPlugin)
public class PathSenseSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "PathSenseSpeechPlugin"
    public let jsName = "Speech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureAudioSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isVoiceOverRunning", returnType: CAPPluginReturnPromise)
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var pendingSpeech: [ObjectIdentifier: CAPPluginCall] = [:]
    private let audioEngine = AVAudioEngine()
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var listenCall: CAPPluginCall?
    private var listenTimer: Timer?
    private var transcript = ""

    override public func load() {
        synthesizer.delegate = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(voiceOverChanged),
            name: UIAccessibility.voiceOverStatusDidChangeNotification, object: nil)
    }

    @objc private func voiceOverChanged() {
        notifyListeners("voiceOverChanged", data: ["running": UIAccessibility.isVoiceOverRunning])
    }

    // MARK: Audio session

    @objc func configureAudioSession(_ call: CAPPluginCall) {
        do {
            try Self.setPlaybackSession()
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    /// Prompts must be heard with the ringer switch off, and should duck music, not stop it.
    static func setPlaybackSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try session.setActive(true)
    }

    @objc func isVoiceOverRunning(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["running": UIAccessibility.isVoiceOverRunning])
        }
    }

    // MARK: Speech synthesis

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.resolve()
            return
        }
        let rate = Float(call.getDouble("rate") ?? 1)
        let language = call.getString("language") ?? "en-US"
        let interrupt = call.getBool("interrupt") ?? false
        DispatchQueue.main.async {
            if interrupt { self.synthesizer.stopSpeaking(at: .immediate) }
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = AVSpeechSynthesisVoice(language: language)
            let base = AVSpeechUtteranceDefaultSpeechRate
            utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, base * rate))
            // Use the app's own speed setting (not VoiceOver's), and leave a short breath
            // between sentences so instructions are easier to follow.
            utterance.prefersAssistiveTechnologySettings = false
            utterance.postUtteranceDelay = 0.25
            self.pendingSpeech[ObjectIdentifier(utterance)] = call
            self.synthesizer.speak(utterance)
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        pendingSpeech.removeValue(forKey: ObjectIdentifier(utterance))?.resolve()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        pendingSpeech.removeValue(forKey: ObjectIdentifier(utterance))?.resolve()
    }

    // MARK: Dictation

    @objc func listen(_ call: CAPPluginCall) {
        let timeout = (call.getDouble("timeoutMs") ?? 8000) / 1000
        let contextual = call.getArray("contextualStrings", String.self) ?? []
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.reject("Speech recognition permission was not granted.")
                return
            }
            AVAudioApplication.requestRecordPermission { granted in
                guard granted else {
                    call.reject("Microphone permission was not granted.")
                    return
                }
                DispatchQueue.main.async {
                    do {
                        try self.startRecognition(call: call, timeout: timeout, contextual: contextual)
                    } catch {
                        self.finishListening(error: error.localizedDescription)
                    }
                }
            }
        }
    }

    private func startRecognition(call: CAPPluginCall, timeout: TimeInterval, contextual: [String]) throws {
        finishListening(error: "Superseded by a new request")
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
            call.reject("Speech recognition is not available right now.")
            return
        }
        listenCall = call
        transcript = ""
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.contextualStrings = contextual
        // Keep audio on the device whenever the hardware supports it.
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        recognitionRequest = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                self.transcript = result.bestTranscription.formattedString
                if result.isFinal { self.finishListening(error: nil) }
            } else if error != nil {
                self.finishListening(error: nil)
            }
        }
        listenTimer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            self?.finishListening(error: nil)
        }
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishListening(error: nil)
            call.resolve()
        }
    }

    private func finishListening(error: String?) {
        listenTimer?.invalidate()
        listenTimer = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        try? Self.setPlaybackSession()
        guard let call = listenCall else { return }
        listenCall = nil
        if let error, transcript.isEmpty {
            call.reject(error)
        } else {
            call.resolve(["transcript": transcript])
        }
    }
}
