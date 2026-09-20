import XCTest
@testable import DWBPlatform

final class KeychainStoreTests: XCTestCase {
    func testSaveReadOverwriteAndDelete() throws {
        let service = "com.devwithbebz.dwb-mcp-studio.tests.\(UUID().uuidString)"
        let account = "runtime-key"
        let store = KeychainStore(service: service)

        defer {
            try? store.delete(account: account)
        }

        XCTAssertNil(try store.read(account: account))

        try store.save("first-secret", account: account)
        XCTAssertEqual(try store.read(account: account), "first-secret")

        try store.save("second-secret", account: account)
        XCTAssertEqual(try store.read(account: account), "second-secret")

        try store.delete(account: account)
        XCTAssertNil(try store.read(account: account))
    }

    func testDeleteMissingItemIsIdempotent() throws {
        let service = "com.devwithbebz.dwb-mcp-studio.tests.\(UUID().uuidString)"
        let store = KeychainStore(service: service)
        XCTAssertNoThrow(try store.delete(account: "missing"))
    }
}
