import Foundation
import Capacitor

/// Native Filesystem boundary for the iOS app.
///
/// Exposes byte-level CRUD over the app-sandbox Documents directory. Every
/// inbound path is a `@documents` token resolved via `PathModel` before any
/// FileManager op; every outbound path is tokenized so the JS/Redux layer never
/// sees a device-absolute path. No `.bru`/`.yml` parsing happens here — the JS
/// adapter owns all format parsing and stringifying.
@objc(BrunoFilesystemPlugin)
public class BrunoFilesystemPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BrunoFilesystemPlugin"
    public let jsName = "BrunoFilesystem"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getDocumentsRoot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanWorkspace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readDirTree", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteEntry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mkdir", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rename", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyTree", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mountCollection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshotGet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshotSave", returnType: CAPPluginReturnPromise)
    ]

    private let fileManager = FileManager.default
    private let snapshotFileName = ".bruno-snapshot.json"

    private let watcher = DirectoryWatcher()

    // MARK: - Root

    @objc func getDocumentsRoot(_ call: CAPPluginCall) {
        call.resolve(["root": PathModel.documentsRoot.path])
    }

    // MARK: - Workspace scan

    @objc func scanWorkspace(_ call: CAPPluginCall) {
        let root = PathModel.documentsRoot
        var collections: [[String: Any]] = []

        let contents = (try? fileManager.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []

        for url in contents {
            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
                continue
            }

            let ymlURL = url.appendingPathComponent("opencollection.yml")
            let jsonURL = url.appendingPathComponent("bruno.json")

            let format: String
            let configURL: URL
            if fileManager.fileExists(atPath: ymlURL.path) {
                format = "yml"
                configURL = ymlURL
            } else if fileManager.fileExists(atPath: jsonURL.path) {
                format = "bru"
                configURL = jsonURL
            } else {
                continue
            }

            guard let raw = try? String(contentsOf: configURL, encoding: .utf8) else {
                continue
            }

            collections.append([
                "token": PathModel.tokenize(url.path),
                "format": format,
                "brunoConfig": brunoConfigValue(raw: raw, format: format)
            ])
        }

        call.resolve(["collections": collections])
    }

    /// Returns a bridge-safe brunoConfig value. bruno.json is JSON so it is
    /// deserialized into an object; opencollection.yml is handed back as a raw
    /// string under `{ raw: ... }` (YAML parsing stays in JS, fork A1).
    private func brunoConfigValue(raw: String, format: String) -> Any {
        if format == "bru",
           let data = raw.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) {
            return object
        }
        return ["raw": raw]
    }

    // MARK: - Read

    @objc func readFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        let absolute = PathModel.resolve(path)
        do {
            let content = try String(contentsOfFile: absolute, encoding: .utf8)
            call.resolve(["content": content])
        } catch {
            call.reject("failed to read file: \(error.localizedDescription)")
        }
    }

    @objc func readDirTree(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        let absolute = PathModel.resolve(path)
        let rootURL = URL(fileURLWithPath: absolute)

        guard let enumerator = fileManager.enumerator(at: rootURL, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else {
            call.resolve(["entries": []])
            return
        }

        var entries: [[String: Any]] = []
        for case let url as URL in enumerator {
            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
                continue
            }
            if isDirectory.boolValue {
                entries.append([
                    "path": PathModel.tokenize(url.path),
                    "type": "dir"
                ])
            } else {
                var entry: [String: Any] = [
                    "path": PathModel.tokenize(url.path),
                    "type": "file"
                ]
                if let content = try? String(contentsOf: url, encoding: .utf8) {
                    entry["content"] = content
                }
                entries.append(entry)
            }
        }

        call.resolve(["entries": entries])
    }

    // MARK: - Write

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let content = call.getString("content") else {
            call.reject("path and content are required")
            return
        }
        let absolute = PathModel.resolve(path)
        let url = URL(fileURLWithPath: absolute)
        do {
            try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try content.write(to: url, atomically: true, encoding: .utf8)
            call.resolve()
        } catch {
            call.reject("failed to write file: \(error.localizedDescription)")
        }
    }

    @objc func deleteEntry(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        let absolute = PathModel.resolve(path)
        do {
            try fileManager.removeItem(atPath: absolute)
            call.resolve()
        } catch {
            call.reject("failed to delete entry: \(error.localizedDescription)")
        }
    }

    @objc func mkdir(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        let absolute = PathModel.resolve(path)
        do {
            try fileManager.createDirectory(atPath: absolute, withIntermediateDirectories: true)
            call.resolve()
        } catch {
            call.reject("failed to create directory: \(error.localizedDescription)")
        }
    }

    @objc func rename(_ call: CAPPluginCall) {
        guard let from = call.getString("from"), let to = call.getString("to") else {
            call.reject("from and to are required")
            return
        }
        let fromAbsolute = PathModel.resolve(from)
        let toAbsolute = PathModel.resolve(to)
        let toURL = URL(fileURLWithPath: toAbsolute)
        do {
            try fileManager.createDirectory(at: toURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fileManager.moveItem(atPath: fromAbsolute, toPath: toAbsolute)
            call.resolve(["to": PathModel.tokenize(toAbsolute)])
        } catch {
            call.reject("failed to rename: \(error.localizedDescription)")
        }
    }

    @objc func copyTree(_ call: CAPPluginCall) {
        guard let from = call.getString("from"), let to = call.getString("to") else {
            call.reject("from and to are required")
            return
        }
        let fromAbsolute = PathModel.resolve(from)
        let toAbsolute = PathModel.resolve(to)
        let toURL = URL(fileURLWithPath: toAbsolute)
        do {
            try fileManager.createDirectory(at: toURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try fileManager.copyItem(atPath: fromAbsolute, toPath: toAbsolute)
            call.resolve(["to": PathModel.tokenize(toAbsolute)])
        } catch {
            call.reject("failed to copy tree: \(error.localizedDescription)")
        }
    }

    // MARK: - Stat

    @objc func stat(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        let absolute = PathModel.resolve(path)
        var isDirectory: ObjCBool = false
        let exists = fileManager.fileExists(atPath: absolute, isDirectory: &isDirectory)
        var size = 0
        if exists, !isDirectory.boolValue,
           let attributes = try? fileManager.attributesOfItem(atPath: absolute),
           let fileSize = attributes[.size] as? Int {
            size = fileSize
        }
        call.resolve([
            "exists": exists,
            "isDirectory": isDirectory.boolValue,
            "size": size
        ])
    }

    @objc func exists(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("path is required")
            return
        }
        let absolute = PathModel.resolve(path)
        call.resolve(["exists": fileManager.fileExists(atPath: absolute)])
    }

    // MARK: - Mount

    @objc func mountCollection(_ call: CAPPluginCall) {
        guard let token = call.getString("token") else {
            call.reject("token is required")
            return
        }
        let source = PathModel.resolve(token)
        let name = URL(fileURLWithPath: source).lastPathComponent
        let temp = PathModel.documentsRoot
            .appendingPathComponent("tmp")
            .appendingPathComponent(UUID().uuidString)
            .appendingPathComponent(name)
        do {
            try fileManager.createDirectory(at: temp, withIntermediateDirectories: true)
            call.resolve(["tempDirectoryToken": PathModel.tokenize(temp.path)])
        } catch {
            call.reject("failed to mount collection: \(error.localizedDescription)")
        }
    }

    // MARK: - Snapshot

    @objc func snapshotGet(_ call: CAPPluginCall) {
        let url = PathModel.documentsRoot.appendingPathComponent(snapshotFileName)
        guard fileManager.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) else {
            call.resolve(["snapshot": NSNull()])
            return
        }
        let rebased = PathModel.rebaseOutbound(object)
        call.resolve(["snapshot": rebased])
    }

    @objc func snapshotSave(_ call: CAPPluginCall) {
        guard let snapshot = call.getObject("snapshot") else {
            call.reject("snapshot is required")
            return
        }
        let tokenized = PathModel.rebaseOutbound(snapshot)
        let url = PathModel.documentsRoot.appendingPathComponent(snapshotFileName)
        do {
            let data = try JSONSerialization.data(withJSONObject: tokenized)
            try data.write(to: url, options: .atomic)
            call.resolve(["ok": true])
        } catch {
            call.reject("failed to save snapshot: \(error.localizedDescription)")
        }
    }
}
