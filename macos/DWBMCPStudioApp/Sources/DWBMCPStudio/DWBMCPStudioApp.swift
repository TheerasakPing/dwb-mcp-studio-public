import AppKit
import DWBPlatform
import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case setup = "Machine Setup"
    case tunnel = "Tunnel"
    case preferences = "Preferences"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .dashboard: "gauge.with.dots.needle.50percent"
        case .setup: "wrench.and.screwdriver"
        case .tunnel: "point.3.connected.trianglepath.dotted"
        case .preferences: "gearshape"
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var selection: AppSection = .dashboard
    @Published var tunnelID = ""
    @Published var apiKey = ""
    @Published var rememberKey = true
    @Published var tunnelStatus = "Unknown"
    @Published var output = ""
    @Published var isBusy = false

    let keychain = KeychainStore()
    let bridge: NodeBridge?
    let bridgeError: String?

    init() {
        do {
            bridge = try NodeBridge.discover()
            bridgeError = nil
        } catch {
            bridge = nil
            bridgeError = error.localizedDescription
        }
    }

    var nodePath: String {
        bridge?.nodeExecutable.path ?? "Not found"
    }

    var appRoot: String {
        bridge?.appRoot.path ?? "Unavailable"
    }

    func refreshTunnelStatus() async {
        guard let bridge else {
            output = bridgeError ?? "Node bridge is unavailable."
            tunnelStatus = "Unavailable"
            return
        }
        await perform {
            let result = try await bridge.run(
                script: "scripts/tunnel-runtime-posix.mjs",
                arguments: ["status"]
            )
            self.output = result.stdout
            self.tunnelStatus = Self.jsonString(result.stdout, key: "state") ?? "Unknown"
        }
    }

    func installMachine() async {
        guard let bridge else {
            output = bridgeError ?? "Node bridge is unavailable."
            return
        }
        await perform {
            let result = try await bridge.run(
                script: "scripts/external.mjs",
                arguments: ["install"]
            )
            self.output = result.stdout
        }
    }

    func runDoctor() async {
        guard let bridge else {
            output = bridgeError ?? "Node bridge is unavailable."
            return
        }
        await perform {
            let result = try await bridge.run(script: "scripts/doctor.mjs")
            self.output = result.stdout
        }
    }

    func startTunnel() async {
        guard let bridge else {
            output = bridgeError ?? "Node bridge is unavailable."
            return
        }
        let entered = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let stored: String?
        do {
            stored = try keychain.readTunnelAPIKey()
        } catch {
            output = error.localizedDescription
            return
        }
        let key = entered.isEmpty ? (stored ?? "") : entered
        guard !key.isEmpty else {
            output = "Enter an API key or save one in Keychain first."
            return
        }

        do {
            if rememberKey {
                try keychain.saveTunnelAPIKey(key)
            } else {
                try keychain.deleteTunnelAPIKey()
            }
        } catch {
            output = error.localizedDescription
            return
        }

        await perform {
            defer { self.apiKey = "" }
            let result = try await bridge.run(
                script: "scripts/tunnel-runtime-posix.mjs",
                arguments: ["start", "--tunnel-id", self.tunnelID],
                environmentOverrides: ["DWB_TUNNEL_RUNTIME_KEY": key]
            )
            self.output = result.stdout
            self.tunnelStatus = "Starting"
        }
    }

    func stopTunnel() async {
        guard let bridge else {
            output = bridgeError ?? "Node bridge is unavailable."
            return
        }
        await perform {
            let result = try await bridge.run(
                script: "scripts/tunnel-runtime-posix.mjs",
                arguments: ["stop"]
            )
            self.output = result.stdout
            self.tunnelStatus = "Stopped"
        }
    }

    func forgetAPIKey() {
        do {
            try keychain.deleteTunnelAPIKey()
            apiKey = ""
            output = "Saved tunnel API key removed from Keychain."
        } catch {
            output = error.localizedDescription
        }
    }

    private func perform(_ operation: @escaping @MainActor () async throws -> Void) async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await operation()
        } catch {
            output = error.localizedDescription
        }
    }

    private static func jsonString(_ text: String, key: String) -> String? {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object[key] as? String
    }
}

