import AntigravityTestingAPI from './ata.js';
const ata = new AntigravityTestingAPI('SkyCast');

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
    trends: {
        container: document.getElementById('trends-container'),
        items: []
    },
    high: document.getElementById('today-high'),
    low: document.getElementById('today-low'),
    // Safe text setter
    set(key, val) {
        if (this[key]) this[key].textContent = val;
    }
};

class LayoutEngine {
    static applyGrid(container, items, options = { columns: 3 }) {
        if (!container) return;
        const cols = options.columns;
        container.style.display = 'grid';
        container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        container.style.gap = '8px';
        container.style.width = '100%';
        container.style.maxWidth = '100%';
        container.style.boxSizing = 'border-box';
        
        items.forEach(item => {
            item.style.minWidth = '0';
            item.style.width = '100%';
            item.style.boxSizing = 'border-box';
            item.style.flexShrink = '1';
            this.applyCardStyle(item);
        });
    }

    static applyCardStyle(el) {
        if (!el) return;
        el.style.background = THEME.glass.bg;
        el.style.border = THEME.glass.border;
        el.style.backdropFilter = THEME.glass.blur;
        el.style.webkitBackdropFilter = THEME.glass.blur;
        el.style.borderRadius = `${THEME.spacing.radius}px`;
        el.style.padding = `${THEME.spacing.padding}px`;
        el.style.boxShadow = THEME.glass.shadow;
        el.style.overflow = 'hidden';
        el.style.width = '100%';
        el.style.maxWidth = '100%';
        el.style.minWidth = '0';
        el.style.boxSizing = 'border-box';
        el.style.display = 'block';
        el.style.transition = 'transform 0.3s ease';
    }

    static applyScrollSafeZone(container) {
        if (!container) return;
        container.style.width = '100%';
        container.style.maxWidth = '100%';
        container.style.display = 'flex';
        container.style.gap = '1rem';
        container.style.overflowX = 'scroll';
        container.style.overflowY = 'hidden';
        container.style.scrollbarWidth = 'none';
        container.style.webkitOverflowScrolling = 'touch';
        container.style.touchAction = 'pan-x pan-y';
        container.style.scrollSnapType = 'x mandatory';
        container.style.justifyContent = 'flex-start';
        container.style.flexShrink = '1';
        container.style.minWidth = '0';
        container.style.contain = 'layout';
        container.style.scrollPadding = '1rem';
        container.style.padding = '12px 16px';
        
        // Ensure child items don't stretch the scroller beyond reason
        [...container.children].forEach(child => {
            child.style.scrollSnapAlign = 'start';
            child.style.flexShrink = '0';
            child.style.width = '100px';
            child.style.minWidth = '100px';
            child.style.flexBasis = 'auto';
        });
    }

    static applyHeroStyle(container) {
        if (!container) return;
        const width = window.innerWidth;
        const isMobile = width < 640;
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.textAlign = 'center';
        container.style.padding = isMobile ? '1rem 0' : '2rem 1rem';
        container.style.gap = isMobile ? '0.2rem' : '0.5rem';
        container.style.width = '100%';
        container.style.maxWidth = '500px';
        container.style.margin = '0 auto';
        container.style.overflowX = 'hidden';
        
        const tempEl = container.querySelector('.temperature');
        if (tempEl) {
            // Precise font scaling: 4rem for mobile, 6rem for desktop
            tempEl.style.fontSize = isMobile ? '4rem' : '6rem';
            tempEl.style.lineHeight = '1';
            tempEl.style.margin = '0.5rem 0';
        }
    }

    static mount(id, type, items, options) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = type === 'grid' ? 'grid' : 'flex';
        if (type === 'grid') this.applyGrid(el, items, options);
        else if (type === 'scroll') this.applyScrollSafeZone(el);
        else if (type === 'hero') this.applyHeroStyle(el);
    }
}

