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
    // End-of-speech detection: the person has started talking, and when they last made a sound
    // or changed the transcript. Listening ends after a short silence, never mid-sentence.
    private var listenStarted = Date()
    private var lastActivity = Date()
    private var lastWords = Date()
    private var heardVoice = false
    private var noiseFloor: Float = -50
    private var startTimeout: TimeInterval = 8
    private var silenceWindow: TimeInterval = 1.0
    private static let maxListen: TimeInterval = 30

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

    /// One session for both talking and listening, so the app never has to switch audio modes
    /// between a question and the answer (switching causes a gap and can clip the start of
    /// speech). Prompts are heard with the ringer switch off and duck music rather than stop it.
    static func setPlaybackSession() throws {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playAndRecord {
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.duckOthers, .defaultToSpeaker, .allowBluetoothA2DP])
        }
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
            utterance.postUtteranceDelay = 0.1
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
        let silence = (call.getDouble("silenceMs") ?? 1000) / 1000
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
                        try self.startRecognition(call: call, timeout: timeout, silence: silence, contextual: contextual)
                    } catch {
                        self.finishListening(error: error.localizedDescription)
                    }
                }
            }
        }
    }

    private func startRecognition(call: CAPPluginCall, timeout: TimeInterval, silence: TimeInterval, contextual: [String]) throws {
        finishListening(error: "Superseded by a new request")
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
            call.reject("Speech recognition is not available right now.")
            return
        }
        listenCall = call
        transcript = ""
        startTimeout = timeout
        silenceWindow = silence
        listenStarted = Date()
        lastActivity = Date()
        lastWords = Date()
        heardVoice = false
        noiseFloor = -50
        try Self.setPlaybackSession()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.contextualStrings = contextual
        request.addsPunctuation = false
        // Keep audio on the device whenever the hardware supports it.
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        recognitionRequest = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            let level = Self.level(of: buffer)
            DispatchQueue.main.async { self?.noteLevel(level) }
        }
        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.listenCall != nil else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    if text != self.transcript {
                        self.transcript = text
                        self.heardVoice = true
                        self.lastActivity = Date()
                        self.lastWords = Date()
                    }
                    if result.isFinal { self.finishListening(error: nil) }
                } else if error != nil {
                    self.finishListening(error: nil)
                }
            }
        }
        // Check often whether the person has finished, rather than waiting a fixed time.
        listenTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.checkEndOfSpeech()
        }
    }

    /// Loudness of one microphone buffer in decibels.
    private static func level(of buffer: AVAudioPCMBuffer) -> Float {
        guard let data = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return -160 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(buffer.frameLength))
        return 20 * log10(max(rms, 1e-8))
    }

    /// Track background noise and notice when the person is making sound, so a pause to think
    /// mid-sentence doesn't end listening while they're still talking.
    private func noteLevel(_ db: Float) {
        guard listenCall != nil else { return }
        if db < noiseFloor { noiseFloor = db } else { noiseFloor += 0.02 }
        if db > noiseFloor + 12 && db > -55 {
            lastActivity = Date()
            if !transcript.isEmpty { heardVoice = true }
        }
    }

    private func checkEndOfSpeech() {
        guard listenCall != nil else { return }
        let now = Date()
        let quiet = now.timeIntervalSince(lastActivity)
        let elapsed = now.timeIntervalSince(listenStarted)
        if heardVoice && !transcript.isEmpty {
            // They spoke and have now paused: answer straight away. Sound alone (a noisy room)
            // can hold the mic open only briefly past the last recognized word.
            let wordsQuiet = now.timeIntervalSince(lastWords)
            if quiet >= silenceWindow || wordsQuiet >= silenceWindow + 1.5 || elapsed >= Self.maxListen {
                finishListening(error: nil)
            }
        } else if elapsed >= startTimeout {
            // Nobody started talking.
            finishListening(error: nil)
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
