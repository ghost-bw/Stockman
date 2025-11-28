async function loadCompanyNews(symbol) {
    try {
        console.log(`Loading news for ${symbol}...`);
        const url = `/company-news/${symbol}`;
        console.log(`Fetching from: ${url}`);
        
        const res = await fetch(url);
        console.log(`Response status: ${res.status}`);
        
        if (!res.ok) {
            console.error(`HTTP Error: ${res.status}`);
            const container = document.getElementById("newsContainer");
            container.innerHTML = `<p style="color: red;">Failed to load news: HTTP ${res.status}</p>`;
            return;
        }
        
        const data = await res.json();
        console.log("News data received:", data);
        
        const container = document.getElementById("newsContainer");
        container.innerHTML = "";

        if (data.error) {
            console.error("API Error:", data.error);
            container.innerHTML = `<p style="color: red;">Error: ${data.error}</p>`;
            return;
        }

        if (!data.news || data.news.length === 0) {
            console.warn("No news data found");
            container.innerHTML = `<p style="color: orange;">No news articles found for ${symbol}</p>`;
            return;
        }

        console.log(`Found ${data.news.length} news articles`);
        
        data.news.forEach((item, index) => {
            console.log(`Processing news item ${index}:`, item);
            
            const title = item.title || 'No title';
            const text = item.text || item.description || 'No description';
            const source = item.site || item.source || 'Unknown';
            const url = item.url || '#';
            
            const newsHtml = `
                <div class="news-card">
                    <h3>${title}</h3>
                    <p>${text}</p>
                    <small>Source: ${source}</small><br>
                    ${url !== '#' ? `<a href="${url}" target="_blank">Read more →</a>` : '<em>No link available</em>'}
                </div>
            `;
            container.innerHTML += newsHtml;
        });
        
        console.log(`News loaded successfully for ${symbol}`);
        // Update status badge for news (Demo if first site's Demo)
        try {
            const newsStatus = document.getElementById('newsStatus');
            if (newsStatus) {
                const firstSite = (data.news && data.news[0] && data.news[0].site) || null;
                if (firstSite && firstSite.toLowerCase() !== 'demo') {
                    newsStatus.textContent = 'News: Live';
                    newsStatus.style.background = '#4CAF50';
                    newsStatus.style.color = '#fff';
                } else {
                    newsStatus.textContent = 'News: Demo';
                    newsStatus.style.background = '#ffc107';
                    newsStatus.style.color = '#000';
                }
            }
        } catch (e) { console.warn('Failed to set news status:', e); }
    } catch (error) {
        console.error("Error loading news:", error);
        const container = document.getElementById("newsContainer");
        container.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
    }
}

function loadCompany() {
    const symbol = document.getElementById("symbolInput").value.trim().toUpperCase();
    
    if (!symbol) {
        alert("Please enter a company symbol (e.g., AAPL, TSLA, MSFT)");
        return;
    }
    
    console.log("Loading company data for:", symbol);
    loadCompanyChart(symbol);
    loadCompanyNews(symbol);
}