let ALL_HOURLY_DATA = [];
let INITIAL_STATE = null;
const NWS_API = 'https://api.weather.gov';

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
        updateLoading('Fetching local grid data...');
        const t = Date.now();
        
        const pointsRes = await fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`, {
            headers: { 'User-Agent': 'TrueTempApp/1.0' },
            cache: 'reload'
        });
        
        if (!pointsRes.ok) throw new Error('Weather Service unavailable.');
        const pointsData = await pointsRes.json();
        
        const { forecast, forecastHourly, relativeLocation } = pointsData.properties;
        const { city, state } = relativeLocation.properties;

        UI.set('city', `${city}, ${state}`);
        UI.set('date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
        UI.set('updated', `Updated: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);

        updateLoading('Analyzing atmospheric conditions...');
        const [hourlyRes, dailyRes, stationsRes] = await Promise.all([
            fetch(forecastHourly, { headers: { 'User-Agent': 'TrueTempApp/1.0' }, cache: 'reload' }),
            fetch(forecast, { headers: { 'User-Agent': 'TrueTempApp/1.0' }, cache: 'reload' }),
            fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}/stations`, { 
                headers: { 'User-Agent': 'TrueTempApp/1.0' }, 
                cache: 'reload' 
            })
        ]);

        if (!hourlyRes.ok || !dailyRes.ok) throw new Error('Forecast unavailable.');

        const hourlyData = await hourlyRes.json();
        const dailyData = await dailyRes.json();
        
        let currentTemp = hourlyData.properties.periods[0].temperature;
        
        try {
            if (stationsRes.ok) {
                const stationsData = await stationsRes.json();
                const stationId = stationsData.features[0]?.properties?.stationIdentifier;
                const cityEl = document.getElementById('city-name');
                if (cityEl) cityEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg> <span>${city}, ${state}</span><div style="font-size:0.6rem; opacity:0.6; font-family:monospace; margin-top:2px;">${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}</div>`;
                const stationEl = document.getElementById('station-info');
                if (stationEl) stationEl.textContent = `NWS Station: ${stationId}`;
                
                if (stationId) {
                    const obsRes = await fetch(`${NWS_API}/stations/${stationId}/observations/latest`, {
                        headers: { 'User-Agent': 'TrueTempApp/1.0' },
                        cache: 'reload'
                    });
                    if (obsRes.ok) {
                        const obsData = await obsRes.json();
                        const celsius = obsData.properties.temperature.value;
                        if (celsius !== null) {
                            currentTemp = Math.round((celsius * 9/5) + 32);
                        }
                    }
                }
            }
        } catch (e) {}

        ALL_HOURLY_DATA = hourlyData.properties.periods || [];

        if (ALL_HOURLY_DATA.length > 0) {
            const currentPeriod = { ...ALL_HOURLY_DATA[0], temperature: currentTemp };
            INITIAL_STATE = currentPeriod;
            renderWeather(currentPeriod, ALL_HOURLY_DATA);
            updateTheme(currentTemp, currentPeriod.shortForecast);
        }
        
        if (dailyData.properties.periods) {
            const periods = dailyData.properties.periods;
            // Scan first 3 periods to find the true High and Low for the current 24h window
            const relevant = periods.slice(0, 3);
            const temps = relevant.map(p => p.temperature);
            const high = Math.max(...temps);
            const low = Math.min(...temps);
            
            UI.set('high', `${high}°`);
            UI.set('low', `${low}°`);
            renderDailyForecast(periods);

            // Fetch trends comparing today's HIGH to others
            const tomorrowTemp = periods[1].temperature; // Next day period
            fetchTrends(lat, lon, high, tomorrowTemp);
        }

        fetchAlerts(lat, lon);
        
    } catch (error) {
        showError(error.message);
    }
}

function renderWeather(current, hourly) {
    if (!current) return;
    if (UI.state) UI.state.style.display = 'none';
    if (UI.content) {
        LayoutEngine.applyHeroStyle(UI.content);
        UI.content.style.display = 'flex';
    }
    UI.set('temp', `${current.temperature}°`);
    UI.set('desc', current.shortForecast);
    UI.set('wind', `${current.windSpeed} ${current.windDirection}`);
    UI.set('humidity', `${current.relativeHumidity?.value || '--'}%`);
    UI.set('feelsLike', `${current.temperature}°`);
    UI.set('visibility', '10 mi');
    
    // Inject 2-column info grid logic
    const infoGrid = document.querySelector('.info-grid');
    if (infoGrid) {
        infoGrid.style.display = 'grid';
        infoGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        infoGrid.style.gap = '10px';
        infoGrid.querySelectorAll('.info-item').forEach(item => {
            LayoutEngine.applyCardStyle(item);
            item.style.padding = '12px';
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
        item.innerHTML = `
            <span style="font-size: 0.8rem; font-weight: 600; opacity: 0.8;">${time}</span>
            <img src="${period.icon}" alt="icon" style="width:32px; margin: 8px 0;">
            <span class="temp" style="font-weight: 700;">${period.temperature}°</span>
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
        item.innerHTML = `
            <span style="font-weight: 700; font-size: 0.9rem;">${day.name}</span>
            <span style="font-size: 0.7rem; opacity: 0.6;">${day.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            <img src="${mainP.icon}" alt="icon" style="width:32px; margin: 8px 0;">
            <div style="display:flex; gap: 4px; align-items: baseline; justify-content: center;">
                <span class="temp" style="font-weight: 700;">${mainP.temperature}°</span>
                ${day.night ? `<span style="font-size: 0.75rem; opacity: 0.4;">${day.night.temperature}°</span>` : ''}
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
    
    UI.set('temp', `${main.temperature}°`);
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
    THEME.accent = accent;
}

async function fetchTrends(lat, lon, todayHigh, tomorrowHigh) {
    if (!UI.trends.container) return;
    const cacheBust = Date.now();
    try {
        const now = new Date();
        const yest = new Date(now); yest.setDate(now.getDate() - 1);
        const ly = new Date(now); ly.setFullYear(now.getFullYear() - 1);

        const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${ly.toISOString().split('T')[0]}&end_date=${yest.toISOString().split('T')[0]}&daily=temperature_2m_max&temperature_unit=fahrenheit&cb=${cacheBust}`);
        const data = await res.json();
        const yestHigh = Math.round(data.daily.temperature_2m_max[data.daily.temperature_2m_max.length - 1]);
        const lyHigh = Math.round(data.daily.temperature_2m_max[0]);

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

function updateLoading(msg) { if (UI.state) UI.state.innerHTML = `<div class="spinner"></div><p>${msg}</p>`; }
function showError(msg) { if (UI.state) UI.state.innerHTML = `<div class="error-view">⚠️ <p>${msg}</p><button class="btn" onclick="location.reload()">Retry</button></div>`; }

init();
