# Portico React Native Clients

> Portico Media Server is the heart of the project. Start with the [primary `portico-server` repository](https://github.com/PorticoMediaServer/portico-server) or visit [getportico.tv](https://getportico.tv).

This repository contains Portico's shared React Native application and native projects for mobile and television platforms. The clients connect to a Portico Media Server and are currently prerelease software.

## Technology

| Area | Technology |
| --- | --- |
| Application | React Native and TypeScript |
| Apple platforms | Swift, Objective-C, CocoaPods |
| Android platforms | Kotlin, Java, Gradle |
| Playback | Native platform players with shared Portico policy |
| Testing | Jest and native build validation |
| Automation | GitHub Actions |

## Working with the source

The clients consume the separately versioned
[`@porticomediaserver/client-core`](https://github.com/PorticoMediaServer/portico-server/releases/tag/client-core-v0.1.0)
package from an immutable Portico Server GitHub prerelease. The exact artifact
URL and integrity hash are locked in this repository, so a server checkout is
not required to build or test the clients.

Install and validate the JavaScript source:

```sh
npm ci
npm run typecheck
npm test
```

Native builds require the matching Apple or Android development tools. Store-ready packages are not being published yet.

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
