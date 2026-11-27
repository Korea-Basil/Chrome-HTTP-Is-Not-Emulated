/* CHINE 0.1.0 — all state stays in browser.storage.local. */
const DEFAULTS = {
  settings: { forceHttps: true, tempContainer: false, mixedContent: false },
  stats: { attempts: 0, successes: 0, failures: 0, containers: 0 },
  failures: [], memo: ""
};
const FAILURE_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 200;
const attemptsByTab = new Map();
const pendingByTab = new Map();
const spawnedTabs = new Map();
// Grants exactly one matching HTTP main-frame navigation in a tab created by the user action.
const approvedHttpNavigations = new Map();

function translate(key, substitutions) {
  return browser.i18n.getMessage(key, substitutions) || key;
}

async function state() {
  return browser.storage.local.get(DEFAULTS);
}
async function mutate(key, update) {
  const data = await browser.storage.local.get({ [key]: DEFAULTS[key] });
  const value = update(data[key]);
  await browser.storage.local.set({ [key]: value });
  return value;
}
function localHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || !h.includes(".")) return true;
  if (h.includes(":")) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || /^fe[89ab]/i.test(h);
  const parts = h.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
}
function failureType(error) {
  const e = (error || "").toLowerCase();
  if (e.includes("cert") || e.includes("ssl") || e.includes("tls")) return translate("tlsFailure");
  if (e.includes("timeout")) return translate("timeoutFailure");
  if (e.includes("dns") || e.includes("resolve")) return translate("dnsFailure");
  return translate("navigationFailure");
}
async function recordFailure(url, error) {
  let parsed;
  try { parsed = new URL(url); } catch (_) { return; }
  const now = Date.now();
  await mutate("failures", rows => {
    const kept = rows.filter(row => now - row.time < FAILURE_TTL && row.host !== parsed.hostname);
    kept.unshift({ host: parsed.hostname, url: parsed.href, time: now, type: failureType(error) });
    return kept.slice(0, MAX_FAILURES);
  });
  await mutate("stats", s => ({ ...s, failures: s.failures + 1 }));
}

browser.webRequest.onBeforeRequest.addListener(async details => {
  if (details.type !== "main_frame" || !details.url.startsWith("http://")) return {};
  const approvedUrl = approvedHttpNavigations.get(details.tabId);
  if (approvedUrl) {
    let matches = false;
    try { matches = new URL(details.url).href === approvedUrl; } catch (_) {}
    if (matches) {
      approvedHttpNavigations.delete(details.tabId);
      return {};
    }
    // A tab cannot use the grant for a different HTTP destination.
    approvedHttpNavigations.delete(details.tabId);
  }
  const { settings } = await state();
  if (!settings.forceHttps) return {};
  let url;
  try { url = new URL(details.url); } catch (_) { return {}; }
  if (localHost(url.hostname)) return {};
  const count = attemptsByTab.get(details.tabId) || 0;
  if (count >= 3) return {};
  attemptsByTab.set(details.tabId, count + 1);
  url.protocol = "https:";
  pendingByTab.set(details.tabId, { url: url.href, original: details.url, at: Date.now() });
  await mutate("stats", s => ({ ...s, attempts: s.attempts + 1 }));
  return { redirectUrl: url.href };
}, { urls: ["http://*/*"] }, ["blocking"]);

browser.webNavigation.onCompleted.addListener(async details => {
  if (details.frameId !== 0) return;
  const pending = pendingByTab.get(details.tabId);
  if (pending && details.url === pending.url) {
    pendingByTab.delete(details.tabId);
    attemptsByTab.delete(details.tabId);
    await mutate("stats", s => ({ ...s, successes: s.successes + 1 }));
  }
});
browser.webNavigation.onErrorOccurred.addListener(async details => {
  if (details.frameId !== 0) return;
  const pending = pendingByTab.get(details.tabId);
  if (pending && details.url === pending.url) {
    pendingByTab.delete(details.tabId);
    await recordFailure(pending.url, details.error);
  }
});
browser.tabs.onRemoved.addListener(tabId => {
  attemptsByTab.delete(tabId);
  pendingByTab.delete(tabId);
  approvedHttpNavigations.delete(tabId);
  const identity = spawnedTabs.get(tabId);
  if (identity) {
    spawnedTabs.delete(tabId);
    browser.tabs.query({ cookieStoreId: identity }).then(tabs => {
      if (tabs.length === 0) return browser.contextualIdentities.remove(identity);
    }).catch(() => {});
  }
});

