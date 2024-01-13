chrome.runtime.onInstalled.addListener(() => {
    var contextMenuItem = {
        "id": "wiki", 
        "title": "이 회사 어때@COMPANY WISE",
        "contexts": ["selection"]
    };
    chrome.contextMenus.create(contextMenuItem);
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
    // Remove spaces from the selected text
    var selectionText = info.selectionText.replace(/\s+/g, '');
    fetch(chrome.runtime.getURL('stocks.json'))
        .then(response => response.json())
        .then(stockList => {
            var stock = stockList.find(i => i.NAME === selectionText);
            if (stock) {
                console.log('Stock Name found');
                var baseURL = "https://comp.wisereport.co.kr/company/c1010001.aspx?cn=&cmp_cd=";
                var newURL = baseURL + stock.CODE;
                chrome.tabs.create({ url: newURL });
            } else {
                console.log('Stock Name Not found');
            }
        })
        .catch(error => console.error('Error fetching stock list:', error));
});