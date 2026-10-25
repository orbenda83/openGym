// Local-only Android signing. Passwords stay in login Keychain and child-process memory.
import Foundation
import Security
import CryptoKit
import Darwin

let service = "live.orbenda.opengym.android-signing"
let account = "release"
let alias = "opengym-release"
let args = Array(CommandLine.arguments.dropFirst())
func die(_ message: String) -> Never { fputs(message + "\n", stderr); exit(1) }
func exists(_ path: String) -> Bool { FileManager.default.fileExists(atPath: path) }
func secureDirectory(_ path: String) {
    let url = URL(fileURLWithPath: path)
    if (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true { die("Refusing a symbolic-link key directory.") }
    do {
        try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path)
    } catch { die("Cannot prepare the private key directory.") }
}
func password(create: Bool) -> String {
    var login: SecKeychain?
    let loginPath = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Keychains/login.keychain-db").path
    guard SecKeychainOpen(loginPath, &login) == errSecSuccess, let keychain = login else { die("Cannot open login Keychain. Unlock it before signing.") }
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
        kSecAttrAccount as String: account, kSecMatchSearchList as String: [keychain],
        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) {
        if create { die("A signing password already exists without its key. Restore the key or investigate the interrupted setup; refusing a new identity.") }
        return value
    }
    guard status == errSecItemNotFound && create else { die("Signing password is unavailable. Unlock login Keychain; do not create a replacement key.") }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { die("Secure random generation failed.") }
    let value = Data(bytes).base64EncodedString()
    let item: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
        kSecAttrAccount as String: account, kSecAttrLabel as String: "openGym Orbenda Android signing password",
        kSecAttrSynchronizable as String: false, kSecUseKeychain as String: keychain, kSecValueData as String: Data(value.utf8)]
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { die("Cannot store signing password in login Keychain.") }
    return value
}
func run(_ executable: String, _ arguments: [String], secret: String? = nil) -> (Int32, Data) {
    let process = Process(), output = Pipe(), errors = Pipe()
    process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
    process.standardOutput = output; process.standardError = errors
    process.standardInput = FileHandle.nullDevice
    var env = ProcessInfo.processInfo.environment
    if let value = secret { env["OPENGYM_RELEASE_PASSWORD"] = value }
    process.environment = env
    do { try process.run() } catch { die("Cannot start the trusted signing tool: " + executable) }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    _ = errors.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return (process.terminationStatus, data)
}
func certificate(_ key: String, _ pass: String) -> (Data, String) {
    let (status, data) = run("/usr/bin/keytool", ["-exportcert", "-alias", alias, "-keystore", key, "-storepass:env", "OPENGYM_RELEASE_PASSWORD"], secret: pass)
    guard status == 0 && !data.isEmpty else { die("Cannot verify the existing keystore. Do not replace it.") }
    return (data, SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
}
func readAnchor(_ directory: String, _ pass: String) -> String {
    let (_, actual) = certificate(directory + "/release.p12", pass)
    guard let saved = try? String(contentsOfFile: directory + "/certificate.sha256", encoding: .utf8), saved.trimmingCharacters(in: .whitespacesAndNewlines) == actual else { die("Keystore certificate does not match the saved identity. Refusing to sign.") }
    return actual
}
// No generic 'print password' or arbitrary command execution interface.
guard args.count >= 2 else { die("Usage: macos-signing.swift init|fingerprint|sign|backup PRIVATE_DIR [arguments]") }
umask(0o077)
let command = args[0], directory = URL(fileURLWithPath: args[1]).standardizedFileURL.path
let key = directory + "/release.p12"
if command == "init" {
    secureDirectory(directory)
    if exists(key) {
        let fingerprint = readAnchor(directory, password(create: false))
        print("Existing signing identity verified: " + fingerprint)
        exit(0)
    }
    guard !exists(directory + "/certificate.sha256") && !exists(directory + "/releases.json") else { die("Key is missing for an existing identity. Restore a backup; do not rotate it.") }
    let pass = password(create: true)
    let (status, _) = run("/usr/bin/keytool", ["-genkeypair", "-alias", alias, "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-dname", "CN=openGym Orbenda", "-storetype", "PKCS12", "-keystore", key, "-storepass:env", "OPENGYM_RELEASE_PASSWORD", "-keypass:env", "OPENGYM_RELEASE_PASSWORD"], secret: pass)
    guard status == 0 else { die("Key generation failed. Existing files and Keychain entry retained for recovery.") }
    let (der, fingerprint) = certificate(key, pass)
    do {
        try der.write(to: URL(fileURLWithPath: directory + "/certificate.der"), options: .atomic)
        try (fingerprint + "\n").write(toFile: directory + "/certificate.sha256", atomically: true, encoding: .utf8)
        try "[]\n".write(toFile: directory + "/releases.json", atomically: true, encoding: .utf8)
        for file in [key, directory + "/certificate.der", directory + "/certificate.sha256", directory + "/releases.json"] { try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file) }
    } catch { die("Cannot save signing identity metadata. Key retained; do not regenerate it.") }
    print("Created permanent signing identity: " + fingerprint)
} else if command == "fingerprint" {
    print(readAnchor(directory, password(create: false)))
} else if command == "sign" {
    guard args.count == 5 else { die("Usage: sign PRIVATE_DIR TRUSTED_APKSIGNER UNSIGNED_APK OUTPUT_APK") }
    let signer = args[2], input = args[3], output = args[4]
    guard !exists(output) && exists(input) && exists(signer) else { die("Signing requires an existing input/tool and a new output path.") }
    let pass = password(create: false)
    _ = readAnchor(directory, pass)
    let (status, _) = run(signer, ["sign", "--ks", key, "--ks-key-alias", alias, "--ks-pass", "env:OPENGYM_RELEASE_PASSWORD", "--key-pass", "env:OPENGYM_RELEASE_PASSWORD", "--out", output, input], secret: pass)
    guard status == 0 else { die("APK signing failed; no release has been published.") }
    let (verified, _) = run(signer, ["verify", output])
    guard verified == 0 else { die("Signed APK verification failed; do not distribute it.") }
    print("Signed APK verified.")
} else if command == "backup" {
    guard args.count == 3 else { die("Usage: backup PRIVATE_DIR NEW_BACKUP_DIRECTORY") }
    _ = readAnchor(directory, password(create: false))
    let destination = URL(fileURLWithPath: args[2]).standardizedFileURL.path
    guard !exists(destination) && destination != directory else { die("Backup destination must be a new directory.") }
    secureDirectory(destination)
    do {
        for file in ["release.p12", "certificate.der", "certificate.sha256", "releases.json"] { try FileManager.default.copyItem(atPath: directory + "/" + file, toPath: destination + "/" + file) }
        try "Encrypted PKCS12 key. Password is in login Keychain: service live.orbenda.opengym.android-signing, account release. Keep a separate password-manager recovery copy before relying on this backup. Never upload the key or password to Git/server/chat.\n".write(toFile: destination + "/RECOVERY.txt", atomically: true, encoding: .utf8)
    } catch { die("Backup incomplete. Existing primary key has not changed.") }
    print("Encrypted key copied. Verify separate password recovery before relying on the backup.")
} else { die("Unknown signing command.") }
