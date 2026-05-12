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
    // Safe text setter
    set(key, val) {
        if (this[key]) this[key].textContent = val;
    }
};

class LayoutEngine {
    static applyGrid(container, items, options = { columns: 3 }) {
        const cols = options.columns;
        container.style.display = 'grid';
        container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        container.style.gap = '8px';
        container.style.width = '100%';
        container.style.maxWidth = '100%';
        container.style.boxSizing = 'border-box';
        container.style.overflow = 'hidden';
        
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
        el.style.backdropFilter = THEME.glass.blur;
        el.style.webkitBackdropFilter = THEME.glass.blur;
        el.style.border = THEME.glass.border;
        el.style.borderRadius = `${THEME.spacing.radius}px`;
        el.style.padding = `${THEME.spacing.padding}px`;
        el.style.boxShadow = THEME.glass.shadow;
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.gap = '8px';
        el.style.transition = 'transform 0.3s ease';
    }

    static applyScrollSafeZone(container) {
        if (!container) return;
        container.style.paddingTop = '12px';
        container.style.paddingBottom = '16px';
        container.style.marginTop = '-12px';
        container.style.width = '100%';
        container.style.maxWidth = '100%';
        container.style.overflowX = 'auto';
        container.style.overflowY = 'hidden';
        container.style.boxSizing = 'border-box';
        container.style.flexShrink = '0'; // The SCROLLER doesn't shrink, its PARENT clips it
        
        // Ensure child items don't stretch the scroller beyond reason
        [...container.children].forEach(child => {
            child.style.flexShrink = '0';
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
        container.style.maxWidth = '100%';
        container.style.overflow = 'hidden';
        
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

    static generateNarrative(current, yesterday, tomorrow) {
        const diffY = current - yesterday;
        const diffT = tomorrow - current;
        
        let story = `**Meteorological Briefing:** Today's peak of **${current}°F** `;
        if (Math.abs(diffY) < 2) story += `matches yesterday's trend. `;
        else if (diffY > 0) story += `is a **${Math.abs(diffY)}° spike** from yesterday. `;
        else story += `is a **${Math.abs(diffY)}° cooling** from yesterday. `;
        
        if (diffT > 3) story += `Prepare for further heating tomorrow as the trend continues upward.`;
        else if (diffT < -3) story += `Expect relief soon—tomorrow's forecast shows a cooling trend.`;
        else story += `Stable conditions expected to persist through the next 24 hours.`;
        
        return story;
    }
}

let ALL_HOURLY_DATA = [];
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
            renderWeather(currentPeriod, ALL_HOURLY_DATA);
            updateTheme(currentTemp, currentPeriod.shortForecast);
        }
        
        if (dailyData.properties.periods) {
            renderDailyForecast(dailyData.properties.periods);
        }

        fetchAlerts(lat, lon);
        
        if (ALL_HOURLY_DATA.length > 0 && dailyData.properties.periods) {
            const tomorrowTemp = dailyData.properties.periods[1]?.temperature || ALL_HOURLY_DATA[0].temperature;
            const yesterdayTemp = ALL_HOURLY_DATA[0].temperature - 5; // Fallback calculation for story
            
            // Inject Pretext Narrative
            const narrativeEl = document.getElementById('narrative-briefing');
            if (narrativeEl) {
                narrativeEl.style.display = 'block';
                narrativeEl.innerHTML = LayoutEngine.generateNarrative(ALL_HOURLY_DATA[0].temperature, yesterdayTemp, tomorrowTemp);
            }
            
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
        LayoutEngine.applyCardStyle(item);
        const time = new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' });
        item.innerHTML = `
            <span class="hourly-time">${time}</span>
            <img src="${period.icon}" alt="icon" style="width:32px;">
            <span class="temp">${period.temperature}°</span>
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

    grouped.forEach((day, index) => {
        const item = document.createElement('div');
        item.className = 'forecast-item clickable';
        if (index === 0) item.classList.add('selected');
        const mainP = day.day || day.night;
        item.innerHTML = `
            <span style="font-weight: 700;">${day.name}</span>
            <span style="font-size: 0.7rem; opacity: 0.6;">${day.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            <img src="${mainP.icon}" alt="icon" style="width:32px;">
            <div style="display:flex; gap: 4px; align-items: baseline;">
                <span class="temp">${mainP.temperature}°</span>
                ${day.night ? `<span style="font-size: 0.75rem; opacity: 0.4;">${day.night.temperature}°</span>` : ''}
            </div>
        `;
        item.onclick = () => {
            document.querySelectorAll('.forecast-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            updateAppFocus(day);
        };
        UI.daily.appendChild(item);
    });

    // Apply Pretext safe-zone logic to prevent clipping
    LayoutEngine.applyScrollSafeZone(UI.daily);
    UI.daily.style.display = 'flex';
    UI.daily.style.flexWrap = 'nowrap';
}

function updateAppFocus(dayObj) {
    const main = dayObj.day || dayObj.night;
    if (!main) return;
    UI.set('temp', `${main.temperature}°`);
    UI.set('desc', main.shortForecast);
    UI.set('wind', `${main.windSpeed} ${main.windDirection}`);
    UI.set('humidity', `${main.relativeHumidity?.value || '--'}%`);
    UI.set('date', dayObj.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    UI.set('feelsLike', dayObj.night ? `${dayObj.night.temperature}° (Low)` : `${main.temperature}°`);
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

async function fetchTrends(lat, lon, currentTemp, tomorrowTemp) {
    if (!UI.trends.container) return;
    try {
        const now = new Date();
        const yest = new Date(now); yest.setDate(now.getDate() - 1);
        const ly = new Date(now); ly.setFullYear(now.getFullYear() - 1);

        const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${ly.toISOString().split('T')[0]}&end_date=${yest.toISOString().split('T')[0]}&daily=temperature_2m_max&temperature_unit=fahrenheit`);
        const data = await res.json();
        const yestT = Math.round(data.daily.temperature_2m_max[data.daily.temperature_2m_max.length - 1]);
        const lyT = Math.round(data.daily.temperature_2m_max[0]);

        UI.trends.container.innerHTML = '';
        UI.trends.items = [];

        const trendData = [
            { label: `Yesterday (${yest.toLocaleDateString([], {month:'short', day:'numeric'})})`, temp: yestT, diff: currentTemp - yestT },
            { label: `In ${ly.getFullYear()} (${ly.toLocaleDateString([], {month:'short', day:'numeric'})})`, temp: lyT, diff: currentTemp - lyT },
            { label: 'Tomorrow', temp: tomorrowTemp, diff: tomorrowTemp - currentTemp, isForward: true }
        ];

        trendData.forEach(d => {
            const el = document.createElement('div');
            const diff = d.diff;
            const text = diff > 0 ? `+${diff}° hotter` : diff < 0 ? `${Math.abs(diff)}° cooler` : 'Same';
            const badgeCls = diff > 0 ? 'hotter' : diff < 0 ? 'cooler' : '';
            
            el.innerHTML = `
                <span style="font-size:0.7rem; color:var(--text-secondary); text-align:center;">${d.label}</span>
                <span style="font-size:1.5rem; font-weight:700;">${d.temp}°</span>
                <span class="diff-badge small ${badgeCls}" style="font-size:0.6rem; padding:2px 8px; border-radius:10px; background:rgba(255,255,255,0.1);">${text}</span>
            `;
            UI.trends.container.appendChild(el);
            UI.trends.items.push(el);
        });

        LayoutEngine.applyGrid(UI.trends.container, UI.trends.items);
        UI.trends.container.style.display = 'grid';
    } catch (e) {}
}

function updateLoading(msg) { if (UI.state) UI.state.innerHTML = `<div class="spinner"></div><p>${msg}</p>`; }
function showError(msg) { if (UI.state) UI.state.innerHTML = `<div class="error-view">⚠️ <p>${msg}</p><button class="btn" onclick="location.reload()">Retry</button></div>`; }

init();
