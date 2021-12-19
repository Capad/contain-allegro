/* global psl */

const ALLEGRO_CONTAINER_DETAILS = {
  name: "Allegro",
  color: "toolbar",
  icon: "fence"
};

// "facebook.com", "www.facebook.com", "facebook.net", "fb.com",
//   "fbcdn.net", "fbcdn.com", "fbsbx.com", "tfbnw.net",
//   "facebook-web-clients.appspot.com", "fbcdn-profile-a.akamaihd.net", "fbsbx.com.online-metrix.net", "connect.facebook.net.edgekey.net", "facebookrecruiting.com",

//   "instagram.com",
//   "cdninstagram.com", "instagramstatic-a.akamaihd.net", "instagramstatic-a.akamaihd.net.edgesuite.net",
const ALLEGRO_DOMAINS = [
  "allegro.pl", "ceneo.pl"
];

const DEFAULT_SETTINGS = {
  hideRelayEmailBadges: false,
};

const MAC_ADDON_ID = "@testpilot-containers";
const RELAY_ADDON_ID = "private-relay@firefox.com";

let macAddonEnabled = false;
let relayAddonEnabled = false;
let allegroCookieStoreId = null;

// TODO: refactor canceledRequests and tabsWaitingToLoad into tabStates
const canceledRequests = {};
const tabsWaitingToLoad = {};
const tabStates = {};

const allegroHostREs = [];

async function updateSettings(data){
  await browser.storage.local.set({
    "settings": data
  });
}

async function checkSettings(setting){
  let gacStorage = await browser.storage.local.get();

  if (setting) {
    return gacStorage.settings[setting];
  }

  if (gacStorage.settings) {
    return gacStorage.settings;
  }

  await browser.storage.local.set({
    "settings": DEFAULT_SETTINGS
  });

}


async function isRelayAddonEnabled () {
  try {
    const relayAddonInfo = await browser.management.get(RELAY_ADDON_ID);
    if (relayAddonInfo.enabled) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function isMACAddonEnabled () {
  try {
    const macAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (macAddonInfo.enabled) {
      sendJailedDomainsToMAC();
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function setupMACAddonListeners () {
  browser.runtime.onMessageExternal.addListener((message, sender) => {
    if (sender.id !== "@testpilot-containers") {
      return;
    }
    switch (message.method) {
    case "MACListening":
      sendJailedDomainsToMAC();
      break;
    }
  });
  function disabledExtension (info) {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = false;
    }
    if (info.id === RELAY_ADDON_ID) {
      relayAddonEnabled = false;
    }
  }
  function enabledExtension (info) {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = true;
    }
    if (info.id === RELAY_ADDON_ID) {
      relayAddonEnabled = true;
    }
  }
  browser.management.onInstalled.addListener(enabledExtension);
  browser.management.onEnabled.addListener(enabledExtension);
  browser.management.onUninstalled.addListener(disabledExtension);
  browser.management.onDisabled.addListener(disabledExtension);
}

async function sendJailedDomainsToMAC () {
  try {
    return await browser.runtime.sendMessage(MAC_ADDON_ID, {
      method: "jailedDomains",
      urls: ALLEGRO_DOMAINS.map((domain) => {
        return `https://${domain}/`;
      })
    });
  } catch (e) {
    // We likely might want to handle this case: https://github.com/mozilla/contain-facebook/issues/113#issuecomment-380444165
    return false;
  }
}

async function getMACAssignment (url) {
  if (!macAddonEnabled) {
    return false;
  }

  try {
    const assignment = await browser.runtime.sendMessage(MAC_ADDON_ID, {
      method: "getAssignment",
      url
    });
    return assignment;
  } catch (e) {
    return false;
  }
}

function cancelRequest (tab, options) {
  // we decided to cancel the request at this point, register canceled request
  canceledRequests[tab.id] = {
    requestIds: {
      [options.requestId]: true
    },
    urls: {
      [options.url]: true
    }
  };

  // since webRequest onCompleted and onErrorOccurred are not 100% reliable
  // we register a timer here to cleanup canceled requests, just to make sure we don't
  // end up in a situation where certain urls in a tab.id stay canceled
  setTimeout(() => {
    if (canceledRequests[tab.id]) {
      delete canceledRequests[tab.id];
    }
  }, 2000);
}

function shouldCancelEarly (tab, options) {
  // we decided to cancel the request at this point
  if (!canceledRequests[tab.id]) {
    cancelRequest(tab, options);
  } else {
    let cancelEarly = false;
    if (canceledRequests[tab.id].requestIds[options.requestId] ||
        canceledRequests[tab.id].urls[options.url]) {
      // same requestId or url from the same tab
      // this is a redirect that we have to cancel early to prevent opening two tabs
      cancelEarly = true;
    }
    // register this requestId and url as canceled too
    canceledRequests[tab.id].requestIds[options.requestId] = true;
    canceledRequests[tab.id].urls[options.url] = true;
    if (cancelEarly) {
      return true;
    }
  }
  return false;
}

function generateAllegroHostREs () {
  for (let allegroDomain of ALLEGRO_DOMAINS) {
    allegroHostREs.push(new RegExp(`^(.*\\.)?${allegroDomain}$`));
  }
}

async function clearAllegroCookies () {
  // Clear all allegro cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: "firefox-default"
  });

  let macAssignments = [];
  if (macAddonEnabled) {
    const promises = ALLEGRO_DOMAINS.map(async allegroDomain => {
      const assigned = await getMACAssignment(`https://${allegroDomain}/`);
      return assigned ? allegroDomain : null;
    });
    macAssignments = await Promise.all(promises);
  }

  ALLEGRO_DOMAINS.map(async allegroDomain => {
    const allegroCookieUrl = `https://${allegroDomain}/`;

    // dont clear cookies for allegroDomain if mac assigned (with or without www.)
    if (macAddonEnabled &&
      (macAssignments.includes(allegroDomain) ||
      macAssignments.includes(`www.${allegroDomain}`))) {
      return;
    }

    containers.map(async container => {
      const storeId = container.cookieStoreId;
      if (storeId === allegroCookieStoreId) {
        // Don't clear cookies in the Allegro Container
        return;
      }

      const cookies = await browser.cookies.getAll({
        domain: allegroDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: allegroCookieUrl,
          storeId
        });
      });
      // Also clear Service Workers as it breaks detecting onBeforeRequest
      await browser.browsingData.remove({ hostnames: [allegroDomain]}, {serviceWorkers: true});
    });
  });
}

