// News page opened by the "관련뉴스" menu: news.html?q=<search query>[&code=<stock code>]
// Fetches Naver news search (latest first) and renders it in the StockApiServer dashboard style.
const NAVER_NEWS_URL = "https://search.naver.com/search.naver?where=news&sort=1&query=";
// Naver's infinite-scroll endpoint: returns {collection: [{html}], url: <next page>}; the html uses the same markup as the search page
const NAVER_MORE_URL = "https://s.search.naver.com/p/newssearch/4/api/tab/more?sort=1&ssc=tab.news.all&start=11&query=";
const WISEREPORT_URL = "https://comp.wisereport.co.kr/company/c1010001.aspx?cn=&cmp_cd=";
const MAX_NEWS = 10;

// Parse Naver's news search HTML (the 2026 "sds-comps" layout) into [{title, url, press, date, summary}].
// Each article has one headline1 title; the nearest ancestor that also holds a profile block is the article.
function parseNaverNews(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = [];
    for (const titleElem of doc.querySelectorAll('.sds-comps-text-type-headline1')) {
        const link = titleElem.closest('a');
        let item = titleElem.parentElement;
        while (item && !item.querySelector('.sds-comps-profile')) {
            item = item.parentElement;
        }
        if (!link || !item || !/^https?:/.test(link.href)) {
            continue;
        }
        // The press name sits next to hidden "새 창 열림" screen-reader text, so read only its first text span
        const press = item.querySelector('.sds-comps-profile-info-title-text .sds-comps-text');
        // Subtexts hold the time ("12분 전", "2026.10.01."), sometimes a page number ("A10면 1단") and a "네이버뉴스" link
        const date = [...item.querySelectorAll('.sds-comps-profile-info-subtext')]
            .filter(e => !e.querySelector('a'))
            .map(e => e.textContent.trim())
            .find(t => /전$|\d{4}\.\d{1,2}\.\d{1,2}\.?$/.test(t));
        const summary = item.querySelector('.sds-comps-text-type-body1');
        items.push({
            title: titleElem.textContent.trim(),
            url: link.href,
            press: press ? press.textContent.trim() : '',
            date: date || '',
            summary: summary ? summary.textContent.trim() : ''
        });
        if (items.length >= MAX_NEWS) {
            break;
        }
    }
    return items;
}

function el(tag, className, text) {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) {
        e.textContent = text;
    }
    return e;
}

const seenURLs = new Set();
let nextURL = null;

// Append articles not already shown (Naver pages shift as new articles arrive); returns how many were added
function appendNews(newsData) {
    const container = document.getElementById('news-container');
    let added = 0;
    for (const news of newsData) {
        if (seenURLs.has(news.url)) {
            continue;
        }
        seenURLs.add(news.url);
        added++;

        const item = el('div', 'news-item');

        const meta = el('div', 'news-meta');
        meta.appendChild(el('div', 'news-press', news.press || '언론사 정보 없음'));
        meta.appendChild(el('div', 'news-date', news.date || '날짜 정보 없음'));

        const body = el('div', 'news-body');
        const title = el('div', 'news-title');
        const link = el('a', '', news.title);
        link.href = news.url;
        link.target = '_blank';
        title.appendChild(link);
        body.appendChild(title);
        if (news.summary) {
            body.appendChild(el('div', 'news-summary', news.summary));
        }

        item.appendChild(meta);
        item.appendChild(body);
        container.appendChild(item);
    }
    return added;
}

function displayMessage(message) {
    const container = document.getElementById('news-container');
    container.innerHTML = '';
    container.appendChild(el('div', 'no-news', message));
}

async function loadMore() {
    const button = document.getElementById('more-button');
    button.disabled = true;
    button.textContent = '불러오는 중...';
    try {
        const response = await fetch(nextURL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const html = (data.collection || []).map(c => c.html || '').join('');
        const added = appendNews(parseNaverNews(html));
        console.log(`[news] more: ${added} items`);
        nextURL = data.url || null;
        button.hidden = added === 0 || !nextURL;
        button.textContent = '뉴스 더 보기';
    } catch (error) {
        console.error('[news] more failed:', error);
        button.textContent = '다시 시도';
    }
    button.disabled = false;
}

async function init() {
    const params = new URLSearchParams(location.search);
    const query = params.get('q') || '';
    const code = params.get('code');

    document.title = `${query} - 관련뉴스`;
    document.getElementById('company-name').textContent = query;
    document.getElementById('company-code').textContent = code ? `종목코드 ${code}` : '상장사 목록에 없는 이름 · 검색어 그대로 검색';
    if (code) {
        const infoLink = document.getElementById('company-info-link');
        infoLink.href = WISEREPORT_URL + code;
        infoLink.hidden = false;
    }
    document.getElementById('more-button').addEventListener('click', loadMore);

    try {
        const response = await fetch(NAVER_NEWS_URL + encodeURIComponent(query));
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const news = parseNaverNews(await response.text());
        console.log(`[news] "${query}": ${news.length} items`);
        document.getElementById('news-container').innerHTML = '';
        if (appendNews(news) === 0) {
            displayMessage('관련 뉴스가 없습니다.');
            return;
        }
        nextURL = NAVER_MORE_URL + encodeURIComponent(query);
        document.getElementById('more-button').hidden = false;
    } catch (error) {
        console.error('[news] fetch failed:', error);
        displayMessage('뉴스를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
    }
}

init();
