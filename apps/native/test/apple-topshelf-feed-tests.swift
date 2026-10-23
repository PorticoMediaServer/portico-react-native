import Foundation

@main enum ShelfFeedTests {
  static func main() throws {
    func entry(_ id: String, show: String? = nil) -> [String: Any] {
      var value: [String: Any] = ["id": id, "title": "Title \(id)", "displayUrl": "portico://item/\(id)", "kind": "episode"]
      if let show { value["showTitle"] = show }
      return value
    }
    func section(_ id: String, _ entries: [[String: Any]], code: String = "next.home.continueWatching", params: [String: String]? = nil) -> [String: Any] {
      var text: [String: Any] = ["code": code, "fallback": "Server \(id)"]
      if let params { text["params"] = params }
      return ["id": id, "title": "Server \(id)", "titleText": text, "shape": "poster", "entries": entries]
    }
    func decode(_ sections: [[String: Any]]) throws -> PorticoShelfFeed {
      try JSONDecoder().decode(PorticoShelfFeed.self, from: JSONSerialization.data(withJSONObject: ["sections": sections]))
    }
    let feed = try decode([
      section("continue", [entry("a", show: "Actual show"), entry("b")]),
      section("duplicate", [entry("a")]),
      section("recent", [entry("b"), entry("c")], code: "home.row.recentlyAddedIn", params: ["library": "Films"]),
      section("later", [entry("d")]),
    ])
    let rows = feed.selectedRows()
    precondition(rows.map { $0.section.id } == ["continue", "recent"])
    precondition(rows[0].entries.map(\.id) == ["a", "b"])
    precondition(rows[1].entries.map(\.id) == ["c"])
    precondition(rows[0].entries[0].tileTitle == "Actual show")
    precondition(rows[0].entries[1].tileTitle == "Title b")
    var lookups: [(String, [String: String])] = []
    let title = rows[0].section.localizedTitle { code, params in
      lookups.append((code, params)); return "Catalogue row"
    }
    precondition(title == "Catalogue row" && lookups[0].0 == "next.home.continueWatching" && lookups[0].1.isEmpty)
    let nextTitle = rows[1].section.localizedTitle { code, params in
      precondition(code == "home.row.recentlyAddedIn" && params == ["library": "Films"])
      return "Resolved library row"
    }
    precondition(nextTitle == "Resolved library row")
    precondition(rows[1].section.localizedTitle { _, _ in nil } == "Server recent")
    let unknown = try decode([section("unknown", [entry("e")], code: "unknown.server.code")]).selectedRows()
    precondition(unknown[0].section.localizedTitle { _, _ in nil } == "Server unknown")
    let empty = try decode([])
    precondition(empty.selectedRows().isEmpty)
    let limited = try decode([
      section("continue", (0..<15).map { entry("c\($0)") }),
      section("next", (0..<15).map { entry("n\($0)") }),
    ]).selectedRows()
    precondition(limited.map { $0.entries.count } == [10, 10])
    let noContinue = try decode([section("empty", []), section("first", [entry("f")]), section("second", [entry("g")])]).selectedRows()
    precondition(noContinue.map { $0.section.id } == ["first"])
    let suppliedEmpty = try decode([section("first", [entry("h", show: "")])]).selectedRows()
    precondition(suppliedEmpty[0].entries[0].tileTitle.isEmpty)
    print("Apple Top Shelf feed checks passed")
  }
}