async function setupContainer () {
  // Use existing Allegro container, or create one

  const info = await browser.runtime.getBrowserInfo();
  if (parseInt(info.version) < 67) {
    ALLEGRO_CONTAINER_DETAILS.color = "blue";
    ALLEGRO_CONTAINER_DETAILS.icon = "briefcase";
  }

  const contexts = await browser.contextualIdentities.query({name: ALLEGRO_CONTAINER_DETAILS.name});
  if (contexts.length > 0) {
    const allegroContext = contexts[0];
    allegroCookieStoreId = allegroContext.cookieStoreId;
    // Make existing Allegro container the "fence" icon if needed
    if (allegroContext.color !== ALLEGRO_CONTAINER_DETAILS.color ||
        allegroContext.icon !== ALLEGRO_CONTAINER_DETAILS.icon
    ) {
      await browser.contextualIdentities.update(
        allegroCookieStoreId,
        { color: ALLEGRO_CONTAINER_DETAILS.color, icon: ALLEGRO_CONTAINER_DETAILS.icon }
      );
    }
  } else {
    const context = await browser.contextualIdentities.create(ALLEGRO_CONTAINER_DETAILS);
    allegroCookieStoreId = context.cookieStoreId;
  }
  // Initialize domainsAddedToAllegroContainer if needed
  const gacStorage = await browser.storage.local.get();
  if (!gacStorage.domainsAddedToAllegroContainer) {
    await browser.storage.local.set({"domainsAddedToAllegroContainer": []});
  }
}

async function maybeReopenTab (url, tab, request) {
  const macAssigned = await getMACAssignment(url);
  if (macAssigned) {
    // We don't reopen MAC assigned urls
    return;
  }
  const cookieStoreId = await shouldContainInto(url, tab);
  if (!cookieStoreId) {
    // Tab doesn't need to be contained
    return;
  }

  if (request && shouldCancelEarly(tab, request)) {
    // We need to cancel early to prevent multiple reopenings
    return {cancel: true};
  }

  await browser.tabs.create({
    url,
    cookieStoreId,
    active: tab.active,
    index: tab.index,
    windowId: tab.windowId
  });
  browser.tabs.remove(tab.id);

  return {cancel: true};
}

