const $ = id => document.getElementById(id);
const uiLanguage = browser.i18n.getUILanguage().toLowerCase().startsWith("ko") ? "ko" : "en";
document.documentElement.lang = uiLanguage;

function message(key, substitutions) {
  return browser.i18n.getMessage(key, substitutions) || key;
}

function localizeMarkup() {
  document.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = message(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(element => {
    element.setAttribute("aria-label", message(element.dataset.i18nAria));
  });
}

localizeMarkup();

async function load() {
  const data = await browser.runtime.sendMessage({ type: "get-state" });
  $("forceHttps").checked = data.settings.forceHttps;
  $("tempContainer").checked = data.settings.tempContainer;
  $("mixedContent").checked = data.settings.mixedContent;
  $("memo").value = data.memo || "";
  $("attempts").textContent = data.stats.attempts;
  $("successes").textContent = data.stats.successes;
  $("failuresCount").textContent = data.stats.failures;
  $("containers").textContent = data.stats.containers;
  $("localPolicy").textContent = data.localPolicy;

  const list = $("failureList");
  list.replaceChildren();
  if (!data.failures.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = message("noFailureRecords");
    list.append(empty);
  }
  for (const row of data.failures) {
    const item = document.createElement("li");
    item.className = "failure-row";
    const host = document.createElement("span");
    host.className = "failure-host";
    host.textContent = row.host;
    const detail = document.createElement("small");
    detail.className = "failure-detail";
    const expiry = new Date(row.time + data.ttlDays * 86400000).toLocaleDateString(uiLanguage === "ko" ? "ko-KR" : "en-US");
    detail.textContent = message("expiresOn", [row.type, expiry]);
    const action = document.createElement("button");
    action.className = "fallback-button";
    action.textContent = message("fallbackButton");
    action.title = message("fallbackButton");
    action.type = "button";
    action.addEventListener("click", async () => {
      if (!confirm(message("confirmHttpFallback", row.host))) return;
      try {
        const result = await browser.runtime.sendMessage({ type: "http-fallback", url: row.url });
        if (result && result.error) alert(result.error);
        else if (result && result.container) {
          console.info(`HTTP fallback opened in Firefox container: ${result.containerName} (${result.containerColor}).`);
        }
      } catch (_) {
        alert(message("fallbackOpenFailed"));
      }
    });
    item.append(host, detail, action);
    list.append(item);
  }
}

async function save() {
  await browser.runtime.sendMessage({ type: "save-settings", settings: {
    forceHttps: $("forceHttps").checked,
    tempContainer: $("tempContainer").checked,
    mixedContent: $("mixedContent").checked
  }, memo: $("memo").value });
}

function displayStats(stats) {
  $("attempts").textContent = stats.attempts;
  $("successes").textContent = stats.successes;
  $("failuresCount").textContent = stats.failures;
  $("containers").textContent = stats.containers;
}

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab, .page").forEach(node => node.classList.remove("active"));
  tab.classList.add("active");
  $(tab.dataset.page).classList.add("active");
}));
$("apply").addEventListener("click", save);
$("ok").addEventListener("click", async () => { await save(); window.close(); });
$("cancel").addEventListener("click", () => window.close());
$("clearList").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "clear-failures" });
  await load();
});
$("resetStats").addEventListener("click", async () => {
  try {
    const result = await browser.runtime.sendMessage({ type: "reset-stats" });
    displayStats(result.stats);
    $("status").textContent = message("statsResetDone");
  } catch (error) {
    $("status").textContent = message("loadError", error.message);
  }
});
load().catch(error => { document.body.append(message("loadError", error.message)); });
