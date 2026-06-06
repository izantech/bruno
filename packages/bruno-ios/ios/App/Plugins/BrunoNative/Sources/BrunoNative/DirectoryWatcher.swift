import Foundation

/// Placeholder for external-edit watching of the Documents workspace.
///
/// Real watching (DispatchSource / file-presenter wiring that re-synthesizes
/// tree-update events when collections are edited via the Files app or iCloud)
/// is deferred to Batch 4. This type exists so the plugin can hold a watcher
/// reference now without committing to an implementation.
///
/// TODO(Batch 4): wire DispatchSource.makeFileSystemObjectSource (or an
/// NSFilePresenter) over the Documents root and emit main:collection-tree-updated
/// events for external edits.
final class DirectoryWatcher {
    func start() {
        // Intentionally empty until Batch 4.
    }

    func stop() {
        // Intentionally empty until Batch 4.
    }
}