const rootDomainCache = {};

function getRootDomain(url) {
  if (url in rootDomainCache) {
    // After storing 128 entries, it will delete the oldest each time.
    const returnValue = rootDomainCache[url];
    if (Object.keys(rootDomainCache).length > 128) {
      delete rootDomainCache[(Object.keys(rootDomainCache)[0])];
    }
    return returnValue;
  }

  const urlObject = new URL(url);
  if (urlObject.hostname === "") { return false; }
  const parsedUrl = psl.parse(urlObject.hostname);

  rootDomainCache[url] = parsedUrl.domain;
  return parsedUrl.domain;

}

function topFrameUrlIsAllegroApps(frameAncestorsArray) {
  if (!frameAncestorsArray || frameAncestorsArray.length === 0) {
    // No frame ancestor return false
    return false;
  }

  const appsAllegroURL = "https://apps.allegro.pl";
  const frameAncestorsURL = frameAncestorsArray[0].url;

  if (!frameAncestorsURL.startsWith(appsAllegroURL)) {
    // Only allow frame ancestors that originate from apps.allegro.pl
    return false;
  }

  return frameAncestorsURL;
}

function isAllegroURL (url) {
  const parsedUrl = new URL(url);
  for (let allegroHostRE of allegroHostREs) {
    if (allegroHostRE.test(parsedUrl.host)) {
      return true;
    }
  }
  return false;
}

// TODO: refactor parsedUrl "up" so new URL doesn't have to be called so much
// TODO: refactor gacStorage "up" so browser.storage.local.get doesn't have to be called so much
async function addDomainToAllegroContainer (url) {
  const gacStorage = await browser.storage.local.get();
  const rootDomain = getRootDomain(url);
  gacStorage.domainsAddedToAllegroContainer.push(rootDomain);
  await browser.storage.local.set({ "domainsAddedToAllegroContainer": gacStorage.domainsAddedToAllegroContainer});
}

async function removeDomainFromAllegroContainer (domain) {
  const gacStorage = await browser.storage.local.get();
  const domainIndex = gacStorage.domainsAddedToAllegroContainer.indexOf(domain);
  gacStorage.domainsAddedToAllegroContainer.splice(domainIndex, 1);
  await browser.storage.local.set({ "domainsAddedToAllegroContainer": gacStorage.domainsAddedToAllegroContainer});
}

async function isAddedToAllegroContainer (url) {
  const gacStorage = await browser.storage.local.get();
  const rootDomain = getRootDomain(url);
  if (gacStorage.domainsAddedToAllegroContainer.includes(rootDomain)) {
    return true;
  }
  return false;
}

async function shouldContainInto (url, tab) {
  if (!url.startsWith("http")) {
    // we only handle URLs starting with http(s)
    return false;
  }

  const hasBeenAddedToAllegroContainer = await isAddedToAllegroContainer(url);

  if (isAllegroURL(url) || hasBeenAddedToAllegroContainer) {
    if (tab.cookieStoreId !== allegroCookieStoreId) {
      // Allegro-URL outside of Allegro Container Tab
      // Should contain into Allegro Container
      return allegroCookieStoreId;
    }
  } else if (tab.cookieStoreId === allegroCookieStoreId) {
    // Non-Allegro-URL inside Allegro Container Tab
    // Should contain into Default Container
    return "firefox-default";
  }

  return false;
}

async function maybeReopenAlreadyOpenTabs () {
  const tabsOnUpdated = (tabId, changeInfo, tab) => {
    if (changeInfo.url && tabsWaitingToLoad[tabId]) {
      // Tab we're waiting for switched it's url, maybe we reopen
      delete tabsWaitingToLoad[tabId];
      maybeReopenTab(tab.url, tab);
    }
    if (tab.status === "complete" && tabsWaitingToLoad[tabId]) {
      // Tab we're waiting for completed loading
      delete tabsWaitingToLoad[tabId];
    }
    if (!Object.keys(tabsWaitingToLoad).length) {
      // We're done waiting for tabs to load, remove event listener
      browser.tabs.onUpdated.removeListener(tabsOnUpdated);
    }
  };

  // Query for already open Tabs
  const tabs = await browser.tabs.query({});
  tabs.map(async tab => {
    if (tab.url === "about:blank") {
      if (tab.status !== "loading") {
        return;
      }
      // about:blank Tab is still loading, so we indicate that we wait for it to load
      // and register the event listener if we haven't yet.
      //
      // This is a workaround until platform support is implemented:
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1447551
      // https://github.com/mozilla/multi-account-containers/issues/474
      tabsWaitingToLoad[tab.id] = true;
      if (!browser.tabs.onUpdated.hasListener(tabsOnUpdated)) {
        browser.tabs.onUpdated.addListener(tabsOnUpdated);
      }
    } else {
      // Tab already has an url, maybe we reopen
      maybeReopenTab(tab.url, tab);
    }
  });
}

