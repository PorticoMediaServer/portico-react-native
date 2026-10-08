<div align="center">
  <a href="https://getportico.tv">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/PorticoMediaServer/getportico-tv/main/public/brand/portico-wordmark-white.svg">
      <img src="https://raw.githubusercontent.com/PorticoMediaServer/getportico-tv/main/public/brand/portico-wordmark-black.svg" alt="Portico" width="420">
    </picture>
  </a>

  <h1>Portico React Native Clients</h1>

  <p><strong>Shared Portico applications for mobile and television platforms.</strong></p>

  <p>
    <a href="https://github.com/PorticoMediaServer/portico-server">Portico Media Server</a> ·
    <a href="https://getportico.tv">Website</a> ·
    <a href="https://github.com/PorticoMediaServer/portico-react-native/issues">Report an issue</a>
  </p>

  <p>
    <a href="LICENSE"><img alt="GPL-3.0-or-later" src="https://img.shields.io/badge/license-GPL--3.0--or--later-59636e?style=flat-square"></a>
    <img alt="Prerelease software" src="https://img.shields.io/badge/status-prerelease-e09f3e?style=flat-square">
  </p>
</div>

---

> Portico Media Server is the heart of the project. Start with the [primary `portico-server` repository](https://github.com/PorticoMediaServer/portico-server) or visit [getportico.tv](https://getportico.tv).

This repository contains Portico's shared React Native application and native projects for mobile and television platforms: iPhone, iPad, Apple TV, Android phones and tablets, Android TV, and Fire TV. The clients connect to a Portico Media Server and are currently prerelease software.

## Technology

| Area | Technology |
| --- | --- |
| Application | React Native (react-native-tvos) and TypeScript |
| Apple platforms | Swift, Objective-C, CocoaPods |
| Android platforms | Kotlin, Java, Gradle, Media3 |
| Fire TV on Vega OS | The Vega SDK, sharing the same screens |
| Playback | Native platform players with shared Portico policy |
| Testing | Node's test runner and native build validation |
| Automation | GitHub Actions |

| Path | Contents |
| --- | --- |
| `apps/native` | iPhone, iPad, Apple TV, Android, Android TV, and Fire OS (the `firetv` Android flavor) |
| `apps/vega` | Fire TV on Vega OS |
| `packages` | A copy of the shared client packages from [`portico-server`](https://github.com/PorticoMediaServer/portico-server) |

The Android, Android TV, Fire TV, and Vega OS ports are new and have not yet been validated on devices.

## Working with the source

The clients use Portico's shared client packages (`client-core`, `design`, and
`i18n`). Their source of truth is `portico-server`; this repository keeps an
identical copy so it builds on its own. Never edit the copy here: change the
package in `portico-server`, then refresh the copy from a sibling checkout:

```sh
node scripts/shared-packages.mjs --check   # fails if the copy differs
node scripts/shared-packages.mjs --write   # replaces the copy
```

Install and validate the JavaScript source:

```sh
cd apps/native
npm ci --legacy-peer-deps
npm run typecheck
npm test
```

Native builds require the matching Apple or Android development tools. Store-ready packages are not being published yet.

## Apple builds

Install the CocoaPods dependencies once per checkout (`pod install` in
`apps/native/ios` and `apps/native/tvos`), then build the `Portico` scheme of
`ios/Portico.xcworkspace` (iPhone and iPad) or `tvos/Portico.xcworkspace`
(Apple TV) with Xcode. Installed validation builds should use the `Release`
configuration with signing enabled; an unsigned build cannot access Portico's
Keychain-backed authentication state. Debug or Metro-backed builds are
reserved for an active debugger session. Verify every resulting app before
installation:

```sh
codesign --verify --deep --strict --verbose=2 <Portico.app>
codesign -d --entitlements :- <Portico.app>
```

## Android builds

`apps/native/android` builds one application, `tv.getportico.portico`, for
phones, tablets, and Android TV. The `firetv` flavor builds the same app for
Fire OS without Google services. Use Android Studio or Gradle from that folder.

## Feedback and contributions

Bug reports and product feedback are welcome through [GitHub Issues](https://github.com/PorticoMediaServer/portico-react-native/issues). Portico does not accept external code contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License and trademarks

This repository is licensed under `GPL-3.0-or-later`. See [LICENSE](LICENSE). The license does not permit unofficial builds to be represented as official Portico releases; see [TRADEMARKS.md](TRADEMARKS.md).

---

Made with ❤️ in Nova Scotia, Canada | Developed by [Justin Ehler](https://ehler.ca)  
Copyright © 2026 Justin Ehler  
Portico Media Server is free software licensed under the GNU General  
Public License, version 3 or, at your option, any later version.
