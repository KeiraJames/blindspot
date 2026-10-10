import Foundation
import AuthenticationServices
import Capacitor

/// Native Sign in with Apple. Firebase's web popup flow does not work inside WKWebView, so
/// the identity token is obtained here and exchanged with Firebase Auth in JS.
@objc(PathSenseAppleSignInPlugin)
public class PathSenseAppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "PathSenseAppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

    @objc func authorize(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce") else {
            call.reject("nonce is required")
            return
        }
        DispatchQueue.main.async {
            self.pending?.reject("Superseded by a new sign-in request")
            self.pending = call
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonce
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pending else { return }
        pending = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple did not return an identity token.")
            return
        }
        var result: JSObject = ["identityToken": token]
        if let given = credential.fullName?.givenName { result["givenName"] = given }
        if let family = credential.fullName?.familyName { result["familyName"] = family }
        if let email = credential.email { result["email"] = email }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pending else { return }
        pending = nil
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("Sign in was cancelled.", "CANCELLED")
        } else {
            call.reject(error.localizedDescription)
        }
    }
}