function stripFbclid(url) {
  const strippedUrl = new URL(url);
  strippedUrl.searchParams.delete("fbclid");
  return strippedUrl.href;
}

async function getActiveTab () {
  const [activeTab] = await browser.tabs.query({currentWindow: true, active: true});
  return activeTab;
}

async function windowFocusChangedListener (windowId) {
  if (windowId !== browser.windows.WINDOW_ID_NONE) {
    const activeTab = await getActiveTab();
    updateBrowserActionIcon(activeTab);
  }
}

function tabUpdateListener (tabId, changeInfo, tab) {
  updateBrowserActionIcon(tab);
}

async function updateBrowserActionIcon (tab) {

  browser.browserAction.setBadgeText({text: ""});

  const url = tab.url;
  const hasBeenAddedToAllegroContainer = await isAddedToAllegroContainer(url);
  const aboutPageURLCheck = url.startsWith("about:");

  if (isAllegroURL(url)) {
    // TODO: change panel logic from browser.storage to browser.runtime.onMessage
    // so the panel.js can "ask" background.js which panel it should show
    browser.storage.local.set({"CURRENT_PANEL": "on-allegro"});
    browser.browserAction.setPopup({tabId: tab.id, popup: "./panel.html"});
  } else if (hasBeenAddedToAllegroContainer) {
    browser.storage.local.set({"CURRENT_PANEL": "in-fbc"});
  } else if (aboutPageURLCheck) {
    // Sets CURRENT_PANEL if current URL is an internal about: page
    browser.storage.local.set({"CURRENT_PANEL": "about"});
  } else {
    const tabState = tabStates[tab.id];
    const panelToShow = (tabState && tabState.trackersDetected) ? "trackers-detected" : "no-trackers";
    browser.storage.local.set({"CURRENT_PANEL": panelToShow});
    browser.browserAction.setPopup({tabId: tab.id, popup: "./panel.html"});
    browser.browserAction.setBadgeBackgroundColor({color: "#6200A4"});
    if ( panelToShow === "trackers-detected" ) {
      browser.browserAction.setBadgeText({text: "!"});
    }
  }
}

async function containAllegro (request) {
  if (tabsWaitingToLoad[request.tabId]) {
    // Cleanup just to make sure we don't get a race-condition with startup reopening
    delete tabsWaitingToLoad[request.tabId];
  }

  // Listen to requests and open Allegro into its Container,
  // open other sites into the default tab context
  if (request.tabId === -1) {
    // Request doesn't belong to a tab
    return;
  }

  const tab = await browser.tabs.get(request.tabId);
  updateBrowserActionIcon(tab);

  const url = new URL(request.url);
  const urlSearchParm = new URLSearchParams(url.search);
  if (urlSearchParm.has("fbclid")) {
    return {redirectUrl: stripFbclid(request.url)};
  }

  return maybeReopenTab(request.url, tab, request);
}

