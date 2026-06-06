import Foundation

/// Single rebasing authority between device-absolute filesystem paths and the
/// container-relative `@documents` tokens that cross the bridge to JS.
///
/// The app sandbox container UUID changes on every reinstall, so no absolute
/// path may ever be persisted. Everything outbound is tokenized; everything
/// inbound is resolved against the current Documents root before touching the
/// filesystem.
enum PathModel {
    /// Logical root token literal.
    static let token = "@documents"

    /// Overridable Documents root. Defaults to the FileManager Documents
    /// directory (canonicalized). Tests inject a temporary directory because the
    /// test host's Documents directory differs from the app sandbox.
    static var documentsRootOverride: URL?

    static var documentsRoot: URL {
        if let override = documentsRootOverride {
            return override.resolvingSymlinksInPath()
        }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return url.resolvingSymlinksInPath()
    }

    static func isToken(_ path: String) -> Bool {
        return path == token || path.hasPrefix(token + "/")
    }

    /// Collapses duplicate slashes, `.` segments and trailing slashes. Returns
    /// the bare root token unchanged.
    static func normalizeToken(_ value: String) -> String {
        guard isToken(value) else {
            return value
        }
        let relative = String(value.dropFirst(token.count))
        let segments = relative
            .split(separator: "/", omittingEmptySubsequences: true)
            .filter { $0 != "." }
        if segments.isEmpty {
            return token
        }
        return token + "/" + segments.joined(separator: "/")
    }

    /// Converts a device-absolute path under the Documents root into a token.
    /// A path outside the root is returned unchanged (guard, not a feature).
    static func tokenize(_ absolutePath: String) -> String {
        let rootPath = documentsRoot.path
        let normalizedAbsolute = URL(fileURLWithPath: absolutePath).resolvingSymlinksInPath().path

        if normalizedAbsolute == rootPath {
            return token
        }
        let rootPrefix = rootPath.hasSuffix("/") ? rootPath : rootPath + "/"
        guard normalizedAbsolute.hasPrefix(rootPrefix) else {
            return absolutePath
        }
        let relative = String(normalizedAbsolute.dropFirst(rootPrefix.count))
        if relative.isEmpty {
            return token
        }
        return token + "/" + relative
    }

    /// Converts a token into a device-absolute path under the current Documents
    /// root. A value that is already absolute and not a token is passed through.
    static func resolve(_ tokenPath: String) -> String {
        guard isToken(tokenPath) else {
            return tokenPath
        }
        let normalized = normalizeToken(tokenPath)
        if normalized == token {
            return documentsRoot.path
        }
        let relative = String(normalized.dropFirst(token.count + 1))
        return documentsRoot.appendingPathComponent(relative).path
    }

    /// Deep-walks an argument value resolving tokens to absolute paths. Used for
    /// structured inbound args (the snapshot blob, nested objects).
    static func rebaseInbound(_ value: Any) -> Any {
        return walkSnapshot(value, transform: resolve)
    }

    /// Deep-walks a value tokenizing absolute paths in known path-bearing
    /// fields. Used for return values and event payloads.
    static func rebaseOutbound(_ value: Any) -> Any {
        return walkSnapshot(value, transform: tokenize)
    }

    // MARK: - Snapshot walk

    /// The absolute-path fields the snapshot walk rebases. A schema-aware
    /// traversal (not blind) so only known path-bearing fields are rewritten.
    private static let workspacePathKeys: Set<String> = [
        "pathname",
        "lastActiveCollectionPathname"
    ]
    private static let collectionPathKeys: Set<String> = [
        "pathname",
        "workspacePathname",
        "environmentPath"
    ]
    private static let tabPathKeys: Set<String> = [
        "pathname"
    ]

    /// Schema-aware traversal over the 9 snapshot path fields. The `transform`
    /// is either `resolve` (read) or `tokenize` (write).
    static func walkSnapshot(_ value: Any, transform: (String) -> String) -> Any {
        guard var snapshot = value as? [String: Any] else {
            return value
        }

        if let activeWorkspacePath = snapshot["activeWorkspacePath"] as? String {
            snapshot["activeWorkspacePath"] = transform(activeWorkspacePath)
        }

        if let workspaces = snapshot["workspaces"] as? [[String: Any]] {
            snapshot["workspaces"] = workspaces.map { rebaseWorkspace($0, transform: transform) }
        }

        if let collections = snapshot["collections"] as? [[String: Any]] {
            snapshot["collections"] = collections.map { rebaseCollection($0, transform: transform) }
        }

        return snapshot
    }

    private static func rebaseWorkspace(_ value: [String: Any], transform: (String) -> String) -> [String: Any] {
        var workspace = value
        for key in workspacePathKeys {
            if let path = workspace[key] as? String {
                workspace[key] = transform(path)
            }
        }
        if let collections = workspace["collections"] as? [String] {
            workspace["collections"] = collections.map(transform)
        }
        return workspace
    }

    private static func rebaseCollection(_ value: [String: Any], transform: (String) -> String) -> [String: Any] {
        var collection = value
        for key in collectionPathKeys {
            if let path = collection[key] as? String {
                collection[key] = transform(path)
            }
        }
        if var environment = collection["environment"] as? [String: Any] {
            if let collectionPath = environment["collection"] as? String {
                environment["collection"] = transform(collectionPath)
            }
            collection["environment"] = environment
        }
        if let tabs = collection["tabs"] as? [[String: Any]] {
            collection["tabs"] = tabs.map { tab -> [String: Any] in
                var entry = tab
                for key in tabPathKeys {
                    if let path = entry[key] as? String {
                        entry[key] = transform(path)
                    }
                }
                return entry
            }
        }
        return collection
    }
}