browser.webRequest.onHeadersReceived.addListener(async details => {
  if (details.type !== "main_frame" || !details.url.startsWith("https://")) return {};
  const { settings } = await state();
  if (!settings.mixedContent) return {};
  const headers = details.responseHeaders || [];
  // A separate policy is combined with site policies by Firefox. It does not cure every form of mixed content.
  headers.push({ name: "Content-Security-Policy", value: "upgrade-insecure-requests" });
  return { responseHeaders: headers };
}, { urls: ["https://*/*"] }, ["blocking", "responseHeaders"]);

browser.runtime.onMessage.addListener(async message => {
  if (message.type === "get-state") {
    const data = await state();
    const now = Date.now();
    data.failures = data.failures.filter(row => now - row.time < FAILURE_TTL);
    await browser.storage.local.set({ failures: data.failures });
    return { ...data, localPolicy: translate("localPolicy"), ttlDays: 30 };
  }
  if (message.type === "save-settings") {
    await browser.storage.local.set({ settings: message.settings, memo: message.memo || "" });
    return { ok: true };
  }
  if (message.type === "clear-failures") {
    await browser.storage.local.set({ failures: [] });
    return { ok: true };
  }
  if (message.type === "reset-stats") {
    const stats = { attempts: 0, successes: 0, failures: 0, containers: 0 };
    await browser.storage.local.set({ stats });
    return { ok: true, stats };
  }
  if (message.type === "http-fallback") {
    let url;
    try { url = new URL(message.url); url.protocol = "http:"; } catch (_) { return { error: translate("invalidUrl") }; }
    const { settings } = await state();
    if (settings.tempContainer) {
      let identity;
      if (!browser.contextualIdentities) {
        return { error: translate("containerApiUnavailable") };
      }
      try {
        identity = await browser.contextualIdentities.create({
          name: `CHINE Temp - ${url.hostname}`,
          color: "purple",
          icon: "circle"
        });
        if (!identity || !identity.cookieStoreId) {
          throw new Error("Firefox did not return a container cookie store.");
        }
        // Count an identity only after Firefox confirms that it created one.
        await mutate("stats", s => ({ ...s, containers: s.containers + 1 }));
        // Start at about:blank so the one-time HTTP grant exists before navigation begins.
        const tab = await browser.tabs.create({ url: "about:blank", cookieStoreId: identity.cookieStoreId });
        if (tab.cookieStoreId !== identity.cookieStoreId) {
          throw new Error("Firefox opened the tab in a different cookie store.");
        }
        spawnedTabs.set(tab.id, identity.cookieStoreId);
        approvedHttpNavigations.set(tab.id, url.href);
        await browser.tabs.update(tab.id, { url: url.href });
        return { ok: true, container: true, containerName: identity.name, containerColor: identity.color };
      } catch (error) {
        if (identity) {
          const tabIds = [...spawnedTabs.entries()].filter(([, id]) => id === identity.cookieStoreId).map(([id]) => id);
          for (const tabId of tabIds) {
            spawnedTabs.delete(tabId);
            approvedHttpNavigations.delete(tabId);
            try { await browser.tabs.remove(tabId); } catch (_) {}
          }
          try { await browser.contextualIdentities.remove(identity.cookieStoreId); } catch (_) {}
        }
        if (!identity) {
          return { error: translate("containerCreateFailed") };
        }
        return { error: translate("containerTabFailed") };
      }
    }
    try {
      const tab = await browser.tabs.create({ url: "about:blank" });
      approvedHttpNavigations.set(tab.id, url.href);
      await browser.tabs.update(tab.id, { url: url.href });
      return { ok: true, container: false };
    } catch (_) { return { error: translate("fallbackOpenFailed") }; }
  }
  return undefined;
});