// Lots of this is borrowed from old blok code:
// https://github.com/mozilla/blok/blob/master/src/js/background.js
async function blockAllegroSubResources (requestDetails) {
  if (requestDetails.type === "main_frame") {
    tabStates[requestDetails.tabId] = { trackersDetected: false };
    return {};
  }

  if (typeof requestDetails.originUrl === "undefined") {
    return {};
  }

  const urlIsAllegro = isAllegroURL(requestDetails.url);
  // If this request isn't going to Allegro, let's return {} ASAP
  if (!urlIsAllegro) {
    return {};
  }

  const originUrlIsAllegro = isAllegroURL(requestDetails.originUrl);

  if (originUrlIsAllegro) {
    const message = {msg: "allegro-domain"};
    // Send the message to the content_script
    browser.tabs.sendMessage(requestDetails.tabId, message);
    return {};
  }

  const frameAncestorUrlIsAllegroApps = topFrameUrlIsAllegroApps(requestDetails.frameAncestors);

  if (frameAncestorUrlIsAllegroApps) {
    const message = {msg: "allegro-domain"};
    // Send the message to the content_script
    browser.tabs.sendMessage(requestDetails.tabId, message);
    return {};
  }

  const hasBeenAddedToAllegroContainer = await isAddedToAllegroContainer(requestDetails.originUrl);

  if ( urlIsAllegro && !originUrlIsAllegro ) {
    if (!hasBeenAddedToAllegroContainer ) {
      const message = {msg: "blocked-allegro-subresources"};
      // Send the message to the content_script
      browser.tabs.sendMessage(requestDetails.tabId, message);

      tabStates[requestDetails.tabId] = { trackersDetected: true };
      return {cancel: true};
    } else {
      const message = {msg: "allowed-allegro-subresources"};
      // Send the message to the content_script
      browser.tabs.sendMessage(requestDetails.tabId, message);
      return {};
    }
  }
  return {};
}

function setupWebRequestListeners() {
  browser.webRequest.onCompleted.addListener((options) => {
    if (canceledRequests[options.tabId]) {
      delete canceledRequests[options.tabId];
    }
  },{urls: ["<all_urls>"], types: ["main_frame"]});
  browser.webRequest.onErrorOccurred.addListener((options) => {
    if (canceledRequests[options.tabId]) {
      delete canceledRequests[options.tabId];
    }
  },{urls: ["<all_urls>"], types: ["main_frame"]});

  // Add the main_frame request listener
  browser.webRequest.onBeforeRequest.addListener(containAllegro, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

  // Add the sub-resource request listener
  browser.webRequest.onBeforeRequest.addListener(blockAllegroSubResources, {urls: ["<all_urls>"]}, ["blocking"]);
}

function setupWindowsAndTabsListeners() {
  browser.tabs.onUpdated.addListener(tabUpdateListener);
  browser.tabs.onRemoved.addListener(tabId => delete tabStates[tabId] );
  browser.windows.onFocusChanged.addListener(windowFocusChangedListener);
}

async function checkIfTrackersAreDetected(sender) {
  const activeTab = await getActiveTab();
  const tabState = tabStates[activeTab.id];
  const trackersDetected = (tabState && tabState.trackersDetected);
  const onActiveTab = (activeTab.id === sender.tab.id);
  // Check if trackers were blocked,scoped to the active tab.
  return (onActiveTab && trackersDetected);  
}

(async function init () {
  await setupMACAddonListeners();
  macAddonEnabled = await isMACAddonEnabled();
  relayAddonEnabled = await isRelayAddonEnabled();

  try {
    await setupContainer();
  } catch (error) {
    // TODO: Needs backup strategy
    // See https://github.com/mozilla/contain-facebook/issues/23
    // Sometimes this add-on is installed but doesn't get a facebookCookieStoreId ?
    // eslint-disable-next-line no-console
    console.error(error);
    return;
  }
  clearAllegroCookies();
  generateAllegroHostREs();
  setupWebRequestListeners();
  setupWindowsAndTabsListeners();

  async function messageHandler(request, sender) {
    switch (request.message) {
    case "what-sites-are-added":
        return browser.storage.local.get().then(gacStorage => gacStorage.domainsAddedToAllegroContainer);
    case "remove-domain-from-list":
      removeDomainFromAllegroContainer(request.removeDomain).then( results => results );
      break;
    case "add-domain-to-list":
      addDomainToAllegroContainer(sender.url).then( results => results);
      break;
    case "get-root-domain":
      return getRootDomain(request.url);
    case "get-relay-enabled":
      return relayAddonEnabled;
    case "update-settings":
      updateSettings(request.settings);
      break;
    case "check-settings":
      return checkSettings();
    case "are-trackers-detected":
      return await checkIfTrackersAreDetected(sender);
    default:
      throw new Error("Unexpected message!");
    }
  }

  browser.runtime.onMessage.addListener(messageHandler);

  maybeReopenAlreadyOpenTabs();

  const activeTab = await getActiveTab();
  updateBrowserActionIcon(activeTab);
})();
