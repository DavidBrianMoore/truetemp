const UI = {
    state: document.getElementById('ui-state'),
    content: document.getElementById('weather-content'),
    city: document.querySelector('#city-name span'),
    temp: document.getElementById('current-temp'),
    desc: document.getElementById('weather-desc'),
    feelsLike: document.getElementById('feels-like'),
    wind: document.getElementById('wind-speed'),
    humidity: document.getElementById('humidity'),
    visibility: document.getElementById('visibility'),
    hourly: document.getElementById('hourly-forecast'),
    daily: document.getElementById('daily-forecast'),
    alertBanner: document.getElementById('alert-banner'),
    trends: {
        container: document.getElementById('trends-container'),
        yesterday: { el: document.querySelector('.trend-item:nth-child(1)'), temp: document.getElementById('trend-yesterday-temp'), diff: document.getElementById('trend-yesterday-diff') },
        lastYear: { el: document.querySelector('.trend-item:nth-child(2)'), temp: document.getElementById('trend-lastyear-temp'), diff: document.getElementById('trend-lastyear-diff') },
        tomorrow: { el: document.querySelector('.trend-item:nth-child(3)'), temp: document.getElementById('trend-tomorrow-temp'), diff: document.getElementById('trend-tomorrow-diff') }
    }
};

let ALL_HOURLY_DATA = [];

const NWS_API = 'https://api.weather.gov';

async function init() {
    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('SkyCast SW Registered'))
                .catch(err => console.log('SW Registration Failed', err));
        });
    }

    try {
        const coords = await getPosition();
        await fetchWeatherData(coords.latitude, coords.longitude);
    } catch (error) {
        showError(error.message || 'Unable to retrieve location. Please check permissions.');
    }
}

function getPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser.'));
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos.coords),
            (err) => {
                const messages = {
                    1: 'Location access denied. Please enable it in settings.',
                    2: 'Location unavailable.',
                    3: 'Location request timed out.'
                };
                reject(new Error(messages[err.code] || 'Location error.'));
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

async function fetchWeatherData(lat, lon) {
    updateLoading('Fetching local grid data...');
    
    // Step 1: Get grid points
    const pointsRes = await fetch(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
        headers: { 'User-Agent': 'TrueTempApp/1.0 (contact@example.com)' }
    });
    
    if (!pointsRes.ok) throw new Error('Weather Service currently unavailable.');
    const pointsData = await pointsRes.json();
    
    const { forecast, forecastHourly, relativeLocation } = pointsData.properties;
    const { city, state } = relativeLocation.properties;

    UI.city.textContent = `${city}, ${state}`;
    UI.date.textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

    // Step 2: Get forecasts
    updateLoading('Analyzing atmospheric conditions...');
    const [hourlyRes, dailyRes] = await Promise.all([
        fetch(forecastHourly, { headers: { 'User-Agent': 'TrueTempApp/1.0' } }),
        fetch(forecast, { headers: { 'User-Agent': 'TrueTempApp/1.0' } })
    ]);

    const hourlyData = await hourlyRes.json();
    const dailyData = await dailyRes.json();

    ALL_HOURLY_DATA = hourlyData.properties.periods;

    renderWeather(ALL_HOURLY_DATA[0], ALL_HOURLY_DATA);
    renderDailyForecast(dailyData.properties.periods);

    // Update Theme based on current weather
    updateTheme(hourlyData.properties.periods[0].temperature, hourlyData.properties.periods[0].shortForecast);

    // Fetch and show Smart Alerts
    fetchAlerts(lat, lon);

    // Fetch Trends (Yesterday, Last Year, Tomorrow)
    fetchTrends(lat, lon, hourlyData.properties.periods[0].temperature, dailyData.properties.periods[1].temperature);
}

function renderWeather(current, hourly) {
    UI.state.style.display = 'none';
    UI.content.style.display = 'flex';
    UI.content.style.flexDirection = 'column';
    UI.content.style.gap = '1.5rem';

    // Current State
    UI.temp.textContent = `${current.temperature}°`;
    UI.desc.textContent = current.shortForecast;
    UI.wind.textContent = `${current.windSpeed} ${current.windDirection}`;
    UI.humidity.textContent = `${current.relativeHumidity?.value || '--'}%`;
    
    // Visibility isn't always in NWS forecast periods, fallback to feels like if missing
    UI.feelsLike.textContent = `${current.temperature}°`;
    UI.visibility.textContent = '10 mi';

    renderHourly(hourly.slice(0, 24));
}

function renderHourly(periods) {
    UI.hourly.innerHTML = '';
    periods.forEach(period => {
        const time = new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' });
        const item = document.createElement('div');
        item.className = 'forecast-item';
        item.innerHTML = `
            <span class="hourly-time">${time}</span>
            <img src="${period.icon}" alt="${period.shortForecast}">
            <span class="temp">${period.temperature}°</span>
        `;
        UI.hourly.appendChild(item);
    });
}

