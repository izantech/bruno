import Foundation
import Capacitor

@objc(BrunoHttpPlugin)
public class BrunoHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BrunoHttpPlugin"
    public let jsName = "BrunoHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private var tasks: [String: URLSessionDataTask] = [:]
    private let tasksLock = NSLock()

    // MARK: - Send

    @objc func send(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let requestURL = URL(string: urlString) else {
            call.reject("url is required and must be a valid URL")
            return
        }
        guard let cancelTokenUid = call.getString("cancelTokenUid") else {
            call.reject("cancelTokenUid is required")
            return
        }

        let method = call.getString("method") ?? "GET"
        let headersObj = call.getObject("headers") ?? [:]
        let bodyObj = call.getObject("body") ?? [:]
        let timeoutMs = call.getInt("timeout") ?? 0

        var request = URLRequest(url: requestURL)
        request.httpMethod = method

        for (key, value) in headersObj {
            if let strValue = value as? String {
                request.setValue(strValue, forHTTPHeaderField: key)
            }
        }

        let bodyKind = bodyObj["kind"] as? String ?? "none"
        if bodyKind != "none", let bodyData = bodyObj["data"] as? String {
            let encoding = bodyObj["encoding"] as? String ?? "utf8"
            if encoding == "base64" {
                request.httpBody = Data(base64Encoded: bodyData)
            } else {
                request.httpBody = bodyData.data(using: .utf8)
            }
        }

        let configuration = URLSessionConfiguration.default
        if timeoutMs > 0 {
            configuration.timeoutIntervalForRequest = Double(timeoutMs) / 1000.0
        }
        let session = URLSession(configuration: configuration)

        let startTime = Date()

        let task = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }

            let durationMs = Int(Date().timeIntervalSince(startTime) * 1000)

            self.tasksLock.lock()
            self.tasks.removeValue(forKey: cancelTokenUid)
            self.tasksLock.unlock()

            if let urlError = error as? URLError, urlError.code == .cancelled {
                call.resolve([
                    "isCancel": true,
                    "error": "REQUEST_CANCELLED",
                    "statusText": "REQUEST_CANCELLED"
                ])
                return
            }

            if let error = error {
                call.resolve([
                    "error": error.localizedDescription,
                    "statusText": ""
                ])
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                call.resolve([
                    "error": "No HTTP response received",
                    "statusText": ""
                ])
                return
            }

            var flatHeaders: [String: String] = [:]
            for (key, value) in httpResponse.allHeaderFields {
                let strKey = "\(key)".lowercased()
                let strValue = "\(value)"
                flatHeaders[strKey] = strValue
            }

            let responseData = data ?? Data()
            let dataBase64 = responseData.base64EncodedString()
            let size = responseData.count
            let status = httpResponse.statusCode
            let statusText = HTTPURLResponse.localizedString(forStatusCode: status)

            call.resolve([
                "status": status,
                "statusText": statusText,
                "headers": flatHeaders,
                "dataBase64": dataBase64,
                "size": size,
                "duration": durationMs
            ])
        }

        tasksLock.lock()
        tasks[cancelTokenUid] = task
        tasksLock.unlock()

        task.resume()
    }

    // MARK: - Cancel

    @objc func cancel(_ call: CAPPluginCall) {
        guard let cancelTokenUid = call.getString("cancelTokenUid") else {
            call.reject("cancelTokenUid is required")
            return
        }

        tasksLock.lock()
        tasks[cancelTokenUid]?.cancel()
        tasks.removeValue(forKey: cancelTokenUid)
        tasksLock.unlock()

        call.resolve()
    }
}
