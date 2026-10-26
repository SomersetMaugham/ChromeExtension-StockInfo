# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"이회사 어때" is a Chrome extension (Manifest V3). You select a Korean listed company's name on any page and open the right-click menu "이 회사 어때". It has two sub-menus:
- **회사정보** opens that company's WISEreport page (`https://comp.wisereport.co.kr/company/c1010001.aspx?cn=&cmp_cd=<CODE>`) in a new tab.
- **관련뉴스** opens the extension's own `news.html` in a new tab. The page lists the 10 latest Naver news articles about the company.

There is no build step, package manager, linter or test suite. To run it, load the folder as an unpacked extension at `chrome://extensions` (Developer mode → "Load unpacked"). After changing a file, click reload on the extension card. Read logs in the service worker's DevTools ("Inspect views: service worker").

## Architecture

- `background.js` is the whole extension: a service worker.
  - `onInstalled` calls `contextMenus.removeAll()` first, so menus from older versions don't collide. It then creates the parent item `parent` and two children, `companyInfo` and `news`. It also builds the KRX cache.
  - `resolveStock()` turns the selected text into `{NAME, CODE}`. It tries three sources in order and returns the first hit, along with the name of the source that resolved it:
    1. **KRX cache.** `refreshKrxList()` downloads the KIND listed-company list (`kind.krx.co.kr/corpgeneral/corpList.do?method=download`). The response is an EUC-KR HTML table, and the code reads 회사명 from column 0 and 종목코드 from column 2. It caches the result in `chrome.storage.local` as `krxList`, with `krxUpdatedAt`. There's no alarm. `lookupKrxCache()` checks the cache's age on each lookup:
       - **Empty cache:** it waits for a download.
       - **Older than 7 days:** it answers from the current cache and refreshes in the background, so the lookup isn't slowed down.
    2. **Naver autocomplete** (`ac.stock.naver.com/ac?target=stock&q=`). This is an unofficial API. The code prefers an exact name match and otherwise takes the top `stock` hit. It covers aliases (`삼전` resolves to 삼성전자), new listings, and names KRX writes differently: KRX lists LS ELECTRIC in Korean, for example, so only Naver resolves the English name.
    3. **Bundled `stocks.json`**, used only when `USE_BUNDLED_FALLBACK` is `true`. It is on by default. Set it to `false` temporarily to see which of the first two sources resolved a lookup; the console log names the source either way.
  - `contextMenus.onClicked` logs `[lookup] "<text>" -> NAME (CODE) via <source>` to the service worker console, then branches on `info.menuItemId`:
    - `companyInfo` needs a match. If there's no match, it does nothing visible.
    - `news` always opens `news.html?q=<query>&code=<CODE>`. The query is the resolved official `NAME` when there is one, and otherwise the trimmed selection as-is, in which case `code` is omitted.
- `news.html` + `news.js` + `news.css` make up the news page. It's an extension page, so it can use `DOMParser`, and its `fetch` to `search.naver.com` bypasses CORS through the host permission.
  - `news.js` fetches `search.naver.com/search.naver?where=news&sort=1&query=<q>` (`sort=1` means latest first; `sort=recent` is not a real value).
  - `parseNaverNews()` extracts the title, URL, press, date and summary. Each article's title is a `.sds-comps-text-type-headline1`, and the article container is the nearest ancestor that also contains a `.sds-comps-profile`. It relies only on the semantic `sds-comps-*` class names and never on the hashed `fender-ui_*` or random-looking ones, which change with every Naver deploy.
  - **뉴스 더 보기** fetches the next 10 articles from Naver's infinite-scroll endpoint (`s.search.naver.com/p/newssearch/4/api/tab/more?...&start=11`). That endpoint returns `{collection: [{html}], url}`, where `url` is the next page. The `html` uses the same markup, so `parseNaverNews()` handles it too. Articles are de-duplicated by URL, because results shift as new articles arrive. The `start` parameter on the regular search URL is ignored by Naver.
  - If parsing yields nothing, the page shows a message. It never shows fake data.
  - The layout and colors copy the news section of the author's [StockApiServer](https://github.com/SomersetMaugham/StockApiServer) dashboard (`extension/dashboard.html`, `css/dashboard.css`). That project scrapes server-side in `get_news_data()`, but its `.news_wrap`/`.news_tit` selectors no longer match Naver's markup as of 2026-10.
- `stocks.json` is the bundled fallback lookup table: a JSON array of `{ "NAME", "CODE" }`. Codes are 6-character strings: leading zeros are kept, and newer listings are alphanumeric, like `0001A0`. A code can appear twice, under its short name and under its official name.
  - It is generated outside this repo by `../preProcessing/build_stocks.py` (`python build_stocks.py [previous stocks.json]`). The script merges Naver's KOSPI/KOSDAQ list (short names, preferred shares, no ETF/ETN) with KIND (official names, plus KONEX). It also writes `stocks_changes.txt`, listing what was added, removed and renamed. Copy the resulting `stocks.json` here.
  - The KRX 정보데이터시스템 CSV that the old, now-deleted pipeline used now requires a login, so that route can't be automated.

## Gotchas

- When news stops showing up, Naver's markup has probably changed. Check `parseNaverNews()` against a freshly fetched search page first.

- `findStock()` ignores whitespace on both sides: the selected text and each `NAME` have all spaces removed before the comparison. That way names like `"CJ ENM"` match whether or not the selection includes the space. If you change the normalization, change both sides together.
- Permissions: `contextMenus` and `storage`, plus host permissions for `kind.krx.co.kr`, `ac.stock.naver.com` (lookup) and `search.naver.com` + `s.search.naver.com` (news page). Without the host permissions, the service worker's fetches fail CORS. `tabs` was removed in v1.0.1 because `chrome.tabs.create` doesn't need it. Adding permissions triggers a re-consent prompt for users who already installed the extension.

## Releases

When you release, bump `version` in `manifest.json` and add an entry at the top of `Release.txt`. Entries are in Korean and use the format `V<version>-<YYYY.MM.DD>`, followed by numbered per-file change notes.
