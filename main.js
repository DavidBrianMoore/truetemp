import AntigravityTestingAPI from './ata.js';
const ata = new AntigravityTestingAPI('TrueTemp');

const THEME = {
    glass: {
        bg: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        blur: 'blur(20px)',
        shadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
    },
    spacing: {
        gap: 12,
        padding: 16,
        radius: 24
    },
    accent: '#38bdf8'
};

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
    alertDetails: document.getElementById('alert-details'),
    radarLink: document.getElementById('radar-link'),
    heroIcon: document.getElementById('hero-icon-container'),
    trends: {
        container: document.getElementById('trends-container'),
        items: []
    },
    high: document.getElementById('today-high'),
    low: document.getElementById('today-low'),
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn'),
    unitToggle: document.getElementById('toggle-units'),
    // Safe text setter
    set(key, val) {
        if (this[key]) this[key].textContent = val;
    }
};

let CURRENT_UNITS = localStorage.getItem('units') || 'F';
UI.unitToggle.textContent = `°${CURRENT_UNITS}`;

class LayoutEngine {
    static applyGrid(container, items) {
        if (!container) return;
        container.className = 'grid-trends';
        items.forEach(item => item.className = 'glass-card trend-card clickable');
    }

    static applyCardStyle(el) {
        if (!el) return;
        el.classList.add('glass-card');
    }

    static applyScrollSafeZone(container) {
        if (!container) return;
        container.className = 'scroll-container';
        [...container.children].forEach(child => child.classList.add('scroll-item'));
    }

    static applyHeroStyle(container) {
        if (!container) return;
        container.className = 'current-weather glass-card hero-view';
    }

    static mount(id, type, items) {
        const el = document.getElementById(id);
        if (!el) return;
        if (type === 'grid') this.applyGrid(el, items);
        else if (type === 'scroll') this.applyScrollSafeZone(el);
        else if (type === 'hero') this.applyHeroStyle(el);
    }
}

let ALL_HOURLY_DATA = [];
let INITIAL_STATE = null;
const NWS_API = 'https://api.weather.gov';
const HEADERS = { 'User-Agent': 'TrueTempApp/1.0 (david@truetemp.app)' };

async function init() {
    // Register ATA State
    ata.registerState('hourlyData', () => ALL_HOURLY_DATA);
    ata.registerState('uiVisible', () => UI.content?.style.display !== 'none');
    ata.registerState('currentCity', () => UI.city?.textContent);
    ata.registerState('currentTemp', () => UI.temp?.textContent);
    ata.registerState('theme', () => THEME);

    // Register ATA Actions
    ata.registerAction('refresh', (lat, lon) => fetchWeatherData(lat, lon));
    ata.registerAction('updateTheme', (temp, cond) => updateTheme(temp, cond));
    ata.registerAction('reLayout', () => LayoutEngine.applyGrid(UI.trends.container, UI.trends.items));

    // Unit Toggle Listener
    UI.unitToggle.addEventListener('click', () => {
        CURRENT_UNITS = CURRENT_UNITS === 'F' ? 'C' : 'F';
        localStorage.setItem('units', CURRENT_UNITS);
        UI.unitToggle.textContent = `°${CURRENT_UNITS}`;
        location.reload(); // Simplest way to re-render everything with new units
    });

    // Search Listener
    const handleSearch = async () => {
        const query = UI.searchInput.value.trim();
        if (!query) return;
        try {
            updateLoading(`Searching for ${query}...`);
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                const { latitude, longitude } = data.results[0];
                fetchWeatherData(latitude, longitude);
            } else {
                showError('Location not found.');
            }
        } catch (e) {
            showError('Search failed.');
        }
    };
    UI.searchBtn.addEventListener('click', handleSearch);
    UI.searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });

    // Pull-to-Refresh Logic
    let touchStart = 0;
    window.addEventListener('touchstart', (e) => { touchStart = e.touches[0].pageY; }, { passive: true });
    window.addEventListener('touchend', (e) => {
        const touchEnd = e.changedTouches[0].pageY;
        if (window.scrollY === 0 && touchEnd - touchStart > 150) {
            updateLoading('Refreshing data...');
            getPosition().then(coords => fetchWeatherData(coords.latitude, coords.longitude))
                .catch(() => fetchWeatherData(33.4484, -112.0740));
        }
    }, { passive: true });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('TrueTemp SW Registered'))
                .catch(err => console.log('SW Registration Failed', err));
        });
    }

    // 1. Try to load from cache first (Speed #1)
    const cached = loadFromCache();
    if (cached) {
        renderFullWeather(cached.data);
        console.log('Loaded from cache');
    }

    const params = new URLSearchParams(window.location.search);
    
    try {
        if (params.has('demo')) {
            await fetchWeatherData(33.4484, -112.0740);
        } else {
            try {
                const coords = await getPosition();
                await fetchWeatherData(coords.latitude, coords.longitude);
            } catch (err) {
                console.warn('Geolocation failed, using fallback:', err.message);
                // Fallback to Phoenix, AZ if location is denied
                await fetchWeatherData(33.4484, -112.0740);
            }
        }
        
        // Listen for resize to recalculate "Pretext" layout
        window.addEventListener('resize', () => {
            if (UI.trends.container) {
                LayoutEngine.applyGrid(UI.trends.container, UI.trends.items);
            }
        });

        // Auto-refresh every 15 minutes
        setInterval(() => {
            getPosition().then(coords => fetchWeatherData(coords.latitude, coords.longitude))
                .catch(() => fetchWeatherData(33.4484, -112.0740));
        }, 15 * 60 * 1000);

    } catch (error) {
        showError(error.message || 'Location error.');
    }
}

