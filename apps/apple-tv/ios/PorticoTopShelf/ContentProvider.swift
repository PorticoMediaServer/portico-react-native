import Foundation
import TVServices

private let appGroup = "group.tv.getportico"
private let payloadKey = "PorticoTopShelfPayload.v1"

private struct Snapshot: Decodable {
  let version: Int
  let items: [SnapshotItem]
}

private struct SnapshotItem: Decodable {
  let id: String
  let title: String
  let deepLink: String
  let imageURL: String?
  let progress: Double?
}

final class ContentProvider: TVTopShelfContentProvider {
  override func loadTopShelfContent(
    completionHandler: @escaping (TVTopShelfContent?) -> Void
  ) {
    guard
      let payload = UserDefaults(suiteName: appGroup)?.data(forKey: payloadKey),
      let snapshot = try? JSONDecoder().decode(Snapshot.self, from: payload),
      snapshot.version == 1
    else {
      completionHandler(nil)
      return
    }

    let items = snapshot.items.prefix(12).compactMap { source -> TVTopShelfSectionedItem? in
      guard
        !source.id.isEmpty,
        !source.title.isEmpty,
        let deepLink = URL(string: source.deepLink),
        let imageValue = source.imageURL,
        let imageURL = URL(string: imageValue)
      else { return nil }

      let item = TVTopShelfSectionedItem(identifier: "portico.media.\(source.id)")
      item.title = source.title
      item.imageShape = .poster
      item.setImageURL(imageURL, for: [.screenScale1x, .screenScale2x])
      item.displayAction = TVTopShelfAction(url: deepLink)
      item.playAction = TVTopShelfAction(
        url: URL(string: "portico://play/\(source.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? source.id)")!
      )
      if let progress = source.progress {
        item.playbackProgress = min(1, max(0, progress))
      }
      return item
    }

    guard !items.isEmpty else {
      completionHandler(nil)
      return
    }
    let section = TVTopShelfItemCollection(items: items)
    section.title = "Continue Watching"
    completionHandler(TVTopShelfSectionedContent(sections: [section]))
  }
}