function renderDailyForecast(forecast) {
    UI.daily.innerHTML = '';
    forecast.forEach((period, index) => {
        const date = new Date(period.startTime);
        const dayName = period.name;
        const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

        const item = document.createElement('div');
        item.className = 'forecast-item clickable';
        if (index === 0) item.classList.add('selected');
        
        item.innerHTML = `
            <span style="font-weight: 700;">${dayName}</span>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">${dateStr}</span>
            <img src="${period.icon}" alt="${period.shortForecast}">
            <span class="temp">${period.temperature}°</span>
        `;
        
        item.onclick = () => {
            // Remove selected from others
            document.querySelectorAll('.forecast-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');

            // Filter hourly data for this specific day
            const targetDate = new Date(period.startTime).toDateString();
            const filteredHourly = ALL_HOURLY_DATA.filter(h => 
                new Date(h.startTime).toDateString() === targetDate
            );
            
            if (filteredHourly.length > 0) {
                renderHourly(filteredHourly);
                // Scroll hourly back to start
                UI.hourly.scrollTo({ left: 0, behavior: 'smooth' });
            }
        };
        
        UI.daily.appendChild(item);
    });
}

/**
 * Fetch active NWS alerts for the location
 */
async function fetchAlerts(lat, lon) {
    try {
        const res = await fetch(`${NWS_API}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
            headers: { 'User-Agent': 'TrueTempApp/1.0' }
        });
        if (!res.ok) return;
        
        const data = await res.json();
        const alerts = data.features;

        if (alerts.length > 0) {
            const topAlert = alerts[0].properties;
            UI.alertBanner.innerHTML = `
                <span style="font-size: 1.2rem;">⚠️</span>
                <span>${topAlert.event}: ${topAlert.headline}</span>
            `;
            UI.alertBanner.style.display = 'flex';
        } else {
            UI.alertBanner.style.display = 'none';
        }
    } catch (e) {
        console.error('Alerts fetch failed', e);
    }
}

/**
 * Dynamically update the app's theme based on temperature
 */
function updateTheme(temp, condition) {
    const root = document.documentElement;
    let color1, color2, accent;

    // Heat Theme (> 95°F)
    if (temp > 95) {
        color1 = '#450a0a'; // Deep Red
        color2 = '#7f1d1d'; // Lighter Red
        accent = '#f87171'; // Coral
    } 
    // Warm Theme (80-95°F)
    else if (temp > 80) {
        color1 = '#7c2d12'; // Deep Orange
        color2 = '#9a3412'; // Burnt Orange
        accent = '#fb923c'; // Orange
    }
    // Pleasant Theme (65-80°F)
    else if (temp > 65) {
        color1 = '#064e3b'; // Deep Emerald
        color2 = '#065f46'; // Emerald
        accent = '#34d399'; // Mint
    }
    // Cool/Cold Theme (< 65°F)
    else {
        color1 = '#0f172a'; // Deep Navy
        color2 = '#1e293b'; // Slate
        accent = '#38bdf8'; // Sky Blue
    }

    // Apply colors
    root.style.setProperty('--bg-color-1', color1);
    root.style.setProperty('--bg-color-2', color2);
    root.style.setProperty('--accent', accent);
}

/**
 * Fetch Yesterday and Last Year, and calculate Tomorrow diff
 */
async function fetchTrends(lat, lon, currentTemp, tomorrowTemp) {
    try {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const lastYear = new Date(now);
        lastYear.setFullYear(now.getFullYear() - 1);

        const yestStr = yesterday.toISOString().split('T')[0];
        const lastYearStr = lastYear.toISOString().split('T')[0];

        // Update Labels with dates
        UI.trends.yesterday.el.querySelector('.trend-label').textContent = `Yesterday (${yesterday.toLocaleDateString([], { month: 'short', day: 'numeric' })})`;
        UI.trends.lastYear.el.querySelector('.trend-label').textContent = `In ${lastYear.getFullYear()} (${lastYear.toLocaleDateString([], { month: 'short', day: 'numeric' })})`;

        // Fetch Yesterday & Last Year from Archive
        const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${lastYearStr}&end_date=${yestStr}&daily=temperature_2m_max&temperature_unit=fahrenheit`);
        if (!res.ok) return;

        const data = await res.json();
        
        // Find yesterday's index (last item in daily data)
        const yestTemp = Math.round(data.daily.temperature_2m_max[data.daily.temperature_2m_max.length - 1]);
        const lastYearTemp = Math.round(data.daily.temperature_2m_max[0]);

        // Render Yesterday
        renderTrendItem(UI.trends.yesterday, yestTemp, currentTemp);
        // Render Last Year
        renderTrendItem(UI.trends.lastYear, lastYearTemp, currentTemp);
        // Render Tomorrow (using forecast data already passed in)
        renderTrendItem(UI.trends.tomorrow, tomorrowTemp, currentTemp, true);

        UI.trends.container.style.display = 'grid';
    } catch (e) {
        console.error('Trends fetch failed', e);
    }
}

function renderTrendItem(element, comparisonTemp, currentTemp, isForward = false) {
    element.temp.textContent = `${comparisonTemp}°`;
    const diff = isForward ? (comparisonTemp - currentTemp) : (currentTemp - comparisonTemp);
    
    let text = '';
    let cls = 'diff-badge small';

    if (diff > 0) {
        text = `+${diff}° ${isForward ? 'hotter' : 'hotter'}`;
        cls += ' hotter';
    } else if (diff < 0) {
        text = `${diff}° ${isForward ? 'cooler' : 'cooler'}`;
        cls += ' cooler';
    } else {
        text = 'Same';
    }

    element.diff.textContent = text;
    element.diff.className = cls;
}

function updateLoading(msg) {
    UI.state.innerHTML = `
        <div class="spinner"></div>
        <p>${msg}</p>
    `;
}

function showError(msg) {
    UI.state.innerHTML = `
        <div class="error-view">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p>${msg}</p>
            <button class="btn" onclick="location.reload()">Retry Connection</button>
        </div>
    `;
}

init();