function getPosition() {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos.coords),
            (err) => reject(new Error('Location access denied.')),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

async function fetchWeatherData(lat, lon) {
    if (lat === undefined || lon === undefined) {
        showError('Invalid coordinates provided.');
        return;
    }
    try {
        updateLoading('Locating atmospheric grid...');
        
        // 1. Fetch Points (Location Info & URLs) - CRITICAL PATH
        const pointsRes = await fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`, {
            headers: HEADERS,
            cache: 'reload'
        });
        
        if (!pointsRes.ok) throw new Error('Weather Service unavailable.');
        const pointsData = await pointsRes.json();
        
        const { forecast, forecastHourly, relativeLocation, radarStation } = pointsData.properties;
        const { city, state } = relativeLocation.properties;

        // Update Location UI Immediately
        UI.city.textContent = `${city}, ${state}`;
        UI.set('date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
        UI.set('updated', `Updated: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
        
        if (UI.radarLink && radarStation) {
            UI.radarLink.href = `https://radar.weather.gov/station/${radarStation}/standard`;
        }

        // 2. Fetch Hourly Data (Fastest Temp) - CRITICAL PATH
        updateLoading('Loading current temperature...');
        const hourlyRes = await fetch(forecastHourly, { headers: HEADERS, cache: 'reload' });
        if (!hourlyRes.ok) throw new Error('Hourly forecast unavailable.');
        
        const hourlyData = await hourlyRes.json();
        ALL_HOURLY_DATA = hourlyData.properties.periods || [];
        
        if (ALL_HOURLY_DATA.length > 0) {
            const currentPeriod = ALL_HOURLY_DATA[0];
            INITIAL_STATE = currentPeriod;
            renderWeather(currentPeriod, ALL_HOURLY_DATA);
            updateTheme(currentPeriod.temperature, currentPeriod.shortForecast);
        }

        // 3. Background Parallel Fetches (Non-Blocking)
        const backgroundTasks = async () => {
            try {
                // Fetch Daily Forecast
                const dailyRes = await fetch(forecast, { headers: HEADERS, cache: 'reload' });
                if (dailyRes.ok) {
                    const dailyData = await dailyRes.json();
                    const dailyPeriods = dailyData.properties.periods || [];
                    
                    // Scan first 3 periods for true High/Low
                    const relevant = dailyPeriods.slice(0, 3);
                    const temps = relevant.map(p => p.temperature);
                    const high = Math.max(...temps);
                    const low = Math.min(...temps);
                    
                    const displayHigh = CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9);
                    const displayLow = CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9);
                    UI.set('high', `${displayHigh}°`);
                    UI.set('low', `${displayLow}°`);
                    renderDailyForecast(dailyPeriods);

                    // Fetch Trends after daily is ready
                    const tomorrowPeriod = dailyPeriods.find(p => p.isDaytime && !p.name.includes('Today') && !p.name.includes('This Afternoon'));
                    const tomorrowTemp = tomorrowPeriod ? tomorrowPeriod.temperature : dailyPeriods[1]?.temperature;
                    if (tomorrowTemp !== undefined) {
                        fetchTrends(lat, lon, high, tomorrowTemp);
                    }

                    // Save to cache with full data
                    saveToCache({
                        current: ALL_HOURLY_DATA[0],
                        hourly: ALL_HOURLY_DATA,
                        daily: dailyPeriods,
                        lat, lon
                    });
                }
            } catch (e) { console.error('Daily forecast update failed:', e); }

            try {
                // Fetch Stations & Observation Refinement
                const stationsRes = await fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}/stations`, { 
                    headers: HEADERS, 
                    cache: 'reload' 
                });
                
                if (stationsRes.ok) {
                    const stationsData = await stationsRes.json();
                    const stationId = stationsData.features[0]?.properties?.stationIdentifier;
                    if (stationId) {
                        const stationEl = document.getElementById('station-info');
                        if (stationEl) stationEl.textContent = `NWS Station: ${stationId}`;

                        const obsRes = await fetch(`${NWS_API}/stations/${stationId}/observations/latest`, {
                            headers: HEADERS,
                            cache: 'reload'
                        });
                        
                        if (obsRes.ok) {
                            const obsData = await obsRes.json();
                            const celsius = obsData.properties.temperature.value;
                            if (celsius !== null) {
                                const currentTemp = Math.round((celsius * 9/5) + 32);
                                // Update temp if it changed significantly
                                const displayTemp = CURRENT_UNITS === 'F' ? currentTemp : Math.round((currentTemp - 32) * 5/9);
                                UI.set('temp', `${displayTemp}°`);
                                updateTheme(currentTemp, ALL_HOURLY_DATA[0].shortForecast);
                            }
                        }

                        // True High/Low Refinement
                        try {
                            const observedStats = await fetchTrueHighLow(stationId);
                            if (observedStats) {
                                const currentHighText = UI.high.textContent.replace('°', '');
                                const currentLowText = UI.low.textContent.replace('°', '');
                                
                                let finalHigh = parseInt(currentHighText);
                                let finalLow = parseInt(currentLowText);

                                // Convert observed to current units
                                const obsHigh = CURRENT_UNITS === 'F' ? observedStats.high : Math.round((observedStats.high - 32) * 5/9);
                                const obsLow = CURRENT_UNITS === 'F' ? observedStats.low : Math.round((observedStats.low - 32) * 5/9);

                                if (!isNaN(obsHigh)) finalHigh = Math.max(finalHigh, obsHigh);
                                if (!isNaN(obsLow)) finalLow = Math.min(finalLow, obsLow);

                                UI.set('high', `${finalHigh}°`);
                                UI.set('low', `${finalLow}°`);
                            }
                        } catch (e) { console.error('True High/Low refinement failed:', e); }
                    }
                }
            } catch (e) { console.error('Observation refinement failed:', e); }

            fetchAlerts(lat, lon);
        };

        backgroundTasks(); // Run in background
        
    } catch (error) {
        showError(error.message);
    }
}

function renderWeather(current, hourly) {
    if (!current) return;
    if (UI.state) UI.state.style.display = 'none';
    if (UI.content) {
        const hero = UI.content.querySelector('.current-weather');
        if (hero) LayoutEngine.applyHeroStyle(hero);
        UI.content.style.display = 'grid'; 
    }
    const displayTemp = CURRENT_UNITS === 'F' ? current.temperature : Math.round((current.temperature - 32) * 5/9);
    UI.set('temp', `${displayTemp}°`);
    UI.set('desc', current.shortForecast);
    UI.set('wind', `${current.windSpeed} ${current.windDirection}`);
    UI.set('humidity', `${current.relativeHumidity?.value || '--'}%`);
    const feelsLike = calculateFeelsLike(current.temperature, current.relativeHumidity?.value || 50, parseFloat(current.windSpeed) || 0);
    const displayFeelsLike = CURRENT_UNITS === 'F' ? feelsLike : Math.round((feelsLike - 32) * 5/9);
    UI.set('feelsLike', `${displayFeelsLike}°`);
    UI.set('visibility', current.visibility || '10 mi');

    // Hero Icon (#14)
    if (UI.heroIcon) {
        UI.heroIcon.innerHTML = `<img src="${getModernIcon(current.shortForecast, true)}" alt="Icon">`;
    }
    
    // Inject 2-column info grid logic
    const infoGrid = document.querySelector('.info-grid');
    if (infoGrid) {
        infoGrid.className = 'info-grid grid-2';
        infoGrid.style.display = 'grid';
        infoGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        infoGrid.style.gap = '10px';
        infoGrid.querySelectorAll('.info-item').forEach(item => {
            item.className = 'info-item glass-card';
        });
    }

    renderHourly(hourly.slice(0, 24));
}

function renderHourly(periods) {
    if (!UI.hourly) return;
    UI.hourly.innerHTML = '';
    periods.forEach(period => {
        const item = document.createElement('div');
        item.className = 'forecast-item';
        item.style.flex = '0 0 80px';
        item.style.textAlign = 'center';
        item.style.display = 'flex';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'center';
        LayoutEngine.applyCardStyle(item);
        
        const time = new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' });
        const precip = period.probabilityOfPrecipitation?.value;
        const temp = CURRENT_UNITS === 'F' ? period.temperature : Math.round((period.temperature - 32) * 5/9);
        
        item.innerHTML = `
            <span style="font-size: 0.8rem; font-weight: 600; opacity: 0.8;">${time}</span>
            <img src="${getModernIcon(period.shortForecast)}" alt="icon" style="width:32px; margin: 8px 0;">
            <span class="temp" style="font-weight: 700;">${temp}°</span>
            ${precip > 0 ? `<span class="precip-badge">💧${precip}%</span>` : ''}
        `;
        UI.hourly.appendChild(item);
    });
    LayoutEngine.applyScrollSafeZone(UI.hourly);
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

    grouped.slice(0, 10).forEach((day, index) => {
        const item = document.createElement('div');
        item.className = 'forecast-item clickable';
        item.style.flex = '0 0 100px';
        item.style.textAlign = 'center';
        item.style.display = 'flex';
        item.style.flexDirection = 'column';
        item.style.alignItems = 'center';
        
        if (index === 0) item.classList.add('selected');
        const mainP = day.day || day.night;
        const mainTemp = CURRENT_UNITS === 'F' ? mainP.temperature : Math.round((mainP.temperature - 32) * 5/9);
        const nightTemp = day.night ? (CURRENT_UNITS === 'F' ? day.night.temperature : Math.round((day.night.temperature - 32) * 5/9)) : null;

        item.innerHTML = `
            <span style="font-weight: 700; font-size: 0.9rem;">${day.name}</span>
            <span style="font-size: 0.7rem; opacity: 0.6;">${day.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            <img src="${getModernIcon(mainP.shortForecast)}" alt="icon" style="width:32px; margin: 8px 0;">
            <div style="display:flex; gap: 4px; align-items: baseline; justify-content: center;">
                <span class="temp" style="font-weight: 700;">${mainTemp}°</span>
                ${nightTemp !== null ? `<span style="font-size: 0.75rem; opacity: 0.4;">${nightTemp}°</span>` : ''}
            </div>
        `;
        item.onclick = () => {
            document.querySelectorAll('.forecast-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            updateAppFocus(day);
        };
        LayoutEngine.applyCardStyle(item);
        UI.daily.appendChild(item);
    });

    // Apply Pretext safe-zone logic to prevent clipping
    LayoutEngine.applyScrollSafeZone(UI.daily);
    UI.daily.style.display = 'flex';
    UI.daily.style.flexWrap = 'nowrap';
}

function updateAppFocus(data, isHistorical = false) {
    if (!data) return;
    
    // Check if it's a daily group object or a flat period object
    const main = data.day || data.night || data;
    const dateStr = data.date ? data.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : 'Temporal Pivot';
    
    const displayTemp = CURRENT_UNITS === 'F' ? main.temperature : Math.round((main.temperature - 32) * 5/9);
    UI.set('temp', `${displayTemp}°`);
    UI.set('desc', main.shortForecast || (isHistorical ? 'Historical Record' : 'Forecast'));
    if (main.windSpeed) UI.set('wind', `${main.windSpeed} ${main.windDirection}`);
    if (main.relativeHumidity) UI.set('humidity', `${main.relativeHumidity?.value || '--'}%`);
    UI.set('date', dateStr);
    
    // Show "Return to Today" button if not returning to initial state
    const resetBtn = document.getElementById('return-today');
    if (resetBtn) {
        const isInitial = INITIAL_STATE && main.temperature === INITIAL_STATE.temperature && main.shortForecast === INITIAL_STATE.shortForecast;
        resetBtn.style.display = isInitial ? 'none' : 'flex';
    }
}

async function fetchTrueHighLow(stationId) {
    try {
        const res = await fetch(`${NWS_API}/stations/${stationId}/observations`, { headers: HEADERS });
        if (!res.ok) return null;
        const data = await res.json();
        const observations = data.features || [];
        
        const now = new Date();
        const todayStr = now.toDateString();
        
        let high = -Infinity;
        let low = Infinity;
        let found = false;

        observations.forEach(obs => {
            const date = new Date(obs.properties.timestamp);
            // Only look at observations from today (local time)
            if (date.toDateString() === todayStr) {
                const celsius = obs.properties.temperature.value;
                if (celsius !== null) {
                    const fahrenheit = (celsius * 9/5) + 32;
                    if (fahrenheit > high) high = fahrenheit;
                    if (fahrenheit < low) low = fahrenheit;
                    found = true;
                }
            }
        });

        if (!found) return null;
        return { high: Math.round(high), low: Math.round(low) };
    } catch (e) {
        console.error('fetchTrueHighLow failed:', e);
        return null;
    }
}

async function fetchAlerts(lat, lon) {
    try {
        const res = await fetch(`${NWS_API}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: HEADERS });
        const data = await res.json();
        const alerts = data.features || [];
        if (UI.alertBanner) {
            if (alerts.length > 0) {
                const alert = alerts[0].properties;
                UI.alertBanner.innerHTML = `⚠️ <span>${alert.event}</span> <span style="font-size:0.7rem; opacity:0.7; margin-left:auto;">Tap for details</span>`;
                UI.alertBanner.style.display = 'flex';
                
                // Alert Detail (#12)
                if (UI.alertDetails) {
                    UI.alertDetails.innerHTML = `
                        <h4>${alert.headline || alert.event}</h4>
                        <p>${alert.description || 'No detailed information available.'}</p>
                        ${alert.instruction ? `<div style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;"><strong>Instructions:</strong><br>${alert.instruction}</div>` : ''}
                    `;
                    UI.alertBanner.onclick = () => {
                        UI.alertDetails.style.display = UI.alertDetails.style.display === 'none' ? 'block' : 'none';
                    };
                }
            } else {
                UI.alertBanner.style.display = 'none';
                if (UI.alertDetails) UI.alertDetails.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('Alerts fetch failed:', e);
    }
}

/**
 * Modern Icon Mapping (#13)
 */
function getModernIcon(forecast, isHero = false) {
    const f = forecast.toLowerCase();
    let icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163734.png'; // Fallback
    
    if (f.includes('sunny') || f.includes('clear')) icon = 'https://cdn-icons-png.flaticon.com/512/869/869869.png';
    else if (f.includes('cloudy') && f.includes('partly')) icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163736.png';
    else if (f.includes('cloudy')) icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163734.png';
    else if (f.includes('rain') || f.includes('shower')) icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163735.png';
    else if (f.includes('thunder')) icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163738.png';
    else if (f.includes('snow')) icon = 'https://cdn-icons-png.flaticon.com/512/642/642000.png';
    
    return icon;
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
    THEME.accent = accent;
}

async function fetchTrends(lat, lon, todayHigh, tomorrowHigh) {
    if (!UI.trends.container) return;
    const cacheBust = Date.now();
    try {
        const now = new Date();
        const yest = new Date(now); yest.setDate(now.getDate() - 1);
        const ly = new Date(now); ly.setFullYear(now.getFullYear() - 1);
        
        const yestDate = yest.toISOString().split('T')[0];
        const lyDate = ly.toISOString().split('T')[0];

        // Optimized: Fetch only the specific days needed
        const [yestRes, lyRes] = await Promise.all([
            fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${yestDate}&end_date=${yestDate}&daily=temperature_2m_max&temperature_unit=fahrenheit&cb=${cacheBust}`),
            fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${lyDate}&end_date=${lyDate}&daily=temperature_2m_max&temperature_unit=fahrenheit&cb=${cacheBust}`)
        ]);

        const yestData = await yestRes.json();
        const lyData = await lyRes.json();

        const yestHigh = Math.round(yestData.daily.temperature_2m_max[0]);
        const lyHigh = Math.round(lyData.daily.temperature_2m_max[0]);

        UI.trends.container.innerHTML = '';
        UI.trends.items = [];

        const trendData = [
            { label: `Yesterday (${yest.toLocaleDateString([], {month:'short', day:'numeric'})})`, temp: yestHigh, diff: yestHigh - todayHigh, isReverse: true },
            { label: `In ${ly.getFullYear()} (${ly.toLocaleDateString([], {month:'short', day:'numeric'})})`, temp: lyHigh, diff: lyHigh - todayHigh, isReverse: true },
            { label: 'Tomorrow', temp: tomorrowHigh, diff: tomorrowHigh - todayHigh, isForward: true }
        ];

        trendData.forEach(d => {
            const el = document.createElement('div');
            el.className = 'trend-card clickable';
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            el.style.alignItems = 'center';
            el.style.cursor = 'pointer';
            LayoutEngine.applyCardStyle(el);
            
            const diff = d.diff;
            let text = '';
            if (diff > 0) text = `${diff}° hotter`;
            else if (diff < 0) text = `${Math.abs(diff)}° cooler`;
            else text = 'Same';

            const badgeCls = diff > 0 ? 'hotter' : diff < 0 ? 'cooler' : '';
            
            el.innerHTML = `
                <span style="font-size:0.7rem; color:var(--text-secondary); text-align:center; min-height: 2em;">${d.label}</span>
                <span style="font-size:1.5rem; font-weight:700; margin: 4px 0;">${d.temp}°</span>
                <span class="diff-badge small ${badgeCls}" style="font-size:0.6rem; padding:2px 8px; border-radius:10px; background:rgba(255,255,255,0.1);">${text}</span>
            `;
            
            el.onclick = () => {
                updateAppFocus({ 
                    temperature: d.temp, 
                    shortForecast: d.label.split(' ')[0] + ' Peak'
                }, !d.isForward);
            };

            UI.trends.container.appendChild(el);
            UI.trends.items.push(el);
        });

        LayoutEngine.applyGrid(UI.trends.container, UI.trends.items);
        UI.trends.container.style.display = 'grid';

        // Setup Reset Button
        const resetBtn = document.getElementById('return-today');
        if (resetBtn) {
            resetBtn.onclick = () => {
                updateAppFocus(INITIAL_STATE);
                resetBtn.style.display = 'none';
            };
        }
    } catch (e) { console.error(e); }
}

function updateLoading(msg) { 
    if (UI.state) {
        const msgEl = document.getElementById('loading-msg');
        if (msgEl) msgEl.textContent = msg;
        else UI.state.innerHTML = `<div class="spinner"></div><p id="loading-msg">${msg}</p>`; 
    }
}
function showError(msg) { 
    console.error('App Error:', msg);
    if (UI.state) {
        UI.state.innerHTML = `
            <div class="error-view glass-card">
                <span style="font-size: 3rem;">⚠️</span>
                <h3>Weather Interruption</h3>
                <p style="color: var(--text-secondary); margin: 0.5rem 0;">${msg}</p>
                <p style="font-size: 0.7rem; opacity: 0.6;">Check your connection or GPS permissions.</p>
                <button class="btn" style="margin-top: 1rem;" onclick="location.reload()">Try Again</button>
            </div>
        `;
    }
}

/**
 * Calculates Heat Index or Wind Chill based on NWS formulas.
 */
function calculateFeelsLike(temp, humidity, wind) {
    if (temp <= 50 && wind > 3) {
        // Wind Chill
        return Math.round(35.74 + (0.6215 * temp) - (35.75 * Math.pow(wind, 0.16)) + (0.4275 * temp * Math.pow(wind, 0.16)));
    }
    if (temp >= 80) {
        // Heat Index (Simplified)
        const hi = 0.5 * (temp + 61.0 + ((temp - 68.0) * 1.2) + (humidity * 0.094));
        if (hi >= 80) {
            // Full HI formula would go here for higher precision, but this is a good approximation
            return Math.round(hi);
        }
    }
    return Math.round(temp);
}

/**
 * Cache logic
 */
function saveToCache(data) {
    localStorage.setItem('weather_cache', JSON.stringify({
        timestamp: Date.now(),
        data: data
    }));
}

function loadFromCache() {
    const cached = localStorage.getItem('weather_cache');
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    if (Date.now() - timestamp > 15 * 60 * 1000) return null; // 15 min TTL
    return { data };
}

function renderFullWeather(data) {
    // This is a helper to render everything from a cache/full response
    const { current, hourly, daily, lat, lon } = data;
    renderWeather(current, hourly);
    renderDailyForecast(daily);
    // fetchTrends(lat, lon, high, tomorrow) -> would need to store these too
}

init();
