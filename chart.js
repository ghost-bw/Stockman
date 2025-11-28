let chartInstance = null;

async function loadCompanyChart(symbol) {
    try {
        console.log(`Loading chart for ${symbol}...`);
        const url = `/company-chart/${symbol}`;
        console.log(`Fetching from: ${url}`);
        
        const res = await fetch(url);
        console.log(`Response status: ${res.status}`);
        
        if (!res.ok) {
            console.error(`HTTP Error: ${res.status} ${res.statusText}`);
            const errorText = await res.text();
            console.error(`Response body: ${errorText}`);
            alert(`Failed to load chart: ${res.status} ${res.statusText}\n\nMake sure the server is running on http://localhost:3000`);
            return;
        }
        
        const data = await res.json();
        console.log("Chart data received:", data);

        if (data.error) {
            console.error("API Error:", data.error);
            alert("Error: " + data.error);
            return;
        }

        if (!data.chart || data.chart.length === 0) {
            console.error("No chart data available");
            alert("No chart data available for this symbol. Try: AAPL, TSLA, MSFT");
            return;
        }

        const prices = data.chart.map(x => x.close).reverse();
        const dates = data.chart.map(x => x.date).reverse();

        // Destroy previous chart if it exists
        if (chartInstance) {
            chartInstance.destroy();
        }

        // Create new chart with correct element ID
        chartInstance = new Chart(document.getElementById("companyChart"), {
            type: "line",
            data: {
                labels: dates,
                datasets: [{
                    label: symbol + " Price",
                    data: prices,
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 2,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false
                    }
                }
            }
        });
        
        console.log(`Chart loaded successfully for ${symbol}`);
        // Update status badge for chart (Live if quote.price present)
        try {
            const statusEl = document.getElementById('chartStatus');
            if (statusEl) {
                if (data.quote && data.quote.price != null) {
                    statusEl.textContent = 'Chart: Live';
                    statusEl.style.background = '#4CAF50';
                    statusEl.style.color = '#fff';
                } else {
                    statusEl.textContent = 'Chart: Demo';
                    statusEl.style.background = '#ffc107';
                    statusEl.style.color = '#000';
                }
            }
        } catch (e) { console.warn('Failed to set chart status:', e); }
        // Populate quote box (price / change)
        try {
            const priceEl = document.getElementById('quotePrice');
            const changeEl = document.getElementById('quoteChange');
            if (priceEl && changeEl) {
                const q = data.quote || {};
                if (q.price != null) {
                    priceEl.textContent = q.price.toFixed(2);
                    const sign = (q.change >= 0) ? '+' : '';
                    changeEl.textContent = `${sign}${q.change ?? 0} (${sign}${q.changePercent ?? 0}%)`;
                    changeEl.style.color = (q.change >= 0) ? '#2e7d32' : '#c62828';
                } else {
                    priceEl.textContent = '—';
                    changeEl.textContent = 'Demo data';
                    changeEl.style.color = '#666';
                }
            }
        } catch (e) { console.warn('Failed to populate quote box:', e); }
    } catch (error) {
        console.error("Error loading chart:", error);
        alert("Error loading chart: " + error.message);
    }
}
