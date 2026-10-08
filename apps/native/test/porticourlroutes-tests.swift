import Foundation

// APP-08: the native URL allowlist.
//
// Compiled together with the real tvos/Portico/PorticoURLRoutes.swift —
// no copy of the grammar lives here. Run with:
//
//   swiftc -O -o "$OUT/url-routes" \
//     apps/native/tvos/Portico/PorticoURLRoutes.swift \
//     apps/native/test/porticourlroutes-tests.swift
//   "$OUT/url-routes"

@main
struct URLRouteTests {
  static var failures = 0

  static func expect(_ text: String, _ allowed: Bool, _ why: String) {
    guard let url = URL(string: text) else {
      if allowed { FileHandle.standardError.write("FAIL unparsable: \(text)\n".data(using: .utf8)!); failures += 1 }
      return
    }
    let actual = PorticoURLRoutes.allows(url)
    if actual != allowed {
      FileHandle.standardError.write("FAIL \(why): \(text) — expected \(allowed), got \(actual)\n".data(using: .utf8)!)
      failures += 1
    }
  }

  static func main() {
    // Malformed fragments are refused, never a crash (an empty key/value split).
    expect("portico://invite#=", false, "empty fragment pair")
    expect("portico://invite#&=&", false, "empty fragment pairs")
    expect("https://web.getportico.tv/join#=", false, "empty universal-link fragment pair")

    // The two actions the server publishes in the Top Shelf feed. These are the
    // warm-launch URLs that used to be refused before reaching React Native.
    expect("portico://item/abc123", true, "Top Shelf display action")
    expect("portico://play/abc123", true, "Top Shelf play action")
    expect("portico://item/ITEM_with-mixed_Case-09", true, "the identifier charset the router accepts")
    expect("portico://item/" + String(repeating: "a", count: 128), true, "an identifier at the length limit")

    // The sign-in continuation must keep working exactly as before.
    expect("portico://account-return?transactionId=tx_123", true, "account return")
    expect("portico://account-return?transactionId=tx_123&code=" + String(repeating: "C", count: 43), true, "account return with a completion code (SEC-01)")
    expect("portico://account-return?transactionId=tx_123&code=short", false, "account return with a malformed code")
    expect("portico://account-return?code=" + String(repeating: "C", count: 43) + "&transactionId=tx_123", false, "account return with the code first")

    // Everything else stays refused.
    expect("portico://item/", false, "an empty identifier")
    expect("portico://item", false, "no identifier at all")
    expect("portico://item/" + String(repeating: "a", count: 129), false, "an over-long identifier")
    expect("portico://item/abc/def", false, "an extra path component")
    expect("portico://item/abc?x=1", false, "an unexpected query")
    expect("portico://item/abc#frag", false, "a fragment")
    expect("portico://user:pass@item/abc", false, "embedded credentials")
    expect("portico://item:8080/abc", false, "a port")
    expect("portico://item/abc%2Fdef", false, "a percent-encoded separator")
    expect("portico://item/abc def", false, "a space in the identifier")
    expect("portico://item/../secret", false, "path traversal")
    expect("https://item/abc", false, "another scheme")
    expect("portico://open/abc", false, "an unknown host")
    expect("portico://account-return", false, "account return with no transaction")
    expect("portico://account-return?transactionId=tx&other=1", false, "account return with extra parameters")
    expect("portico://account-return?transactionId=", false, "account return with an empty transaction")
    expect("portico://account-return/extra?transactionId=tx", false, "account return with a path")

    // SEC-01: a provider sign-in's https return becomes the app's own return, only when well-formed.
    let code = String(repeating: "C", count: 43)
    func expectRoute(_ web: String, _ want: String?, _ why: String) {
      let got = PorticoURLRoutes.route(activityType: "NSUserActivityTypeBrowsingWeb", userInfo: nil, webpageURL: URL(string: web))?.absoluteString
      if got != want { FileHandle.standardError.write("FAIL \(why): \(web) -> \(got ?? "nil")\n".data(using: .utf8)!); failures += 1 }
    }
    expectRoute("https://web.getportico.tv/app/account-return#tx=tx_A&code=" + code, "portico://account-return?transactionId=tx_A&code=" + code, "https account return")
    expectRoute("https://web.getportico.tv/app/account-return#code=" + code + "&tx=tx_A", "portico://account-return?transactionId=tx_A&code=" + code, "https account return, either order")
    expectRoute("https://web.getportico.tv/app/account-return#tx=tx_A", nil, "https account return without a code")
    expectRoute("https://web.getportico.tv/app/account-return#tx=tx_A&code=" + code + "&x=1", nil, "https account return with extra values")
    expectRoute("https://web.getportico.tv/app/account-return?x=1#tx=tx_A&code=" + code, nil, "https account return with a query")
    expectRoute("https://evil.example.com/app/account-return#tx=tx_A&code=" + code, nil, "account return on another host")

    // Spec — Hosted at Scale: a server's own invitation link opens the app's join screen.
    let invite = String(repeating: "I", count: 43)
    expectRoute("https://web.getportico.tv/join#code=" + invite + "&server=https%3A%2F%2Fdemo.getportico.tv", "portico://join#code=" + invite + "&server=https%3A%2F%2Fdemo%2Egetportico%2Etv", "https join link")
    expectRoute("https://web.getportico.tv/join#server=http%3A%2F%2F192.168.1.20%3A32500&code=" + invite, "portico://join#code=" + invite + "&server=http%3A%2F%2F192%2E168%2E1%2E20%3A32500", "https join link, either order, a LAN address")
    expectRoute("https://web.getportico.tv/join#code=short&server=https%3A%2F%2Fdemo.getportico.tv", nil, "a short invitation code")
    expectRoute("https://web.getportico.tv/join#code=" + invite + "&server=https%3A%2F%2Fuser%3Apw%40demo.getportico.tv", nil, "a server address with credentials")
    expectRoute("https://web.getportico.tv/join#code=" + invite + "&server=javascript%3Aalert(1)", nil, "a non-http server address")
    expectRoute("https://web.getportico.tv/join#code=" + invite + "&server=https%3A%2F%2Fdemo.getportico.tv%2Fpath", nil, "a server address with a path")
    expect("portico://join#code=" + invite + "&server=https%3A%2F%2Fdemo.getportico.tv", true, "the app's join route")
    expect("portico://join#code=" + invite, false, "a join route without the server")
    expect("portico://join?code=" + invite, false, "a join code in the query")

    if failures == 0 {
      print("PASS native URL allowlist: Top Shelf item/play forwarded, account-return preserved, traversal/credentials/port/query/fragment/overlong refused")
      exit(0)
    }
    exit(1)
  }
}
