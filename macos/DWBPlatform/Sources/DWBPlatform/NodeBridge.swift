import Foundation

public enum NodeBridgeError: Error, LocalizedError {
    case nodeNotFound
    case commandFailed(Int32, String)

    public var errorDescription: String? {
        switch self {
        case .nodeNotFound:
            return "Node.js 22.16 or newer was not found."
        case .commandFailed(let code, let message):
            return "DWB command failed (\(code)): \(message)"
        }
    }
}

public struct NodeCommandResult: Sendable {
    public let stdout: String
    public let stderr: String
    public let exitCode: Int32
}

public struct NodeBridge: Sendable {
    public let appRoot: URL
    public let nodeExecutable: URL

    public init(appRoot: URL, nodeExecutable: URL) {
        self.appRoot = appRoot.standardizedFileURL
        self.nodeExecutable = nodeExecutable.standardizedFileURL
    }

    public static func discover(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) throws -> NodeBridge {
        let appRoot = environment["DWB_APP_ROOT"].map { URL(fileURLWithPath: $0) } ?? currentDirectory
        guard let node = discoverNode(environment: environment) else {
            throw NodeBridgeError.nodeNotFound
        }
        return NodeBridge(appRoot: appRoot, nodeExecutable: node)
    }

    public static func discoverNode(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL? {
        var candidates: [String] = []
        if let explicit = environment["DWB_NODE_PATH"], !explicit.isEmpty {
            candidates.append(explicit)
        }
        candidates.append(contentsOf: [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ])
        if let path = environment["PATH"] {
            candidates.append(contentsOf: path.split(separator: ":").map { "\($0)/node" })
        }

        var seen = Set<String>()
        for candidate in candidates {
            let standardized = URL(fileURLWithPath: candidate).standardizedFileURL.path
            guard seen.insert(standardized).inserted else { continue }
            if FileManager.default.isExecutableFile(atPath: standardized) {
                return URL(fileURLWithPath: standardized)
            }
        }
        return nil
    }

    public func run(
        script relativeScript: String,
        arguments: [String] = [],
        environmentOverrides: [String: String] = [:]
    ) async throws -> NodeCommandResult {
        let scriptURL = appRoot.appendingPathComponent(relativeScript).standardizedFileURL
        guard scriptURL.path.hasPrefix(appRoot.path + "/") else {
            throw NodeBridgeError.commandFailed(-1, "Script escaped the DWB application root.")
        }
        guard FileManager.default.fileExists(atPath: scriptURL.path) else {
            throw NodeBridgeError.commandFailed(-1, "Missing DWB script: \(relativeScript)")
        }

        let tempRoot = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let runID = UUID().uuidString
        let stdoutURL = tempRoot.appendingPathComponent("dwb-\(runID).stdout")
        let stderrURL = tempRoot.appendingPathComponent("dwb-\(runID).stderr")
        FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
        FileManager.default.createFile(atPath: stderrURL.path, contents: nil)

        let stdoutHandle = try FileHandle(forWritingTo: stdoutURL)
        let stderrHandle = try FileHandle(forWritingTo: stderrURL)

        return try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = nodeExecutable
            process.arguments = [scriptURL.path] + arguments
            process.currentDirectoryURL = appRoot

            var environment = ProcessInfo.processInfo.environment
            for (name, value) in environmentOverrides {
                environment[name] = value
            }
            process.environment = environment
            process.standardOutput = stdoutHandle
            process.standardError = stderrHandle

            process.terminationHandler = { process in
                try? stdoutHandle.close()
                try? stderrHandle.close()

                let stdout = (try? String(contentsOf: stdoutURL, encoding: .utf8)) ?? ""
                let stderr = (try? String(contentsOf: stderrURL, encoding: .utf8)) ?? ""
                try? FileManager.default.removeItem(at: stdoutURL)
                try? FileManager.default.removeItem(at: stderrURL)

                let result = NodeCommandResult(
                    stdout: stdout.trimmingCharacters(in: .whitespacesAndNewlines),
                    stderr: stderr.trimmingCharacters(in: .whitespacesAndNewlines),
                    exitCode: process.terminationStatus
                )

                if process.terminationStatus == 0 {
                    continuation.resume(returning: result)
                } else {
                    continuation.resume(
                        throwing: NodeBridgeError.commandFailed(
                            process.terminationStatus,
                            result.stderr.isEmpty ? result.stdout : result.stderr
                        )
                    )
                }
            }

            do {
                try process.run()
            } catch {
                try? stdoutHandle.close()
                try? stderrHandle.close()
                try? FileManager.default.removeItem(at: stdoutURL)
                try? FileManager.default.removeItem(at: stderrURL)
                continuation.resume(throwing: error)
            }
        }
    }
}
