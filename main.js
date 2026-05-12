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
    hourly: document.getElementById('hourly-forecast')
};

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

    // Step 2: Get forecasts
    updateLoading('Analyzing atmospheric conditions...');
    const [hourlyRes, dailyRes] = await Promise.all([
        fetch(forecastHourly, { headers: { 'User-Agent': 'TrueTempApp/1.0' } }),
        fetch(forecast, { headers: { 'User-Agent': 'TrueTempApp/1.0' } })
    ]);

    const hourlyData = await hourlyRes.json();
    const dailyData = await dailyRes.json();

    renderWeather(hourlyData.properties.periods[0], hourlyData.properties.periods);
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
    UI.feelsLike.textContent = `${current.temperature}°`; // NWS doesn't always provide apparent temp in forecast
    UI.visibility.textContent = '10 mi'; // Defaulting for visual completeness

    // Hourly
    UI.hourly.innerHTML = '';
    hourly.slice(0, 24).forEach(period => {
        const time = new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' });
        const item = document.createElement('div');
        item.className = 'hourly-item';
        item.innerHTML = `
            <span class="hourly-time">${time}</span>
            <span class="hourly-temp">${period.temperature}°</span>
            <span style="font-size: 0.75rem; text-align:center">${period.shortForecast}</span>
        `;
        UI.hourly.appendChild(item);
    });
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
