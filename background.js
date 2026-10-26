// Company name -> stock code lookup, tried in order:
//   1. KRX listed-company list (KIND), cached in chrome.storage.local and refreshed once it is a week old
//   2. Naver stock autocomplete API, for names missing from the cache (new listings, aliases)
//   3. Bundled stocks.json, as a last resort (only when USE_BUNDLED_FALLBACK is true)
const USE_BUNDLED_FALLBACK = true; // Set to false to check whether 1 or 2 resolved a lookup

const KRX_LIST_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download";
const NAVER_AC_URL = "https://ac.stock.naver.com/ac?target=stock&q=";
const KRX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
    // Remove menus left over from a previous version (e.g. the old "wiki" item) before recreating
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            "id": "parent",
            "title": "이 회사 어때",
            "contexts": ["selection"]
        });
        chrome.contextMenus.create({
            "id": "companyInfo",
            "parentId": "parent",
            "title": "회사정보",
            "contexts": ["selection"]
        });
        chrome.contextMenus.create({
            "id": "news",
            "parentId": "parent",
            "title": "관련뉴스",
            "contexts": ["selection"]
        });
    });
    refreshKrxList();
});

function normalize(name) {
    return name.replace(/\s+/g, '');
}

// Find a stock by name, ignoring whitespace on both sides
function findStock(stockList, text) {
    var key = normalize(text);
    return stockList.find(i => normalize(i.NAME) === key);
}

// Download the KRX list (an EUC-KR HTML table: 회사명, 시장구분, 종목코드, ...) and cache it as [{NAME, CODE}]
async function refreshKrxList() {
    try {
        const response = await fetch(KRX_LIST_URL);
        const html = new TextDecoder('euc-kr').decode(await response.arrayBuffer());
        const list = [];
        for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
            const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].trim());
            if (cells.length >= 3 && cells[0] && cells[2]) {
                list.push({ NAME: cells[0].replace(/&amp;/g, '&'), CODE: cells[2] });
            }
        }
        if (list.length === 0) {
            throw new Error('no rows parsed');
        }
        await chrome.storage.local.set({ krxList: list, krxUpdatedAt: Date.now() });
        console.log(`[KRX] cached ${list.length} companies`);
        return list;
    } catch (error) {
        console.error('[KRX] refresh failed:', error);
        return null;
    }
}

async function lookupKrxCache(text) {
    let { krxList, krxUpdatedAt } = await chrome.storage.local.get(['krxList', 'krxUpdatedAt']);
    if (!krxList) {
        // Cache not built yet (first run, or the install-time download failed): wait for it
        krxList = await refreshKrxList();
    } else if (Date.now() - (krxUpdatedAt || 0) > KRX_MAX_AGE_MS) {
        // Stale: answer from the current cache now and refresh in the background for next time
        refreshKrxList();
    }
    return krxList ? findStock(krxList, text) : undefined;
}

// Prefer an exact (whitespace-insensitive) name match; otherwise trust autocomplete's top hit
async function lookupNaver(text) {
    try {
        const response = await fetch(NAVER_AC_URL + encodeURIComponent(text));
        const items = ((await response.json()).items || []).filter(i => i.category === 'stock');
        const item = items.find(i => normalize(i.name) === normalize(text)) || items[0];
        return item ? { NAME: item.name, CODE: item.code } : undefined;
    } catch (error) {
        console.error('[Naver] lookup failed:', error);
        return undefined;
    }
}

async function lookupBundled(text) {
    const response = await fetch(chrome.runtime.getURL('stocks.json'));
    return findStock(await response.json(), text);
}

// Returns { stock, source } where source names the step that resolved it
async function resolveStock(text) {
    let stock = await lookupKrxCache(text);
    if (stock) return { stock, source: 'KRX cache' };
    stock = await lookupNaver(text);
    if (stock) return { stock, source: 'Naver autocomplete' };
    if (USE_BUNDLED_FALLBACK) {
        stock = await lookupBundled(text);
        if (stock) return { stock, source: 'stocks.json' };
    }
    return { stock: undefined, source: 'not found' };
}

chrome.contextMenus.onClicked.addListener(async function (info, tab) {
    var selectionText = info.selectionText.trim();
    var { stock, source } = await resolveStock(selectionText);
    console.log(`[lookup] "${selectionText}" -> ${stock ? `${stock.NAME} (${stock.CODE})` : '-'} via ${source}`);

    if (info.menuItemId === "companyInfo") {
        if (stock) {
            var baseURL = "https://comp.wisereport.co.kr/company/c1010001.aspx?cn=&cmp_cd=";
            chrome.tabs.create({ url: baseURL + stock.CODE });
        }
    } else if (info.menuItemId === "news") {
        // Use the official name when resolved; otherwise search the selected text as-is
        var params = new URLSearchParams({ q: stock ? stock.NAME : selectionText });
        if (stock) {
            params.set('code', stock.CODE);
        }
        chrome.tabs.create({ url: chrome.runtime.getURL('news.html?' + params) });
    }
});
