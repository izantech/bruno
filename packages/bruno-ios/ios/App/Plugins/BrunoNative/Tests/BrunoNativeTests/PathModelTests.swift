import XCTest
@testable import BrunoNative

final class PathModelTests: XCTestCase {
    private var rootA: URL!
    private var rootB: URL!

    override func setUp() {
        super.setUp()
        rootA = makeTempRoot()
        rootB = makeTempRoot()
        PathModel.documentsRootOverride = rootA
    }

    override func tearDown() {
        PathModel.documentsRootOverride = nil
        try? FileManager.default.removeItem(at: rootA)
        try? FileManager.default.removeItem(at: rootB)
        super.tearDown()
    }

    private func makeTempRoot() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url.resolvingSymlinksInPath()
    }

    func testTokenizeNested() {
        let absolute = rootA.appendingPathComponent("MyCol/req.bru").path
        XCTAssertEqual(PathModel.tokenize(absolute), "@documents/MyCol/req.bru")
    }

    func testTokenizeRoot() {
        XCTAssertEqual(PathModel.tokenize(rootA.path), "@documents")
    }

    func testResolveNested() {
        let resolved = PathModel.resolve("@documents/MyCol/req.bru")
        XCTAssertEqual(resolved, rootA.appendingPathComponent("MyCol/req.bru").path)
    }

    func testResolveRoot() {
        XCTAssertEqual(PathModel.resolve("@documents"), rootA.path)
    }

    func testRoundTrip() {
        let nested = rootA.appendingPathComponent("MyCol/folder/req.bru").path
        let single = rootA.appendingPathComponent("MyCol").path
        let root = rootA.path
        XCTAssertEqual(PathModel.resolve(PathModel.tokenize(nested)), nested)
        XCTAssertEqual(PathModel.resolve(PathModel.tokenize(single)), single)
        XCTAssertEqual(PathModel.resolve(PathModel.tokenize(root)), root)
    }

    func testReinstallUUIDChange() {
        let absoluteUnderA = rootA.appendingPathComponent("MyCol/req.bru").path
        let token = PathModel.tokenize(absoluteUnderA)

        PathModel.documentsRootOverride = rootB
        let resolvedUnderB = PathModel.resolve(token)
        XCTAssertEqual(resolvedUnderB, rootB.appendingPathComponent("MyCol/req.bru").path)
    }

    func testOutsideRootPassthrough() {
        let outside = "/var/other/x"
        XCTAssertEqual(PathModel.tokenize(outside), outside)
    }

    func testIsToken() {
        XCTAssertTrue(PathModel.isToken("@documents"))
        XCTAssertTrue(PathModel.isToken("@documents/MyCol/req.bru"))
        XCTAssertFalse(PathModel.isToken("/var/mobile/Documents/x"))
        XCTAssertFalse(PathModel.isToken("MyCol/req.bru"))
    }

    func testNormalizeToken() {
        XCTAssertEqual(PathModel.normalizeToken("@documents/a//b/"), "@documents/a/b")
        XCTAssertEqual(PathModel.normalizeToken("@documents/./a/b"), "@documents/a/b")
        XCTAssertEqual(PathModel.normalizeToken("@documents/"), "@documents")
    }

    func testRebaseInboundOutboundSnapshotWalk() {
        let colAbs = rootA.appendingPathComponent("MyCol").path
        let reqAbs = rootA.appendingPathComponent("MyCol/req.bru").path
        let envAbs = rootA.appendingPathComponent("MyCol/environments/dev.bru").path

        let tokenSnapshot: [String: Any] = [
            "activeWorkspacePath": "@documents",
            "name": "should-not-change",
            "workspaces": [[
                "pathname": "@documents",
                "lastActiveCollectionPathname": "@documents/MyCol",
                "collections": ["@documents/MyCol"]
            ]],
            "collections": [[
                "pathname": "@documents/MyCol",
                "workspacePathname": "@documents",
                "environmentPath": "@documents/MyCol/environments",
                "name": "MyCol",
                "environment": ["collection": "@documents/MyCol/environments/dev.bru"],
                "tabs": [["pathname": "@documents/MyCol/req.bru"]]
            ]]
        ]

        let resolved = PathModel.rebaseInbound(tokenSnapshot) as! [String: Any]
        XCTAssertEqual(resolved["activeWorkspacePath"] as? String, rootA.path)
        XCTAssertEqual(resolved["name"] as? String, "should-not-change")

        let resolvedWorkspaces = resolved["workspaces"] as! [[String: Any]]
        XCTAssertEqual(resolvedWorkspaces[0]["pathname"] as? String, rootA.path)
        XCTAssertEqual(resolvedWorkspaces[0]["lastActiveCollectionPathname"] as? String, colAbs)
        XCTAssertEqual(resolvedWorkspaces[0]["collections"] as? [String], [colAbs])

        let resolvedCollections = resolved["collections"] as! [[String: Any]]
        XCTAssertEqual(resolvedCollections[0]["pathname"] as? String, colAbs)
        XCTAssertEqual(resolvedCollections[0]["workspacePathname"] as? String, rootA.path)
        XCTAssertEqual(resolvedCollections[0]["name"] as? String, "MyCol")
        let resolvedEnvironment = resolvedCollections[0]["environment"] as! [String: Any]
        XCTAssertEqual(resolvedEnvironment["collection"] as? String, envAbs)
        let resolvedTabs = resolvedCollections[0]["tabs"] as! [[String: Any]]
        XCTAssertEqual(resolvedTabs[0]["pathname"] as? String, reqAbs)

        let roundTripped = PathModel.rebaseOutbound(resolved) as! [String: Any]
        XCTAssertEqual(roundTripped["activeWorkspacePath"] as? String, "@documents")
        let roundTrippedTabs = (roundTripped["collections"] as! [[String: Any]])[0]["tabs"] as! [[String: Any]]
        XCTAssertEqual(roundTrippedTabs[0]["pathname"] as? String, "@documents/MyCol/req.bru")
    }
}
