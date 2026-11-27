# CHINE

**CHINE 0.1.0 — Chrome HTTP Is Not Emulated** is a lightweight, Firefox-only HTTPS-first browser extension built with Vanilla JavaScript and Manifest V2.

The interface follows Firefox's UI language: Korean (`ko`, including variants such as `ko-KR`) or English (the default).

## Features

- Redirects eligible top-level HTTP navigations to HTTPS.
- Skips localhost, single-label hosts, `.local` names, and common private or loopback IP ranges.
- Keeps short-lived upgrade failure records locally and never treats a record as approval to downgrade.
- Offers an explicit **Open HTTP…** action for a recorded URL. Optional Firefox containers can isolate that tab's cookies and site data.
- Optionally adds an `upgrade-insecure-requests` CSP policy to HTTPS responses. This does not fix or prevent every form of mixed content.
- No external libraries, remote services, or telemetry.
- Persistent local statistics can be reset from the General tab.

## Security and privacy

CHINE attempts HTTPS for eligible HTTP page navigations. When the HTTPS navigation errors, CHINE records the browser-reported error where available; network errors do not always identify whether the cause was TLS, a server outage, DNS, or something else. It does not automatically retry over HTTP. You can choose **Open HTTP…** from a failure record.

Upgrade failure records, settings, statistics, and the memo are stored in Firefox `browser.storage.local` and are not transmitted. This storage persists across browser restarts. Failure records expire after 30 days; statistics remain until you use **Reset Stats**. Temporary containers separate cookies and site data; they are not a complete security sandbox. The optional mixed content policy is best-effort and does not guarantee that all mixed content is eliminated.

## Install in Firefox

1. Download or clone this repository.
2. Open `about:debugging` in Firefox and choose **This Firefox**.
3. Select **Load Temporary Add-on…** and choose `manifest.json`.

This loads the extension temporarily for development. Firefox may require additional signing steps to distribute a permanent release.

## Permissions

The extension requests `webRequest` and `webRequestBlocking` to upgrade requests and add the optional response policy, `storage` for local settings and records, and `tabs` to open user-requested HTTP fallbacks. `<all_urls>` is needed to observe eligible navigations. `contextualIdentities` and `cookies` are included in the standard permissions because Firefox requires both to create a tab with a container `cookieStoreId`. Container Tabs must also be enabled in Firefox; CHINE reports when the contextual identities API is unavailable or container creation fails.

## License

MIT. See [LICENSE](./LICENSE).