struct ContentView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        NavigationSplitView {
            List(AppSection.allCases, selection: $model.selection) { section in
                Label(section.rawValue, systemImage: section.symbol)
                    .tag(section)
            }
            .navigationTitle("DWB MCP Studio")
        } detail: {
            switch model.selection {
            case .dashboard:
                DashboardView(model: model)
            case .setup:
                SetupView(model: model)
            case .tunnel:
                TunnelView(model: model)
            case .preferences:
                PreferencesView(model: model)
            }
        }
        .frame(minWidth: 900, minHeight: 600)
    }
}

struct DashboardView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                VStack(alignment: .leading) {
                    Text("Runtime")
                        .font(.largeTitle.bold())
                    Text("Tunnel status: \(model.tunnelStatus)")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh") {
                    Task { await model.refreshTunnelStatus() }
                }
                .disabled(model.isBusy)
            }

            GroupBox("Runtime output") {
                ScrollView {
                    Text(model.output.isEmpty ? "No runtime output yet." : model.output)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                }
            }
            Spacer()
        }
        .padding(24)
        .task {
            await model.refreshTunnelStatus()
        }
    }
}

struct SetupView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Form {
            Section("Machine") {
                LabeledContent("Node.js", value: model.nodePath)
                LabeledContent("DWB root", value: model.appRoot)
            }

            Section("Managed dependencies") {
                Text("Installs Desktop Commander 0.2.50 and the pinned native tunnel-client into the DWB external directory.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Install / Repair") {
                        Task { await model.installMachine() }
                    }
                    .disabled(model.isBusy)
                    Button("Run Doctor") {
                        Task { await model.runDoctor() }
                    }
                    .disabled(model.isBusy)
                }
            }

            Section("Output") {
                Text(model.output.isEmpty ? "Ready." : model.output)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Machine Setup")
    }
}

struct TunnelView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Form {
            Section("OpenAI Tunnel") {
                TextField("Tunnel ID", text: $model.tunnelID)
                    .textFieldStyle(.roundedBorder)
                SecureField("Runtime API key", text: $model.apiKey)
                    .textFieldStyle(.roundedBorder)
                Toggle("Remember API key in macOS Keychain", isOn: $model.rememberKey)
            }

            Section {
                HStack {
                    Button("Start MCP") {
                        Task { await model.startTunnel() }
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.isBusy || model.tunnelID.isEmpty)

                    Button("Stop MCP") {
                        Task { await model.stopTunnel() }
                    }
                    .disabled(model.isBusy)

                    Button("Forget Saved Key", role: .destructive) {
                        model.forgetAPIKey()
                    }
                    .disabled(model.isBusy)
                }
            }

            Section("Status") {
                LabeledContent("Tunnel", value: model.tunnelStatus)
                Text(model.output.isEmpty ? "No output yet." : model.output)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Tunnel")
    }
}

struct PreferencesView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Form {
            Section("Security") {
                LabeledContent("Keychain service", value: KeychainStore.defaultService)
                LabeledContent("Key account", value: KeychainStore.tunnelAPIKeyAccount)
                Button("Forget Saved Tunnel Key", role: .destructive) {
                    model.forgetAPIKey()
                }
            }

            Section("Development runtime") {
                Text("The prototype uses DWB_APP_ROOT when set, otherwise the current working directory. Production app-bundle resource discovery will replace this in the packaging phase.")
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Preferences")
    }
}

@main
@MainActor
struct DWBMCPStudioApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }

        MenuBarExtra("DWB MCP Studio", systemImage: "bolt.horizontal.circle") {
            Text("Tunnel: \(model.tunnelStatus)")
            Divider()
            Button("Refresh Status") {
                Task { await model.refreshTunnelStatus() }
            }
            Button("Stop MCP") {
                Task { await model.stopTunnel() }
            }
            Divider()
            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        }
    }
}
