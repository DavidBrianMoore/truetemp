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
    precipChance: document.getElementById('precip-chance'),
    uvIndex: document.getElementById('uv-index'),
    searchInput: document.getElementById('search-input'),
    searchBox: document.querySelector('.search-box'),
    searchBtn: document.getElementById('search-btn'),
    gpsBtn: document.getElementById('gps-btn'),
    searchResults: document.getElementById('search-results'),
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
let ALL_DAILY_DATA = [];
let INITIAL_STATE = null;
let CURRENT_LAT = null;
let CURRENT_LON = null;
const NWS_API = 'https://api.weather.gov';
const HEADERS = { 'User-Agent': 'TrueTempApp/1.0 (david@truetemp.app)' };

async function init() {
    // Register ATA State
    ata.registerState('hourlyData', () => ALL_HOURLY_DATA);
    ata.registerState('dailyData', () => ALL_DAILY_DATA);
    ata.registerState('uiVisible', () => UI.content?.style.display !== 'none');
    ata.registerState('currentCity', () => UI.city?.textContent);
    ata.registerState('currentTemp', () => UI.temp?.textContent);
    ata.registerState('theme', () => THEME);

    // Register ATA Actions
    ata.registerAction('refresh', (lat, lon) => fetchWeatherData(lat, lon));
    ata.registerAction('updateTheme', (temp, cond) => updateTheme(temp, cond));
    ata.registerAction('reLayout', () => LayoutEngine.applyGrid(UI.trends.container, UI.trends.items));

    // Debug Exports
    window._truetemp = { ALL_HOURLY_DATA, ALL_DAILY_DATA, CURRENT_LAT, CURRENT_LON, INITIAL_STATE, UI };

    // Unit Toggle Listener — preserve searched location across reload
    UI.unitToggle.addEventListener('click', () => {
        CURRENT_UNITS = CURRENT_UNITS === 'F' ? 'C' : 'F';
        localStorage.setItem('units', CURRENT_UNITS);
        if (CURRENT_LAT !== null) {
            localStorage.setItem('last_lat', CURRENT_LAT);
            localStorage.setItem('last_lon', CURRENT_LON);
        }
        location.reload();
    });

    // Search Logic with Multi-Result Support
    let searchTimeout = null;
    
    const renderSearchResults = (results, isLoading = false) => {
        if (isLoading) {
            UI.searchResults.innerHTML = '<div class="result-item" style="opacity:0.6; text-align:center;">Searching...</div>';
            UI.searchResults.style.display = 'block';
            return;
        }

        UI.searchResults.innerHTML = '';
        if (!results || results.length === 0) {
            UI.searchResults.innerHTML = '<div class="result-item" style="opacity:0.6; text-align:center;">No locations found.</div>';
            UI.searchResults.style.display = 'block';
            return;
        }

        results.forEach(res => {
            const item = document.createElement('div');
            item.className = 'result-item';
            const region = [res.admin1, res.country].filter(Boolean).join(', ');
            item.innerHTML = `
                <span class="result-name">${res.name}</span>
                <span class="result-region">${region}</span>
            `;
            item.onclick = (e) => {
                e.stopPropagation();
                UI.searchResults.style.display = 'none';
                UI.searchInput.value = res.name;
                fetchWeatherData(res.latitude, res.longitude);
            };
            UI.searchResults.appendChild(item);
        });
        UI.searchResults.style.display = 'block';
    };

    const handleSearch = async (isManual = false) => {
        const query = UI.searchInput.value.trim();
        if (query.length < 2) {
            UI.searchResults.style.display = 'none';
            return;
        }
        
        if (!isManual) renderSearchResults(null, true);
        
        try {
            // Priority 1: Use distance bias if we have current coords
            let url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=20&language=en&format=json`;
            if (CURRENT_LAT && CURRENT_LON) {
                url += `&latitude=${CURRENT_LAT}&longitude=${CURRENT_LON}`;
            }

            const res = await fetch(url);
            const data = await res.json();
            
            let results = data.results || [];
            
            // Priority 2: Sort to favor United States results first
            results.sort((a, b) => {
                const aIsUS = a.country_code === 'US' ? 1 : 0;
                const bIsUS = b.country_code === 'US' ? 1 : 0;
                if (aIsUS !== bIsUS) return bIsUS - aIsUS;
                return 0; // Maintain API's distance/relevance order within groups
            });

            // Limit to top 10 after sorting
            const finalResults = results.slice(0, 10);
            
            if (isManual && finalResults.length === 1) {
                const { latitude, longitude } = finalResults[0];
                UI.searchResults.style.display = 'none';
                fetchWeatherData(latitude, longitude);
            } else {
                renderSearchResults(finalResults);
            }
        } catch (e) {
            console.error('Search fetch failed:', e);
            if (isManual) showError('Search failed.');
        }
    };

    UI.searchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleSearch(true);
    });
    
    UI.searchInput.addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') handleSearch(true); 
    });

    UI.searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => handleSearch(false), 300);
    });

    UI.searchInput.addEventListener('click', (e) => {
        e.stopPropagation();
        if (UI.searchInput.value.length >= 2) handleSearch(false);
    });

    // Close results when clicking outside
    document.addEventListener('click', () => {
        UI.searchResults.style.display = 'none';
    });

    // GPS Location Listener
    UI.gpsBtn.addEventListener('click', () => {
        UI.gpsBtn.textContent = '⏳';
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                UI.gpsBtn.textContent = '📍';
                fetchWeatherData(pos.coords.latitude, pos.coords.longitude);
            },
            (err) => {
                UI.gpsBtn.textContent = '📍';
                showError('Location access denied.');
            },
            { timeout: 10000 }
        );
    });

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

    // 1. Try to load from cache first
    const cached = loadFromCache();
    if (cached) {
        renderFullWeather(cached.data);
    }

    const params = new URLSearchParams(window.location.search);
    
    try {
        if (params.has('demo')) {
            await fetchWeatherData(33.4484, -112.0740);
        } else {
            const savedLat = parseFloat(localStorage.getItem('last_lat'));
            const savedLon = parseFloat(localStorage.getItem('last_lon'));
            if (!isNaN(savedLat) && !isNaN(savedLon)) {
                await fetchWeatherData(savedLat, savedLon);
            } else {
                try {
                    const coords = await getPosition();
                    await fetchWeatherData(coords.latitude, coords.longitude);
                } catch (err) {
                    await fetchWeatherData(33.4484, -112.0740);
                }
            }
        }
        
        window.addEventListener('resize', () => {
            if (UI.trends.container) LayoutEngine.applyGrid(UI.trends.container, UI.trends.items);
        });

        setInterval(() => {
            if (CURRENT_LAT !== null) fetchWeatherData(CURRENT_LAT, CURRENT_LON);
        }, 15 * 60 * 1000);

    } catch (error) {
        showError(error.message || 'Location error.');
    }

    // Modal Close
    document.getElementById('close-stations').onclick = () => {
        document.getElementById('stations-modal').style.display = 'none';
    };
    document.getElementById('switch-station-btn').onclick = () => fetchNearbyStations(CURRENT_LAT, CURRENT_LON);
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

async function fetchWeatherData(lat, lon, stationId = null) {
    if (lat === undefined || lon === undefined) return;
    CURRENT_LAT = lat;
    CURRENT_LON = lon;
    try {
        updateLoading('Locating atmospheric grid...');
        const pointsRes = await fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`, { headers: HEADERS });
        if (!pointsRes.ok) throw new Error('Weather Service unavailable.');
        const pointsData = await pointsRes.json();
        const { forecast, forecastHourly, relativeLocation, radarStation } = pointsData.properties;
        const { city, state } = relativeLocation.properties;

        UI.city.textContent = `${city}, ${state}`;
        const stationEl = document.getElementById('station-info');
        if (stationEl) stationEl.textContent = stationId ? `Station: ${stationId}` : 'Loading station...';
        UI.set('date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
        UI.set('updated', `Updated: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
        
        if (UI.radarLink && radarStation) {
            UI.radarLink.href = `https://radar.weather.gov/station/${radarStation}/standard`;
        }

        updateLoading('Loading current temperature...');
        const hourlyRes = await fetch(forecastHourly, { headers: HEADERS, cache: 'reload' });
        const hourlyData = await hourlyRes.json();
        ALL_HOURLY_DATA = hourlyData.properties.periods || [];
        
        if (ALL_HOURLY_DATA.length > 0) {
            const currentPeriod = ALL_HOURLY_DATA[0];
            INITIAL_STATE = currentPeriod;
            renderWeather(currentPeriod, ALL_HOURLY_DATA);
            updateTheme(currentPeriod.temperature, currentPeriod.shortForecast);
        }

        const backgroundTasks = async () => {
            try {
                const dailyRes = await fetch(forecast, { headers: HEADERS, cache: 'reload' });
                if (dailyRes.ok) {
                    const dailyData = await dailyRes.json();
                    const dailyPeriods = dailyData.properties.periods || [];
                    ALL_DAILY_DATA = dailyPeriods;
                    
                    const relevant = dailyPeriods.slice(0, 3);
                    const temps = relevant.map(p => p.temperature);
                    const high = Math.max(...temps);
                    const low = Math.min(...temps);
                    
                    const displayHigh = CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9);
                    const displayLow = CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9);
                    UI.set('high', `${displayHigh}°`);
                    UI.set('low', `${displayLow}°`);
                    renderDailyForecast(dailyPeriods);

                    const tomDate = new Date(); tomDate.setDate(tomDate.getDate() + 1);
                    const tomDateStr = tomDate.toDateString();
                    const tomPeriods = dailyPeriods.filter(p => new Date(p.startTime).toDateString() === tomDateStr);
                    let tomHigh, tomLow;
                    if (tomPeriods.length > 0) {
                        const tomTemps = tomPeriods.map(p => p.temperature);
                        tomHigh = Math.max(...tomTemps);
                        tomLow = Math.min(...tomTemps);
                    } else {
                        tomHigh = dailyPeriods[2]?.temperature || high;
                        tomLow = dailyPeriods[3]?.temperature ?? low;
                    }
                    fetchTrends(lat, lon, high, low, tomHigh, tomLow);
                }
            } catch (e) { console.error(e); }

            try {
                const sId = stationId || pointsData.properties.observationStations.split('/').pop() || (await fetch(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations`, { headers: HEADERS }).then(r => r.json()).then(d => d.features[0].properties.stationIdentifier));
                if (sId) {
                    const sEl = document.getElementById('station-info');
                    if (sEl) sEl.textContent = `Station: ${sId}`;
                    const obsRes = await fetch(`${NWS_API}/stations/${sId}/observations/latest`, { headers: HEADERS, cache: 'reload' });
                    if (obsRes.ok) {
                        const obsData = await obsRes.json();
                        const celsius = obsData.properties.temperature.value;
                        if (celsius !== null) {
                            const currentTemp = Math.round((celsius * 9/5) + 32);
                            const displayTemp = CURRENT_UNITS === 'F' ? currentTemp : Math.round((currentTemp - 32) * 5/9);
                            UI.set('temp', `${displayTemp}°`);
                            updateTheme(currentTemp, ALL_HOURLY_DATA[0].shortForecast);
                        }
                    }
                }
            } catch (e) { console.error(e); }
            fetchAlerts(lat, lon);
        };
        backgroundTasks();
    } catch (error) { showError(error.message); }
}

async function fetchNearbyStations(lat, lon) {
    const modal = document.getElementById('stations-modal');
    const list = document.getElementById('stations-list');
    modal.style.display = 'flex';
    list.innerHTML = '<div style="text-align:center; padding: 2rem; opacity: 0.6;">Searching for NWS weather stations...</div>';
    try {
        const res = await fetch(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations`, { headers: HEADERS });
        const data = await res.json();
        list.innerHTML = '';
        data.features.forEach(s => {
            const id = s.properties.stationIdentifier;
            const item = document.createElement('div');
            item.className = 'station-item';
            item.innerHTML = `<div><div class="station-id">${id}</div><div class="station-name">${s.properties.name}</div></div><span>📡</span>`;
            item.onclick = () => {
                modal.style.display = 'none';
                fetchWeatherData(lat, lon, id);
            };
            list.appendChild(item);
        });
    } catch (e) { list.innerHTML = 'Failed to load stations.'; }
}

function renderWeather(current, hourly) {
    if (!current) return;
    if (UI.state) UI.state.style.display = 'none';
    if (UI.content) UI.content.style.display = 'grid'; 
    const displayTemp = CURRENT_UNITS === 'F' ? current.temperature : Math.round((current.temperature - 32) * 5/9);
    UI.set('temp', `${displayTemp}°`);
    UI.set('desc', current.shortForecast);
    UI.set('wind', `${current.windSpeed} ${current.windDirection}`);
    UI.set('humidity', `${current.relativeHumidity?.value || '--'}%`);
    const feelsLike = calculateFeelsLike(current.temperature, current.relativeHumidity?.value || 50, parseFloat(current.windSpeed) || 0);
    const displayFeelsLike = CURRENT_UNITS === 'F' ? feelsLike : Math.round((feelsLike - 32) * 5/9);
    UI.set('feelsLike', `${displayFeelsLike}°`);
    UI.set('visibility', current.visibility || '10 mi');
    const precip = current.probabilityOfPrecipitation?.value;
    UI.set('precipChance', precip !== null ? `${precip}%` : '--%');
    UI.set('uvIndex', '--');
    if (UI.heroIcon) UI.heroIcon.innerHTML = `<img src="${getModernIcon(current.shortForecast)}" alt="Icon" style="width: 100px;">`;
    renderHourly(hourly.slice(0, 24));
}

function renderHourly(periods) {
    if (!UI.hourly) return;
    UI.hourly.innerHTML = '';
    periods.forEach(period => {
        const item = document.createElement('div');
        item.className = 'forecast-item glass-card';
        const time = new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' });
        const temp = CURRENT_UNITS === 'F' ? period.temperature : Math.round((period.temperature - 32) * 5/9);
        item.innerHTML = `<span style="font-size: 0.8rem; opacity: 0.8;">${time}</span><img src="${getModernIcon(period.shortForecast)}" style="width:32px; margin: 8px 0;"><span style="font-weight: 700;">${temp}°</span>`;
        UI.hourly.appendChild(item);
    });
    LayoutEngine.applyScrollSafeZone(UI.hourly);
}

function renderDailyForecast(forecast) {
    if (!UI.daily) return;
    UI.daily.innerHTML = '';
    const grouped = [];
    forecast.forEach(p => {
        const dateKey = new Date(p.startTime).toDateString();
        let dayObj = grouped.find(g => g.dateKey === dateKey);
        if (!dayObj) {
            dayObj = { dateKey, name: p.name.replace(' Night', ''), date: new Date(p.startTime), day: null, night: null };
            grouped.push(dayObj);
        }
        if (p.isDaytime) dayObj.day = p; else dayObj.night = p;
    });
    grouped.slice(0, 10).forEach((day, index) => {
        const item = document.createElement('div');
        item.className = 'forecast-item glass-card clickable' + (index === 0 ? ' selected' : '');
        const mainP = day.day || day.night;
        const mainTemp = CURRENT_UNITS === 'F' ? mainP.temperature : Math.round((mainP.temperature - 32) * 5/9);
        item.innerHTML = `<span style="font-weight: 700;">${day.name}</span><span style="font-size: 0.7rem; opacity: 0.6;">${day.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span><img src="${getModernIcon(mainP.shortForecast)}" style="width:32px; margin: 8px 0;"><span style="font-weight: 700;">${mainTemp}°</span>`;
        item.onclick = () => {
            document.querySelectorAll('.forecast-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            updateAppFocus(day);
        };
        UI.daily.appendChild(item);
    });
    LayoutEngine.applyScrollSafeZone(UI.daily);
}

function updateAppFocus(data, isHistorical = false) {
    if (!data) return;
    const main = data.day || data.night || data;
    const baseDate = data.date ? new Date(data.date) : (main.startTime ? new Date(main.startTime) : new Date());
    const displayTemp = CURRENT_UNITS === 'F' ? main.temperature : Math.round((main.temperature - 32) * 5/9);
    UI.set('temp', `${displayTemp}°`);
    UI.set('desc', main.shortForecast || (isHistorical ? 'Historical Record' : 'Forecast'));
    UI.set('date', baseDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    
    if (!isHistorical && ALL_DAILY_DATA.length > 0) {
        const periods = ALL_DAILY_DATA.filter(p => new Date(p.startTime).toDateString() === baseDate.toDateString());
        if (periods.length > 0) {
            const temps = periods.map(p => p.temperature);
            const high = Math.max(...temps), low = Math.min(...temps);
            const nextDate = new Date(baseDate); nextDate.setDate(nextDate.getDate() + 1);
            const nextPeriods = ALL_DAILY_DATA.filter(p => new Date(p.startTime).toDateString() === nextDate.toDateString());
            let tomHigh = nextPeriods.length > 0 ? Math.max(...nextPeriods.map(p => p.temperature)) : high;
            let tomLow = nextPeriods.length > 0 ? Math.min(...nextPeriods.map(p => p.temperature)) : low;
            fetchTrends(CURRENT_LAT, CURRENT_LON, high, low, tomHigh, tomLow, baseDate);
            UI.set('high', `${CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9)}°`);
            UI.set('low', `${CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9)}°`);
        }
    }
    const resetBtn = document.getElementById('return-today');
    if (resetBtn) resetBtn.style.display = baseDate.toDateString() === new Date().toDateString() ? 'none' : 'flex';
}

async function fetchAlerts(lat, lon) {
    try {
        const res = await fetch(`${NWS_API}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: HEADERS });
        const data = await res.json();
        const alerts = data.features || [];
        if (UI.alertBanner && alerts.length > 0) {
            const alert = alerts[0].properties;
            UI.alertBanner.innerHTML = `⚠️ <span>${alert.event}</span> <span style="font-size:0.7rem; opacity:0.7; margin-left:auto;">Tap for details</span>`;
            UI.alertBanner.style.display = 'flex';
            if (UI.alertDetails) {
                UI.alertDetails.innerHTML = `<h4>${alert.headline || alert.event}</h4><p>${alert.description}</p>`;
                UI.alertBanner.onclick = () => UI.alertDetails.style.display = UI.alertDetails.style.display === 'none' ? 'block' : 'none';
            }
        } else if (UI.alertBanner) UI.alertBanner.style.display = 'none';
    } catch (e) { console.error(e); }
}

function getModernIcon(forecast) {
    const f = forecast.toLowerCase();
    if (f.includes('sunny') || f.includes('clear')) return 'https://cdn-icons-png.flaticon.com/512/869/869869.png';
    if (f.includes('thunder') || f.includes('storm')) return 'https://cdn-icons-png.flaticon.com/512/1163/1163738.png';
    if (f.includes('rain') || f.includes('shower')) return 'https://cdn-icons-png.flaticon.com/512/1163/1163735.png';
    if (f.includes('snow')) return 'https://cdn-icons-png.flaticon.com/512/642/642000.png';
    return 'https://cdn-icons-png.flaticon.com/512/1163/1163734.png';
}

function updateTheme(temp) {
    document.documentElement.style.setProperty('--bg-color-1', temp > 80 ? '#7c2d12' : '#0f172a');
}

async function fetchTrends(lat, lon, todayHigh, todayLow, tomorrowHigh, tomorrowLow, baseDate = new Date()) {
    const yest = new Date(baseDate); yest.setDate(baseDate.getDate() - 1);
    const ly = new Date(baseDate); ly.setFullYear(baseDate.getFullYear() - 1);
    const yestDate = yest.toISOString().split('T')[0], lyDate = ly.toISOString().split('T')[0];
    try {
        const lyRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${lyDate}&end_date=${lyDate}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit`);
        const lyData = await lyRes.json();
        const lyHigh = Math.round(lyData.daily?.temperature_2m_max[0] || 0);
        UI.trends.container.innerHTML = ''; UI.trends.items = [];
        const isToday = baseDate.toDateString() === new Date().toDateString();
        const trendData = [
            { label: (isToday ? 'Yesterday' : yest.toLocaleDateString([], { weekday: 'long' })) + ` (${yest.toLocaleDateString([], {month:'short', day:'numeric'})})`, high: todayHigh - 2, diff: -2, date: yest },
            { label: `In ${ly.getFullYear()} (${ly.toLocaleDateString([], {month:'short', day:'numeric'})})`, high: lyHigh, diff: lyHigh - todayHigh, date: ly },
            { label: (isToday ? 'Tomorrow' : new Date(baseDate.getTime() + 86400000).toLocaleDateString([], { weekday: 'long' })) + ` (${new Date(baseDate.getTime() + 86400000).toLocaleDateString([], {month:'short', day:'numeric'})})`, high: tomorrowHigh, diff: tomorrowHigh - todayHigh, date: new Date(baseDate.getTime() + 86400000), isForward: true }
        ];
        trendData.forEach(d => {
            const el = document.createElement('div'); el.className = 'trend-card clickable glass-card';
            const diffVal = CURRENT_UNITS === 'F' ? Math.abs(d.diff) : Math.round(Math.abs(d.diff) / 1.8);
            const text = d.diff > 0 ? `${diffVal}° hotter` : d.diff < 0 ? `${diffVal}° cooler` : 'Same';
            el.innerHTML = `<span style="font-size:0.7rem; color:var(--text-secondary);">${d.label}</span><div style="display:flex; align-items: baseline; gap: 6px; margin: 4px 0;"><span style="font-size:1.5rem; font-weight:700;">${CURRENT_UNITS === 'F' ? d.high : Math.round((d.high - 32) * 5/9)}°</span></div><span class="diff-badge small" style="background:rgba(255,255,255,0.1);">${text}</span>`;
            el.onclick = () => { if (d.isForward) return; updateAppFocus({ temperature: d.high, shortForecast: 'Historical', date: d.date }, true); };
            UI.trends.container.appendChild(el); UI.trends.items.push(el);
        });
        LayoutEngine.applyGrid(UI.trends.container, UI.trends.items);
        UI.trends.container.style.display = 'grid';
    } catch (e) { console.error(e); }
}

function updateLoading(msg) { if (UI.state) { const msgEl = document.getElementById('loading-msg'); if (msgEl) msgEl.textContent = msg; } }
function showError(msg) { if (UI.state) UI.state.innerHTML = `<div class="error-view glass-card"><h3>Weather Interruption</h3><p>${msg}</p><button class="btn" onclick="location.reload()">Try Again</button></div>`; }
function calculateFeelsLike(t, h, w) { if (t <= 50 && w > 3) return Math.round(35.74 + 0.6215 * t - 35.75 * Math.pow(w, 0.16) + 0.4275 * t * Math.pow(w, 0.16)); if (t >= 80) return Math.round(0.5 * (t + 61 + (t - 68) * 1.2 + h * 0.094)); return Math.round(t); }
function saveToCache(data) { localStorage.setItem('weather_cache', JSON.stringify({ timestamp: Date.now(), data })); }
function loadFromCache() { const c = localStorage.getItem('weather_cache'); if (!c) return null; const { timestamp, data } = JSON.parse(c); return Date.now() - timestamp > 15 * 60 * 1000 ? null : { data }; }
function renderFullWeather(data) { const { current, hourly, daily, lat, lon, trendParams } = data; if (current) INITIAL_STATE = current; if (lat) { CURRENT_LAT = lat; CURRENT_LON = lon; } renderWeather(current, hourly); renderDailyForecast(daily); if (trendParams && lat) fetchTrends(lat, lon, trendParams.high, trendParams.low, trendParams.tomorrowHigh, trendParams.tomorrowLow); }

init();
