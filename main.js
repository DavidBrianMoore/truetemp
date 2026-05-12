const UI = {
    state: document.getElementById('ui-state'),
    content: document.getElementById('weather-content'),
    city: document.querySelector('#city-name span'),
    date: document.getElementById('current-date'),
    updated: document.getElementById('last-updated'),
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
                .then(reg => console.log('TrueTemp SW Registered'))
                .catch(err => console.log('SW Registration Failed', err));
        });
    }

    const params = new URLSearchParams(window.location.search);
    
    try {
        if (params.has('demo')) {
            console.log('TrueTemp Demo Mode Active');
            await fetchWeatherData(33.4484, -112.0740); // Phoenix, AZ
        } else {
            const coords = await getPosition();
            await fetchWeatherData(coords.latitude, coords.longitude);
        }
    } catch (error) {
        showError(error.message || 'Unable to retrieve location. Please check permissions.');
    }
}

function getPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported.'));
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos.coords),
            (err) => {
                const messages = { 1: 'Location access denied.', 2: 'Location unavailable.', 3: 'Request timed out.' };
                reject(new Error(messages[err.code] || 'Location error.'));
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

async function fetchWeatherData(lat, lon) {
    try {
        updateLoading('Fetching local grid data...');
        const t = Date.now();
        
        const pointsRes = await fetch(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}?t=${t}`, {
            headers: { 'User-Agent': 'TrueTempApp/1.0' }
        });
        
        if (!pointsRes.ok) throw new Error('Weather Service unavailable.');
        const pointsData = await pointsRes.json();
        
        const { forecast, forecastHourly, relativeLocation } = pointsData.properties;
        const { city, state } = relativeLocation.properties;

        if (UI.city) UI.city.textContent = `${city}, ${state}`;
        if (UI.date) UI.date.textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        if (UI.updated) UI.updated.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

        updateLoading('Analyzing atmospheric conditions...');
        const [hourlyRes, dailyRes, stationsRes] = await Promise.all([
            fetch(`${forecastHourly}?t=${t}`, { headers: { 'User-Agent': 'TrueTempApp/1.0' } }),
            fetch(`${forecast}?t=${t}`, { headers: { 'User-Agent': 'TrueTempApp/1.0' } }),
            fetch(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations`, { headers: { 'User-Agent': 'TrueTempApp/1.0' } })
        ]);

        if (!hourlyRes.ok || !dailyRes.ok) throw new Error('Forecast unavailable.');

        const hourlyData = await hourlyRes.json();
        const dailyData = await dailyRes.json();
        
        let currentTemp = hourlyData.properties.periods[0].temperature;
        
        // Attempt to get Real-Time Observation
        try {
            if (stationsRes.ok) {
                const stationsData = await stationsRes.json();
                const stationId = stationsData.features[0]?.properties?.stationIdentifier;
                if (stationId) {
                    const obsRes = await fetch(`${NWS_API}/stations/${stationId}/observations/latest?t=${t}`, {
                        headers: { 'User-Agent': 'TrueTempApp/1.0' }
                    });
                    if (obsRes.ok) {
                        const obsData = await obsRes.json();
                        const celsius = obsData.properties.temperature.value;
                        if (celsius !== null) {
                            currentTemp = Math.round((celsius * 9/5) + 32);
                            console.log(`Live Observation from ${stationId}: ${currentTemp}°F`);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Real-time observation failed, falling back to forecast.', e);
        }

        ALL_HOURLY_DATA = hourlyData.properties.periods || [];

        if (ALL_HOURLY_DATA.length > 0) {
            const currentPeriod = { ...ALL_HOURLY_DATA[0], temperature: currentTemp };
            renderWeather(currentPeriod, ALL_HOURLY_DATA);
            updateTheme(currentTemp, currentPeriod.shortForecast);
        }
        
        if (dailyData.properties.periods) {
            renderDailyForecast(dailyData.properties.periods);
        }

        fetchAlerts(lat, lon);
        
        if (ALL_HOURLY_DATA.length > 0 && dailyData.properties.periods) {
            const tomorrowTemp = dailyData.properties.periods[1]?.temperature || ALL_HOURLY_DATA[0].temperature;
            fetchTrends(lat, lon, ALL_HOURLY_DATA[0].temperature, tomorrowTemp);
        }
    } catch (error) {
        showError(error.message);
    }
}

function renderWeather(current, hourly) {
    if (!current) return;
    
    if (UI.state) UI.state.style.display = 'none';
    if (UI.content) {
        UI.content.style.display = 'flex';
        UI.content.style.flexDirection = 'column';
        UI.content.style.gap = '1.5rem';
    }

    if (UI.temp) UI.temp.textContent = `${current.temperature}°`;
    if (UI.desc) UI.desc.textContent = current.shortForecast;
    if (UI.wind) UI.wind.textContent = `${current.windSpeed} ${current.windDirection}`;
    if (UI.humidity) UI.humidity.textContent = `${current.relativeHumidity?.value || '--'}%`;
    if (UI.feelsLike) UI.feelsLike.textContent = `${current.temperature}°`;
    if (UI.visibility) UI.visibility.textContent = '10 mi';

    renderHourly(hourly.slice(0, 24));
}

function renderHourly(periods) {
    if (!UI.hourly) return;
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
    if (!UI.daily || !forecast) return;
    UI.daily.innerHTML = '';
    
    const grouped = [];
    for (let i = 0; i < forecast.length; i++) {
        const period = forecast[i];
        const dateKey = new Date(period.startTime).toDateString();
        let dayObj = grouped.find(g => g.dateKey === dateKey);
        if (!dayObj) {
            dayObj = { dateKey, name: period.name.replace(' Night', ''), date: new Date(period.startTime), day: null, night: null };
            grouped.push(dayObj);
        }
        if (period.isDaytime) dayObj.day = period;
        else dayObj.night = period;
    }

    grouped.forEach((day, index) => {
        const item = document.createElement('div');
        item.className = 'forecast-item clickable';
        if (index === 0) item.classList.add('selected');
        
        const mainP = day.day || day.night;
        const icon = mainP.icon;
        const dateStr = day.date.toLocaleDateString([], { month: 'short', day: 'numeric' });

        item.innerHTML = `
            <span style="font-weight: 700;">${day.name}</span>
            <span style="font-size: 0.7rem; color: var(--text-secondary);">${dateStr}</span>
            <img src="${icon}" alt="${mainP.shortForecast}">
            <div style="display:flex; gap: 4px; align-items: baseline;">
                <span class="temp">${mainP.temperature}°</span>
                ${day.night ? `<span style="font-size: 0.75rem; opacity: 0.6;">${day.night.temperature}°</span>` : ''}
            </div>
        `;
        
        item.onclick = () => {
            document.querySelectorAll('.forecast-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            updateAppFocus(day);
            const filteredHourly = ALL_HOURLY_DATA.filter(h => new Date(h.startTime).toDateString() === day.dateKey);
            if (filteredHourly.length > 0) {
                renderHourly(filteredHourly);
                UI.hourly.scrollTo({ left: 0, behavior: 'smooth' });
            }
        };
        UI.daily.appendChild(item);
    });
}

function updateAppFocus(dayObj) {
    const main = dayObj.day || dayObj.night;
    if (!main) return;
    if (UI.temp) UI.temp.textContent = `${main.temperature}°`;
    if (UI.desc) UI.desc.textContent = main.shortForecast;
    if (UI.wind) UI.wind.textContent = `${main.windSpeed} ${main.windDirection}`;
    if (UI.humidity) UI.humidity.textContent = `${main.relativeHumidity?.value || '--'}%`;
    if (UI.date) UI.date.textContent = dayObj.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (UI.feelsLike) UI.feelsLike.textContent = dayObj.night ? `${dayObj.night.temperature}° (Low)` : `${main.temperature}°`;
    updateTheme(main.temperature, main.shortForecast);
}

async function fetchAlerts(lat, lon) {
    try {
        const res = await fetch(`${NWS_API}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { 'User-Agent': 'TrueTempApp/1.0' } });
        const data = await res.json();
        const alerts = data.features || [];
        if (UI.alertBanner) {
            if (alerts.length > 0) {
                UI.alertBanner.innerHTML = `⚠️ <span>${alerts[0].properties.event}</span>`;
                UI.alertBanner.style.display = 'flex';
            } else {
                UI.alertBanner.style.display = 'none';
            }
        }
    } catch (e) {}
}

function updateTheme(temp, condition) {
    const root = document.documentElement;
    let color1, color2, accent;
    if (temp > 95) { color1 = '#450a0a'; color2 = '#7f1d1d'; accent = '#f87171'; } 
    else if (temp > 80) { color1 = '#7c2d12'; color2 = '#9a3412'; accent = '#fb923c'; }
    else if (temp > 65) { color1 = '#064e3b'; color2 = '#065f46'; accent = '#34d399'; }
    else { color1 = '#0f172a'; color2 = '#1e293b'; accent = '#38bdf8'; }
    root.style.setProperty('--bg-color-1', color1);
    root.style.setProperty('--bg-color-2', color2);
    root.style.setProperty('--accent', accent);
}

async function fetchTrends(lat, lon, currentTemp, tomorrowTemp) {
    if (!UI.trends.container) return;
    try {
        const now = new Date();
        const yest = new Date(now); yest.setDate(now.getDate() - 1);
        const ly = new Date(now); ly.setFullYear(now.getFullYear() - 1);

        if (UI.trends.yesterday.el) {
            const l = UI.trends.yesterday.el.querySelector('.trend-label');
            if (l) l.textContent = `Yesterday (${yest.toLocaleDateString([], { month: 'short', day: 'numeric' })})`;
        }
        if (UI.trends.lastYear.el) {
            const l = UI.trends.lastYear.el.querySelector('.trend-label');
            if (l) l.textContent = `In ${ly.getFullYear()} (${ly.toLocaleDateString([], { month: 'short', day: 'numeric' })})`;
        }

        const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${ly.toISOString().split('T')[0]}&end_date=${yest.toISOString().split('T')[0]}&daily=temperature_2m_max&temperature_unit=fahrenheit`);
        const data = await res.json();
        const yestT = Math.round(data.daily.temperature_2m_max[data.daily.temperature_2m_max.length - 1]);
        const lyT = Math.round(data.daily.temperature_2m_max[0]);

        renderTrendItem(UI.trends.yesterday, yestT, currentTemp);
        renderTrendItem(UI.trends.lastYear, lyT, currentTemp);
        renderTrendItem(UI.trends.tomorrow, tomorrowTemp, currentTemp, true);
        UI.trends.container.style.display = 'grid';
    } catch (e) {}
}

function renderTrendItem(element, comparisonTemp, currentTemp, isForward = false) {
    if (!element.temp || !element.diff) return;
    element.temp.textContent = `${comparisonTemp}°`;
    const diff = isForward ? (comparisonTemp - currentTemp) : (currentTemp - comparisonTemp);
    element.diff.textContent = diff > 0 ? `+${diff}° hotter` : diff < 0 ? `${diff}° cooler` : 'Same';
    element.diff.className = 'diff-badge small' + (diff > 0 ? ' hotter' : diff < 0 ? ' cooler' : '');
}

function updateLoading(msg) { if (UI.state) UI.state.innerHTML = `<div class="spinner"></div><p>${msg}</p>`; }
function showError(msg) { if (UI.state) UI.state.innerHTML = `<div class="error-view">⚠️ <p>${msg}</p><button class="btn" onclick="location.reload()">Retry</button></div>`; }

init();
