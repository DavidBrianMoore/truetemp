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
            // Restore last searched location if unit toggle caused reload
            const savedLat = parseFloat(localStorage.getItem('last_lat'));
            const savedLon = parseFloat(localStorage.getItem('last_lon'));
            localStorage.removeItem('last_lat');
            localStorage.removeItem('last_lon');

            if (!isNaN(savedLat) && !isNaN(savedLon)) {
                await fetchWeatherData(savedLat, savedLon);
            } else {
                try {
                    const coords = await getPosition();
                    await fetchWeatherData(coords.latitude, coords.longitude);
                } catch (err) {
                    console.warn('Geolocation failed, using fallback:', err.message);
                    await fetchWeatherData(33.4484, -112.0740);
                }
            }
        }
        
        // Listen for resize to recalculate "Pretext" layout
        window.addEventListener('resize', () => {
            if (UI.trends.container) {
                LayoutEngine.applyGrid(UI.trends.container, UI.trends.items);
            }
        });

        // Auto-refresh every 15 minutes — always use last known location
        setInterval(() => {
            if (CURRENT_LAT !== null) {
                fetchWeatherData(CURRENT_LAT, CURRENT_LON);
            } else {
                getPosition().then(coords => fetchWeatherData(coords.latitude, coords.longitude))
                    .catch(() => fetchWeatherData(33.4484, -112.0740));
            }
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
    // Persist the last-fetched coordinates
    CURRENT_LAT = lat;
    CURRENT_LON = lon;
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

        // Update Location UI Immediately — clear stale station info
        UI.city.textContent = `${city}, ${state}`;
        const stationEl = document.getElementById('station-info');
        if (stationEl) stationEl.textContent = 'Loading station...';
        const coordsDiv = document.querySelector('#city-name div');
        if (coordsDiv) coordsDiv.textContent = `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
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
                    ALL_DAILY_DATA = dailyPeriods;
                    window._truetemp.ALL_DAILY_DATA = dailyPeriods;
                    console.log('ALL_DAILY_DATA loaded:', ALL_DAILY_DATA.length);
                    
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
                    // Correctly find tomorrow's high and low
                    const tomorrowDate = new Date();
                    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
                    const tomorrowDateStr = tomorrowDate.toDateString();
                    const tomPeriods = dailyPeriods.filter(p => new Date(p.startTime).toDateString() === tomorrowDateStr);
                    
                    let tomorrowHigh, tomorrowLow;
                    if (tomPeriods.length > 0) {
                        const tomTemps = tomPeriods.map(p => p.temperature);
                        tomorrowHigh = Math.max(...tomTemps);
                        tomorrowLow = Math.min(...tomTemps);
                    } else {
                        // Fallback: daytime period = index 2 (high), night = index 3 (low)
                        tomorrowHigh = dailyPeriods[2]?.temperature || dailyPeriods[1]?.temperature || 0;
                        tomorrowLow = dailyPeriods[3]?.temperature ?? tomorrowHigh;
                    }
                    
                    if (tomorrowHigh !== undefined) {
                        fetchTrends(lat, lon, high, low, tomorrowHigh, tomorrowLow);
                    }

                    // Save to cache with full data including trend params
                    saveToCache({
                        current: ALL_HOURLY_DATA[0],
                        hourly: ALL_HOURLY_DATA,
                        daily: dailyPeriods,
                        lat, lon,
                        trendParams: { high, low, tomorrowHigh, tomorrowLow }
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
    const precip = current.probabilityOfPrecipitation?.value;
    UI.set('precipChance', precip !== null && precip !== undefined ? `${precip}%` : '--%');
    // UV index is not in the NWS hourly API — show placeholder until we have a source
    UI.set('uvIndex', '--');

    // Hero Icon (#14)
    if (UI.heroIcon) {
        UI.heroIcon.innerHTML = `<img src="${getModernIcon(current.shortForecast, true)}" alt="Icon">`;
    }
    
    // Inject 3-column info grid (6 items)
    const infoGrid = document.querySelector('.info-grid');
    if (infoGrid) {
        infoGrid.className = 'info-grid grid-2';
        infoGrid.style.display = 'grid';
        infoGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
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
            
            const displayHigh = CURRENT_UNITS === 'F' ? mainP.temperature : Math.round((mainP.temperature - 32) * 5/9);
            const displayLow = nightTemp !== null ? nightTemp : displayHigh;
            
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
    const baseDate = data.date ? new Date(data.date) : (main.startTime ? new Date(main.startTime) : new Date());
    const dateStr = baseDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    
    window._truetemp.lastBaseDate = baseDate; // Debug
    
    const displayTemp = CURRENT_UNITS === 'F' ? main.temperature : Math.round((main.temperature - 32) * 5/9);
    UI.set('temp', `${displayTemp}°`);
    UI.set('desc', main.shortForecast || (isHistorical ? 'Historical Record' : 'Forecast'));
    if (main.windSpeed) UI.set('wind', `${main.windSpeed} ${main.windDirection}`);
    if (main.relativeHumidity) UI.set('humidity', `${main.relativeHumidity?.value || '--'}%`);
    UI.set('date', dateStr);

    console.log('updateAppFocus:', dateStr, 'Daily Data Count:', ALL_DAILY_DATA.length);

    // Update Trends relative to this day
    if (!isHistorical && ALL_DAILY_DATA.length > 0) {
        const dayDateStr = baseDate.toDateString();
        const periods = ALL_DAILY_DATA.filter(p => new Date(p.startTime).toDateString() === dayDateStr);
        
        let high, low;
        if (periods.length > 0) {
            const temps = periods.map(p => p.temperature);
            high = Math.max(...temps);
            low = Math.min(...temps);
        } else {
            // If not found in daily (e.g. today from hourly), use today high/low from UI or estimate
            high = main.temperature;
            low = main.temperature;
            // Attempt to get from UI high/low if it's today
            if (dayDateStr === new Date().toDateString()) {
                const uiHigh = parseInt(UI.high.textContent);
                const uiLow = parseInt(UI.low.textContent);
                if (!isNaN(uiHigh)) high = CURRENT_UNITS === 'F' ? uiHigh : Math.round(uiHigh * 1.8 + 32);
                if (!isNaN(uiLow)) low = CURRENT_UNITS === 'F' ? uiLow : Math.round(uiLow * 1.8 + 32);
            }
        }

        // Find high/low for the "relative tomorrow"
        const nextDate = new Date(baseDate);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toDateString();
        const nextPeriods = ALL_DAILY_DATA.filter(p => new Date(p.startTime).toDateString() === nextDateStr);
        
        let tomHigh, tomLow;
        if (nextPeriods.length > 0) {
            const tomTemps = nextPeriods.map(p => p.temperature);
            tomHigh = Math.max(...tomTemps);
            tomLow = Math.min(...tomTemps);
        } else {
            tomHigh = high; 
            tomLow = low;
        }

        console.log(`Trends Update: Base=${dayDateStr} High=${high} Low=${low} Tom=${tomHigh}`);
        fetchTrends(CURRENT_LAT, CURRENT_LON, high, low, tomHigh, tomLow, baseDate);

        // Update UI High/Low display
        const displayHigh = CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9);
        const displayLow = CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9);
        UI.set('high', `${displayHigh}°`);
        UI.set('low', `${displayLow}°`);
    }
    
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
 * Modern Icon Mapping — expanded condition set
 */
function getModernIcon(forecast, isHero = false) {
    const f = forecast.toLowerCase();
    let icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163734.png'; // Default: cloudy
    
    if (f.includes('sunny') || f.includes('clear')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/869/869869.png';
    } else if (f.includes('partly') && (f.includes('cloudy') || f.includes('sunny'))) {
        icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163736.png';
    } else if (f.includes('mostly clear') || f.includes('mostly sunny')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/869/869869.png';
    } else if (f.includes('fog') || f.includes('haze') || f.includes('mist')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/4005/4005901.png';
    } else if (f.includes('thunder') || f.includes('storm')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163738.png';
    } else if (f.includes('rain') || f.includes('shower') || f.includes('drizzle')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163735.png';
    } else if (f.includes('snow') || f.includes('blizzard') || f.includes('flurr')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/642/642000.png';
    } else if (f.includes('wintry') || f.includes('sleet') || f.includes('ice') || f.includes('freezing')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/2315/2315377.png';
    } else if (f.includes('wind') || f.includes('breezy') || f.includes('blustery')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/959/959711.png';
    } else if (f.includes('cloudy') || f.includes('overcast')) {
        icon = 'https://cdn-icons-png.flaticon.com/512/1163/1163734.png';
    }
    
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

async function fetchTrends(lat, lon, todayHigh, todayLow, tomorrowHigh, tomorrowLow, baseDate = new Date()) {
    if (!UI.trends.container) return;
    const cacheBust = Date.now();
    try {
        const yest = new Date(baseDate); yest.setDate(baseDate.getDate() - 1);
        const ly = new Date(baseDate); ly.setFullYear(baseDate.getFullYear() - 1);
        
        const yestDate = yest.toISOString().split('T')[0];
        const lyDate = ly.toISOString().split('T')[0];

        // 1. Get Yesterday Data (Check Forecast first, then Archive)
        let yestHigh, yestLow;
        const yestInForecast = ALL_DAILY_DATA.find(p => new Date(p.startTime).toDateString() === yest.toDateString());
        
        if (yestInForecast) {
            // Find all periods for that day to get true high/low
            const yestPeriods = ALL_DAILY_DATA.filter(p => new Date(p.startTime).toDateString() === yest.toDateString());
            const yestTemps = yestPeriods.map(p => p.temperature);
            yestHigh = Math.max(...yestTemps);
            yestLow = Math.min(...yestTemps);
        } else {
            const yestRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${yestDate}&end_date=${yestDate}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&cb=${cacheBust}`);
            const yestData = await yestRes.json();
            yestHigh = Math.round(yestData.daily?.temperature_2m_max[0] || 0);
            yestLow = Math.round(yestData.daily?.temperature_2m_min[0] || 0);
        }

        // 2. Get Last Year Data (Archive)
        const lyRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${lyDate}&end_date=${lyDate}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&cb=${cacheBust}`);
        const lyData = await lyRes.json();
        const lyHigh = Math.round(lyData.daily?.temperature_2m_max[0] || 0);
        const lyLow = Math.round(lyData.daily?.temperature_2m_min[0] || 0);

        UI.trends.container.innerHTML = '';
        UI.trends.items = [];

        // Labels relative to baseDate
        const isToday = baseDate.toDateString() === new Date().toDateString();
        const yestLabel = isToday ? 'Yesterday' : yest.toLocaleDateString([], { weekday: 'long' });
        const lyLabel = `In ${ly.getFullYear()}`;
        const tomLabel = isToday ? 'Tomorrow' : new Date(baseDate.getTime() + 86400000).toLocaleDateString([], { weekday: 'long' });

        const trendData = [
            { label: `${yestLabel} (${yest.toLocaleDateString([], {month:'short', day:'numeric'})})${yestInForecast ? ' (Est.)' : ''}`, high: yestHigh, low: yestLow, diff: yestHigh - todayHigh, isReverse: true, date: yest },
            { label: `${lyLabel} (${ly.toLocaleDateString([], {month:'short', day:'numeric'})})`, high: lyHigh, low: lyLow, diff: lyHigh - todayHigh, isReverse: true, date: ly },
            { label: `${tomLabel} (${new Date(baseDate.getTime() + 86400000).toLocaleDateString([], {month:'short', day:'numeric'})}) (Est.)`, high: tomorrowHigh, low: tomorrowLow, diff: tomorrowHigh - todayHigh, isForward: true, date: new Date(baseDate.getTime() + 86400000) }
        ];

        const toDisplay = (f) => CURRENT_UNITS === 'F' ? f : Math.round((f - 32) * 5/9);
        const toDiffDisplay = (fDiff) => CURRENT_UNITS === 'F' ? fDiff : Math.round(fDiff / 1.8);

        trendData.forEach(d => {
            const el = document.createElement('div');
            el.className = 'trend-card clickable';
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            el.style.alignItems = 'center';
            el.style.cursor = 'pointer';
            LayoutEngine.applyCardStyle(el);
            
            const diff = d.diff;
            const diffVal = toDiffDisplay(Math.abs(diff));
            let text = '';
            if (diff > 0) text = `${diffVal}° hotter`;
            else if (diff < 0) text = `${diffVal}° cooler`;
            else text = 'Same';

            const badgeCls = diff > 0 ? 'hotter' : diff < 0 ? 'cooler' : '';
            
            const displayHigh = toDisplay(d.high);
            const displayLow = toDisplay(d.low);

            el.innerHTML = `
                <span style="font-size:0.7rem; color:var(--text-secondary); text-align:center; min-height: 2em;">${d.label}</span>
                <div style="display:flex; align-items: baseline; gap: 6px; margin: 4px 0;">
                    <span style="font-size:1.5rem; font-weight:700;">${displayHigh}°</span>
                    <span style="font-size:1rem; opacity:0.5; font-weight:400;">${displayLow}°</span>
                </div>
                <span class="diff-badge small ${badgeCls}" style="font-size:0.6rem; padding:2px 8px; border-radius:10px; background:rgba(255,255,255,0.1);">${text}</span>
            `;
            
            el.onclick = () => {
                updateAppFocus({ 
                    temperature: d.high, 
                    shortForecast: d.label.split(' ')[0] + ' Peak',
                    date: d.date
                }, !d.isForward && d.label.includes('In')); // Historical only for "Last Year"
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
    // Render from cache — includes trends if available
    const { current, hourly, daily, lat, lon, trendParams } = data;
    if (current) INITIAL_STATE = current;
    if (lat) { CURRENT_LAT = lat; CURRENT_LON = lon; }
    renderWeather(current, hourly);
    renderDailyForecast(daily);
    if (trendParams && lat) {
        const { high, low, tomorrowHigh, tomorrowLow } = trendParams;
        fetchTrends(lat, lon, high, low, tomorrowHigh, tomorrowLow);
    }
}

init();
