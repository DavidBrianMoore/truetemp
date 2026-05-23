import AntigravityTestingAPI from './ata.js';
import { APP_VERSION } from './version.js';
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

// Map State Variables
let leafletMap = null;
let mapMarkersGroup = null;
let mapCenterMarker = null;
let mapUpdateCounter = 0;
let activePopupLatLng = null;
let isRedrawingMarkers = false;

// Meteorological Settings
let PRIMARY_SOURCE = localStorage.getItem('primary_source') || 'auto';
let MAP_FILTER = localStorage.getItem('map_filter') || 'all';

// High-Performance Map Telemetry Cache & Queue Manager
const MAP_TELEMETRY_CACHE = new Map(); // key: "gridCell" -> Array of marker objects
const MAP_FETCHING_SET = new Set();    // Coordinates currently in-flight to prevent redundant queries

/**
 * Indexes coordinates into high-density ~2.5 mile grid cells (0.04 degrees)
 */
const getGridCellKey = (lat, lon) => {
    const step = 0.04;
    return `${Math.round(lat / step)},${Math.round(lon / step)}`;
};

// Global callback for map popup button selections
window.__selectMapLocation = async (lat, lon, name) => {
    // 1. Instantly disable other select actions and show button activity
    document.querySelectorAll('.popup-select-btn').forEach(btn => {
        btn.disabled = true;
        btn.textContent = '⚡ LOADING...';
        btn.style.opacity = '0.7';
    });
    
    // 2. Instantly dim the dashboard content to convey immediate feedback
    if (UI.content) {
        UI.content.style.opacity = '0.4';
        UI.content.style.pointerEvents = 'none';
        UI.content.style.transition = 'opacity 0.4s ease';
    }
    if (UI.state) {
        UI.state.style.display = 'flex';
        updateLoading(`Connecting to atmosphere at ${name}...`);
    }
    
    // 3. Smooth scroll to top instantly
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // 4. Fetch the weather data with the geocoded city name pre-set
    try {
        await fetchWeatherData(lat, lon, null, name);
    } catch (e) {
        console.error('Failed to select map location:', e);
    } finally {
        // 5. Restore full opacity and interactivity
        if (UI.content) {
            UI.content.style.opacity = '1';
            UI.content.style.pointerEvents = 'auto';
        }
        if (UI.state) {
            UI.state.style.display = 'none';
        }
    }
};

// Saved Locations (Favorites) State Manager
let FAVORITES = JSON.parse(localStorage.getItem('favorites') || '[]');

function updateFavoriteStar() {
    const btn = document.getElementById('favorite-btn');
    if (!btn) return;
    const isFav = FAVORITES.some(f => Math.abs(f.lat - CURRENT_LAT) < 0.01 && Math.abs(f.lon - CURRENT_LON) < 0.01);
    if (isFav) {
        btn.textContent = '★';
        btn.style.color = '#fbbf24'; // Solid Gold
        btn.title = 'Remove from Saved Locations';
    } else {
        btn.textContent = '☆';
        btn.style.color = 'rgba(255,255,255,0.4)';
        btn.title = 'Save to Saved Locations';
    }
}

function renderFavorites() {
    const bar = document.getElementById('favorites-bar');
    const list = document.getElementById('favorites-list');
    if (!bar || !list) return;
    
    list.innerHTML = '';
    if (FAVORITES.length === 0) {
        bar.style.display = 'none';
        return;
    }
    
    FAVORITES.forEach((fav, idx) => {
        const chip = document.createElement('div');
        chip.className = 'favorite-chip glass-card clickable';
        chip.style.display = 'flex';
        chip.style.alignItems = 'center';
        chip.style.gap = '6px';
        chip.style.padding = '6px 12px';
        chip.style.borderRadius = '20px';
        chip.style.fontSize = '0.78rem';
        chip.style.fontWeight = '600';
        chip.style.background = 'rgba(255,255,255,0.04)';
        chip.style.border = '1px solid rgba(255,255,255,0.08)';
        chip.style.color = 'var(--text-primary)';
        
        chip.innerHTML = `
            ${idx > 0 ? `<span class="fav-move-left" style="color:var(--accent); opacity:0.5; cursor:pointer; font-size:0.95rem; padding:0 3px; font-weight:700; transition:all 0.2s; display:inline-flex; align-items:center;" title="Move left">‹</span>` : ''}
            <span class="fav-name-click" style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                ⭐ <span>${fav.name}</span>
            </span>
            ${idx < FAVORITES.length - 1 ? `<span class="fav-move-right" style="color:var(--accent); opacity:0.5; cursor:pointer; font-size:0.95rem; padding:0 3px; font-weight:700; transition:all 0.2s; display:inline-flex; align-items:center;" title="Move right">›</span>` : ''}
            <span class="fav-remove" style="color:rgba(255,255,255,0.3); font-weight:800; cursor:pointer; padding: 0 2px; transition:color 0.2s;" title="Remove saved location">✕</span>
        `;
        
        chip.querySelector('.fav-name-click').onclick = (e) => {
            e.stopPropagation();
            updateLoading(`Loading saved location: ${fav.name}...`);
            fetchWeatherData(fav.lat, fav.lon, null, fav.name);
        };
        
        if (idx > 0) {
            chip.querySelector('.fav-move-left').onclick = (e) => {
                e.stopPropagation();
                const temp = FAVORITES[idx];
                FAVORITES[idx] = FAVORITES[idx - 1];
                FAVORITES[idx - 1] = temp;
                localStorage.setItem('favorites', JSON.stringify(FAVORITES));
                renderFavorites();
            };
        }
        
        if (idx < FAVORITES.length - 1) {
            chip.querySelector('.fav-move-right').onclick = (e) => {
                e.stopPropagation();
                const temp = FAVORITES[idx];
                FAVORITES[idx] = FAVORITES[idx + 1];
                FAVORITES[idx + 1] = temp;
                localStorage.setItem('favorites', JSON.stringify(FAVORITES));
                renderFavorites();
            };
        }
        
        chip.querySelector('.fav-remove').onclick = (e) => {
            e.stopPropagation();
            FAVORITES = FAVORITES.filter(f => !(f.lat === fav.lat && f.lon === fav.lon));
            localStorage.setItem('favorites', JSON.stringify(FAVORITES));
            renderFavorites();
            updateFavoriteStar();
        };
        
        list.appendChild(chip);
    });
    bar.style.display = 'block';
}

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

    // Set Version Text Displays
    const footerVer = document.getElementById('app-version-footer');
    const settingsVer = document.getElementById('settings-version-id');
    if (footerVer) footerVer.textContent = APP_VERSION;
    if (settingsVer) settingsVer.textContent = APP_VERSION;

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

    // Map full-screen/resize listener
    const mapResizeBtn = document.getElementById('map-resize-btn');
    const mapSection = document.getElementById('map-section');
    const mapBtnIcon = document.getElementById('map-btn-icon');
    const mapBtnText = document.getElementById('map-btn-text');
    
    if (mapResizeBtn && mapSection) {
        mapResizeBtn.addEventListener('click', () => {
            const isFull = mapSection.classList.toggle('fullscreen');
            document.body.classList.toggle('map-fullscreen-active', isFull);
            if (isFull) {
                if (mapBtnIcon) mapBtnIcon.textContent = '✕';
                if (mapBtnText) mapBtnText.textContent = 'Minimize Map';
                document.body.style.overflow = 'hidden'; // Disable page scrolling
            } else {
                if (mapBtnIcon) mapBtnIcon.textContent = '⛶';
                if (mapBtnText) mapBtnText.textContent = 'Expand Map';
                document.body.style.overflow = ''; // Re-enable page scrolling
            }
            // Invalidate size immediately so Leaflet redraws correctly
            if (leafletMap) {
                setTimeout(() => {
                    leafletMap.invalidateSize();
                }, 300); // Wait for transition
            }
        });
    }

    // Favorite button click listener
    const favoriteBtn = document.getElementById('favorite-btn');
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', () => {
            const isFav = FAVORITES.some(f => Math.abs(f.lat - CURRENT_LAT) < 0.01 && Math.abs(f.lon - CURRENT_LON) < 0.01);
            if (isFav) {
                FAVORITES = FAVORITES.filter(f => !(Math.abs(f.lat - CURRENT_LAT) < 0.01 && Math.abs(f.lon - CURRENT_LON) < 0.01));
            } else {
                FAVORITES.push({
                    name: UI.city.textContent || 'Saved Location',
                    lat: CURRENT_LAT,
                    lon: CURRENT_LON
                });
            }
            localStorage.setItem('favorites', JSON.stringify(FAVORITES));
            renderFavorites();
            updateFavoriteStar();
        });
    }

    // Initial render of saved locations
    renderFavorites();

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

    // Settings Modal Triggers
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings');
    const primarySourceSelect = document.getElementById('setting-primary-source');
    const mapFilterSelect = document.getElementById('setting-map-filter');

    if (settingsBtn && settingsModal && closeSettings && primarySourceSelect && mapFilterSelect) {
        primarySourceSelect.value = PRIMARY_SOURCE;
        mapFilterSelect.value = MAP_FILTER;

        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            settingsModal.style.display = 'flex';
        });

        closeSettings.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });

        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });

        primarySourceSelect.addEventListener('change', async () => {
            PRIMARY_SOURCE = primarySourceSelect.value;
            localStorage.setItem('primary_source', PRIMARY_SOURCE);
            if (CURRENT_LAT !== null && CURRENT_LON !== null) {
                updateLoading('Re-routing atmospheric feed...');
                await fetchWeatherData(CURRENT_LAT, CURRENT_LON);
            }
        });

        mapFilterSelect.addEventListener('change', () => {
            MAP_FILTER = mapFilterSelect.value;
            localStorage.setItem('map_filter', MAP_FILTER);
            if (CURRENT_LAT !== null && CURRENT_LON !== null) {
                updateMap(CURRENT_LAT, CURRENT_LON);
            }
        });
    }

    // Sensor vs Forecast Explanation Modal Triggers
    const explanationBtn = document.getElementById('station-explanation-btn');
    const explanationModal = document.getElementById('explanation-modal');
    const closeExplanation = document.getElementById('close-explanation');
    const explanationStationId = document.getElementById('explanation-station-id');

    if (explanationBtn && explanationModal && closeExplanation) {
        explanationBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (explanationStationId) {
                const currentStationText = document.getElementById('station-info')?.textContent || '--';
                explanationStationId.textContent = currentStationText.replace('Station:', '').replace('Source:', '').trim();
            }
            explanationModal.style.display = 'flex';
        });

        closeExplanation.addEventListener('click', () => {
            explanationModal.style.display = 'none';
        });

        explanationModal.addEventListener('click', (e) => {
            if (e.target === explanationModal) {
                explanationModal.style.display = 'none';
            }
        });
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

function getWindDirectionCompass(deg) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(deg / 22.5) % 16;
    return directions[idx];
}

async function fetchOpenMeteoWeatherData(lat, lon, customCityName = null) {
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,visibility&hourly=temperature_2m,weather_code,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=10`;
    
    updateLoading('Fetching international atmosphere grid...');
    const res = await fetch(meteoUrl);
    if (!res.ok) throw new Error('Open-Meteo API is currently offline.');
    const data = await res.json();
    
    let cityName = customCityName || `Coordinates: ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    if (!customCityName) {
        try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`);
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                const addr = geoData.address;
                cityName = addr.city || addr.town || addr.village || addr.municipality || addr.county || cityName;
                if (addr.state) cityName += `, ${addr.state}`;
                else if (addr.country) cityName += `, ${addr.country}`;
            }
        } catch (e) {
            console.warn('Reverse geocoding failed, using default coordinate labels.');
        }
    }
    
    const currentMapped = {
        temperature: Math.round(data.current.temperature_2m),
        shortForecast: getWeatherDescriptionFromCode(data.current.weather_code),
        windSpeed: `${Math.round(data.current.wind_speed_10m)} mph`,
        windDirection: getWindDirectionCompass(data.current.wind_direction_10m),
        relativeHumidity: { value: Math.round(data.current.relative_humidity_2m) },
        visibility: `${(data.current.visibility / 1609.34).toFixed(1)} mi`,
        probabilityOfPrecipitation: { value: Math.round(data.hourly.precipitation_probability[0] || 0) }
    };
    
    const hourlyMapped = data.hourly.time.slice(0, 24).map((time, idx) => {
        return {
            startTime: time,
            temperature: Math.round(data.hourly.temperature_2m[idx]),
            shortForecast: getWeatherDescriptionFromCode(data.hourly.weather_code[idx])
        };
    });
    
    const dailyMapped = [];
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    data.daily.time.forEach((dateStr, idx) => {
        const date = new Date(dateStr + 'T00:00:00');
        const dayName = idx === 0 ? 'Today' : weekdays[date.getDay()];
        dailyMapped.push({
            startTime: `${dateStr}T08:00:00`,
            name: dayName,
            isDaytime: true,
            temperature: Math.round(data.daily.temperature_2m_max[idx]),
            shortForecast: getWeatherDescriptionFromCode(data.daily.weather_code[idx])
        });
        dailyMapped.push({
            startTime: `${dateStr}T20:00:00`,
            name: `${dayName} Night`,
            isDaytime: false,
            temperature: Math.round(data.daily.temperature_2m_min[idx]),
            shortForecast: getWeatherDescriptionFromCode(data.daily.weather_code[idx])
        });
    });
    
    return {
        cityName,
        current: currentMapped,
        hourly: hourlyMapped,
        daily: dailyMapped
    };
}

function cleanMetNorwaySymbol(symbol) {
    if (!symbol) return 'Clear';
    const base = symbol.split('_')[0].toLowerCase();
    const maps = {
        clearsky: 'Clear Sky',
        fair: 'Fair',
        partlycloudy: 'Partly Cloudy',
        cloudy: 'Cloudy',
        lightrainshowers: 'Light Rain Showers',
        rainshowers: 'Rain Showers',
        heavyrainshowers: 'Heavy Rain Showers',
        lightrainshowersthunder: 'Light Rain Showers with Thunder',
        rainshowersthunder: 'Rain Showers with Thunder',
        heavyrainshowersthunder: 'Heavy Rain Showers with Thunder',
        lightsleetshowers: 'Light Sleet Showers',
        sleetshowers: 'Sleet Showers',
        heavysleetshowers: 'Heavy Sleet Showers',
        lightsleetshowersthunder: 'Light Sleet Showers with Thunder',
        sleetshowersthunder: 'Sleet Showers with Thunder',
        heavysleetshowersthunder: 'Heavy Sleet Showers with Thunder',
        lightsnowshowers: 'Light Snow Showers',
        snowshowers: 'Snow Showers',
        heavysnowshowers: 'Heavy Snow Showers',
        lightsnowshowersthunder: 'Light Snow Showers with Thunder',
        snowshowersthunder: 'Snow Showers with Thunder',
        heavysnowshowersthunder: 'Heavy Snow Showers with Thunder',
        lightrain: 'Light Rain',
        rain: 'Rain',
        heavyrain: 'Heavy Rain',
        lightrainthunder: 'Light Rain with Thunder',
        rainthunder: 'Rain with Thunder',
        heavyrainthunder: 'Heavy Rain with Thunder',
        lightsleet: 'Light Sleet',
        sleet: 'Sleet',
        heavysleet: 'Heavy Sleet',
        lightsleetthunder: 'Light Sleet with Thunder',
        sleetthunder: 'Sleet with Thunder',
        heavysleetthunder: 'Heavy Sleet with Thunder',
        lightsnow: 'Light Snow',
        snow: 'Snow',
        heavysnow: 'Heavy Snow',
        lightsnowthunder: 'Light Snow with Thunder',
        snowthunder: 'Snow with Thunder',
        heavysnowthunder: 'Heavy Snow with Thunder',
        fog: 'Fog'
    };
    if (maps[base]) return maps[base];
    return base.replace(/[-_]/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function fetchMetNorwayWeatherData(lat, lon, customCityName = null) {
    const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${Number(lat).toFixed(4)}&lon=${Number(lon).toFixed(4)}`;
    
    updateLoading('Fetching international forecast from MET Norway...');
    const res = await fetch(metUrl, { headers: HEADERS });
    if (!res.ok) throw new Error('MET Norway API is currently offline.');
    const data = await res.json();
    
    let cityName = customCityName || `Coordinates: ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    if (!customCityName) {
        try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`);
            if (geoRes.ok) {
                const geoData = await geoRes.json();
                const addr = geoData.address;
                cityName = addr.city || addr.town || addr.village || addr.municipality || addr.county || cityName;
                if (addr.state) cityName += `, ${addr.state}`;
                else if (addr.country) cityName += `, ${addr.country}`;
            }
        } catch (e) {
            console.warn('Reverse geocoding failed, using default coordinate labels.');
        }
    }
    
    const timeseries = data.properties.timeseries;
    if (!timeseries || timeseries.length === 0) throw new Error('No timeseries data found in MET Norway response.');
    
    const latest = timeseries[0];
    const tempC = latest.data.instant.details.air_temperature;
    const tempF = Math.round((tempC * 9/5) + 32);
    
    const symbol = latest.data.next_1_hours?.summary?.symbol_code || latest.data.next_6_hours?.summary?.symbol_code || 'clearsky_day';
    const windSpeedC = latest.data.instant.details.wind_speed; // in m/s
    const windSpeedMph = Math.round(windSpeedC * 2.23694);
    const windDir = latest.data.instant.details.wind_from_direction || 0;
    const humidity = latest.data.instant.details.relative_humidity || 0;
    
    const currentMapped = {
        temperature: tempF,
        shortForecast: cleanMetNorwaySymbol(symbol),
        windSpeed: `${windSpeedMph} mph`,
        windDirection: getWindDirectionCompass(windDir),
        relativeHumidity: { value: Math.round(humidity) },
        visibility: '10.0 mi', // MET Norway doesn't return horizontal visibility in compact
        probabilityOfPrecipitation: { value: Math.round(latest.data.next_1_hours?.details?.probability_of_precipitation || latest.data.next_6_hours?.details?.probability_of_precipitation || 0) }
    };
    
    const hourlyMapped = timeseries.slice(0, 24).map(ts => {
        const hTempC = ts.data.instant.details.air_temperature;
        const hTempF = Math.round((hTempC * 9/5) + 32);
        const hSymbol = ts.data.next_1_hours?.summary?.symbol_code || ts.data.next_6_hours?.summary?.symbol_code || 'clearsky_day';
        return {
            startTime: ts.time,
            temperature: hTempF,
            shortForecast: cleanMetNorwaySymbol(hSymbol)
        };
    });
    
    // Group by day for daily mapping
    const groups = {};
    timeseries.forEach(ts => {
        const dateStr = ts.time.split('T')[0];
        if (!groups[dateStr]) {
            groups[dateStr] = [];
        }
        groups[dateStr].push(ts);
    });
    
    const dailyMapped = [];
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dates = Object.keys(groups).sort();
    
    dates.forEach((dateStr, idx) => {
        const group = groups[dateStr];
        const temps = group.map(ts => ts.data.instant.details.air_temperature);
        const maxC = Math.max(...temps);
        const minC = Math.min(...temps);
        const maxF = Math.round((maxC * 9/5) + 32);
        const minF = Math.round((minC * 9/5) + 32);
        
        let daySymbol = 'clearsky_day';
        let nightSymbol = 'clearsky_night';
        
        group.forEach(ts => {
            const hour = new Date(ts.time).getUTCHours();
            const symbolCode = ts.data.next_1_hours?.summary?.symbol_code || ts.data.next_6_hours?.summary?.symbol_code;
            if (symbolCode) {
                if (hour >= 10 && hour <= 14) {
                    daySymbol = symbolCode;
                }
                if (hour >= 22 || hour <= 2) {
                    nightSymbol = symbolCode;
                }
            }
        });
        
        const date = new Date(dateStr + 'T00:00:00');
        const dayName = idx === 0 ? 'Today' : weekdays[date.getDay()];
        
        dailyMapped.push({
            startTime: `${dateStr}T08:00:00`,
            name: dayName,
            isDaytime: true,
            temperature: maxF,
            shortForecast: cleanMetNorwaySymbol(daySymbol)
        });
        dailyMapped.push({
            startTime: `${dateStr}T20:00:00`,
            name: `${dayName} Night`,
            isDaytime: false,
            temperature: minF,
            shortForecast: cleanMetNorwaySymbol(nightSymbol)
        });
    });
    
    return {
        cityName,
        current: currentMapped,
        hourly: hourlyMapped,
        daily: dailyMapped
    };
}

async function fetchWeatherData(lat, lon, stationId = null, customCityName = null) {
    if (lat === undefined || lon === undefined) return;
    CURRENT_LAT = lat;
    CURRENT_LON = lon;
    
    // Direct open-meteo provider bypass
    if (PRIMARY_SOURCE === 'open-meteo') {
        try {
            const data = await fetchOpenMeteoWeatherData(lat, lon, customCityName);
            UI.city.textContent = data.cityName;
            const stationEl = document.getElementById('station-info');
            if (stationEl) stationEl.textContent = 'Provider: Open-Meteo Grid';
            UI.set('date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
            UI.set('updated', `Updated: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
            
            if (UI.radarLink) {
                UI.radarLink.href = `https://zoom.earth/maps/radar/#c=${lat},${lon},8z`;
                UI.radarLink.textContent = 'View Zoom Earth Radar 📡';
            }
            
            ALL_HOURLY_DATA = data.hourly;
            ALL_DAILY_DATA = data.daily;
            INITIAL_STATE = data.current;
            
            renderWeather(data.current, data.hourly);
            updateTheme(data.current.temperature, data.current.shortForecast);
            
            const relevant = data.daily.slice(0, 3);
            const temps = relevant.map(p => p.temperature);
            const high = Math.max(...temps);
            const low = Math.min(...temps);
            
            const displayHigh = CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9);
            const displayLow = CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9);
            UI.set('high', `${displayHigh}°`);
            UI.set('low', `${displayLow}°`);
            renderDailyForecast(data.daily);
            
            const backgroundTasks = async () => {
                fetchTrends(lat, lon, high, low, high - 1, low + 1);
                fetchAlerts(lat, lon);
                updateMap(lat, lon);
            };
            backgroundTasks();
            
            saveToCache({
                current: data.current,
                hourly: data.hourly,
                daily: data.daily,
                lat,
                lon,
                trendParams: { high, low, tomorrowHigh: high - 1, tomorrowLow: low + 1 }
            });
        } catch (error) {
            showError(error.message);
        }
        return;
    }

    // Direct MET Norway provider bypass
    if (PRIMARY_SOURCE === 'met-norway') {
        try {
            const data = await fetchMetNorwayWeatherData(lat, lon, customCityName);
            UI.city.textContent = data.cityName;
            const stationEl = document.getElementById('station-info');
            if (stationEl) stationEl.textContent = 'Provider: MET Norway (yr.no)';
            UI.set('date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
            UI.set('updated', `Updated: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
            
            if (UI.radarLink) {
                UI.radarLink.href = `https://zoom.earth/maps/radar/#c=${lat},${lon},8z`;
                UI.radarLink.textContent = 'View Zoom Earth Radar 📡';
            }
            
            ALL_HOURLY_DATA = data.hourly;
            ALL_DAILY_DATA = data.daily;
            INITIAL_STATE = data.current;
            
            renderWeather(data.current, data.hourly);
            updateTheme(data.current.temperature, data.current.shortForecast);
            
            const relevant = data.daily.slice(0, 3);
            const temps = relevant.map(p => p.temperature);
            const high = Math.max(...temps);
            const low = Math.min(...temps);
            
            const displayHigh = CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9);
            const displayLow = CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9);
            UI.set('high', `${displayHigh}°`);
            UI.set('low', `${displayLow}°`);
            renderDailyForecast(data.daily);
            
            const backgroundTasks = async () => {
                fetchTrends(lat, lon, high, low, high - 1, low + 1);
                fetchAlerts(lat, lon);
                updateMap(lat, lon);
            };
            backgroundTasks();
            
            saveToCache({
                current: data.current,
                hourly: data.hourly,
                daily: data.daily,
                lat,
                lon,
                trendParams: { high, low, tomorrowHigh: high - 1, tomorrowLow: low + 1 }
            });
        } catch (error) {
            showError(error.message);
        }
        return;
    }

    try {
        updateLoading('Locating atmospheric grid...');
        
        let pointsRes = null;
        let isNWS = true;
        try {
            pointsRes = await fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`, { headers: HEADERS });
            if (!pointsRes.ok) isNWS = false;
        } catch (e) {
            isNWS = false;
        }

        // If forced NWS observations but offline or outside US
        if (PRIMARY_SOURCE === 'nws-obs' && !isNWS) {
            showError('NWS Live Sensor is unavailable outside the US or offline. Please select the Open-Meteo or MET Norway provider in Settings.');
            return;
        }
        if (PRIMARY_SOURCE === 'nws-forecast' && !isNWS) {
            showError('NWS Forecast model is unavailable outside the US or offline. Please select the Open-Meteo or MET Norway provider in Settings.');
            return;
        }

        // Dynamic auto fallback (Prioritize US NWS, fallback globally)
        if (!isNWS) {
            console.log('NWS unavailable. Gracefully falling back to Open-Meteo/MET Norway adapter.');
            let data;
            let providerName = 'Open-Meteo (Fallback)';
            try {
                data = await fetchOpenMeteoWeatherData(lat, lon, customCityName);
            } catch (err) {
                console.warn('Open-Meteo fallback failed, trying MET Norway...', err);
                data = await fetchMetNorwayWeatherData(lat, lon, customCityName);
                providerName = 'MET Norway (Fallback)';
            }
            UI.city.textContent = data.cityName;
            const stationEl = document.getElementById('station-info');
            if (stationEl) stationEl.textContent = 'Provider: Open-Meteo (Fallback)';
            UI.set('date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
            UI.set('updated', `Updated: ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
            
            if (UI.radarLink) {
                UI.radarLink.href = `https://zoom.earth/maps/radar/#c=${lat},${lon},8z`;
                UI.radarLink.textContent = 'View Zoom Earth Radar 📡';
            }
            
            ALL_HOURLY_DATA = data.hourly;
            ALL_DAILY_DATA = data.daily;
            INITIAL_STATE = data.current;
            
            renderWeather(data.current, data.hourly);
            updateTheme(data.current.temperature, data.current.shortForecast);
            
            const relevant = data.daily.slice(0, 3);
            const temps = relevant.map(p => p.temperature);
            const high = Math.max(...temps);
            const low = Math.min(...temps);
            
            const displayHigh = CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9);
            const displayLow = CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9);
            UI.set('high', `${displayHigh}°`);
            UI.set('low', `${displayLow}°`);
            renderDailyForecast(data.daily);
            
            const backgroundTasks = async () => {
                fetchTrends(lat, lon, high, low, high - 1, low + 1);
                fetchAlerts(lat, lon);
                updateMap(lat, lon);
            };
            backgroundTasks();
            
            saveToCache({
                current: data.current,
                hourly: data.hourly,
                daily: data.daily,
                lat,
                lon,
                trendParams: { high, low, tomorrowHigh: high - 1, tomorrowLow: low + 1 }
            });
            return;
        }

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
            UI.radarLink.textContent = 'View Local Radar 📡';
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
            let high = INITIAL_STATE?.temperature || 70;
            let low = INITIAL_STATE?.temperature || 50;
            let tomHigh = high;
            let tomLow = low;

            try {
                const dailyRes = await fetch(forecast, { headers: HEADERS, cache: 'reload' });
                if (dailyRes.ok) {
                    const dailyData = await dailyRes.json();
                    const dailyPeriods = dailyData.properties.periods || [];
                    ALL_DAILY_DATA = dailyPeriods;
                    
                    const relevant = dailyPeriods.slice(0, 3);
                    const temps = relevant.map(p => p.temperature);
                    high = Math.max(...temps);
                    low = Math.min(...temps);
                    
                    const displayHigh = CURRENT_UNITS === 'F' ? high : Math.round((high - 32) * 5/9);
                    const displayLow = CURRENT_UNITS === 'F' ? low : Math.round((low - 32) * 5/9);
                    UI.set('high', `${displayHigh}°`);
                    UI.set('low', `${displayLow}°`);
                    renderDailyForecast(dailyPeriods);

                    const tomDate = new Date(); tomDate.setDate(tomDate.getDate() + 1);
                    const tomDateStr = tomDate.toDateString();
                    const tomPeriods = dailyPeriods.filter(p => new Date(p.startTime).toDateString() === tomDateStr);
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

            // Live physical sensor observations
            if (PRIMARY_SOURCE === 'auto' || PRIMARY_SOURCE === 'nws-obs') {
                try {
                    let sId = stationId;
                    if (!sId) {
                        try {
                            const stationsRes = await fetch(pointsData.properties.observationStations, { headers: HEADERS });
                            if (stationsRes.ok) {
                                const stationsData = await stationsRes.json();
                                sId = stationsData.features?.[0]?.properties?.stationIdentifier;
                            }
                        } catch (e) {
                            console.warn('Direct station search failed, using coordinates fallback.', e);
                        }
                    }
                    if (!sId) {
                        try {
                            sId = await fetch(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations`, { headers: HEADERS })
                                .then(r => r.json())
                                .then(d => d.features[0].properties.stationIdentifier);
                        } catch (e) {
                            console.warn('Fallback station resolution failed.', e);
                        }
                    }
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
            } else {
                const sEl = document.getElementById('station-info');
                if (sEl) sEl.textContent = 'Source: NWS Forecast Grid';
            }

            // Save fully populated NWS dataset to cache
            saveToCache({
                current: INITIAL_STATE,
                hourly: ALL_HOURLY_DATA,
                daily: ALL_DAILY_DATA,
                lat,
                lon,
                trendParams: { high, low, tomorrowHigh: tomHigh, tomorrowLow: tomLow }
            });

            fetchAlerts(lat, lon);
            updateMap(lat, lon);
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
    // Populate Today pill immediately
    const pillTodayTemp = document.getElementById('pill-today-temp');
    if (pillTodayTemp) pillTodayTemp.textContent = `${displayTemp}°`;
    // Wire up Today pill to reset app focus
    const pillToday = document.getElementById('pill-today');
    if (pillToday) {
        pillToday.onclick = () => {
            if (INITIAL_STATE) {
                setActivePill('pill-today');
                updateAppFocus(INITIAL_STATE);
            }
        };
    }
    renderHourly(hourly.slice(0, 24));
    updateFavoriteStar();
    renderFavorites();
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
    if (resetBtn) {
        const isToday = baseDate.toDateString() === new Date().toDateString();
        resetBtn.style.display = isToday ? 'none' : 'flex';
        resetBtn.onclick = () => {
            setActivePill('pill-today');
            updateAppFocus(INITIAL_STATE);
        };
    }
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

/**
 * Highlights one pill as active (orange glow) and resets the others.
 * @param {string} activePillId - ID of the pill to activate ('pill-today' | 'pill-yesterday' | 'pill-tomorrow' | 'pill-lastyear')
 */
function setActivePill(activePillId) {
    ['pill-today', 'pill-yesterday', 'pill-tomorrow', 'pill-lastyear'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === activePillId) {
            el.classList.add('time-pill-active');
            if (id === 'pill-today') {
                el.classList.add('time-pill-today');
                el.classList.remove('time-pill-active');
            } else {
                el.classList.remove('time-pill-today');
            }
        } else {
            el.classList.remove('time-pill-active');
            if (id === 'pill-today') el.classList.add('time-pill-today');
            else el.classList.remove('time-pill-today');
        }
    });
    // Show "Return to Today" banner whenever focus is not on Today
    const resetBtn = document.getElementById('return-today');
    if (resetBtn) resetBtn.style.display = activePillId === 'pill-today' ? 'none' : 'flex';
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

/**
 * Populates the inline time-navigation pill buttons inside the main weather card.
 */
async function fetchTrends(lat, lon, todayHigh, todayLow, tomorrowHigh, tomorrowLow, baseDate = new Date()) {
    const display = (f) => CURRENT_UNITS === 'F' ? f : Math.round((f - 32) * 5 / 9);
    const diffText = (diff) => {
        const v = CURRENT_UNITS === 'F' ? Math.abs(diff) : Math.round(Math.abs(diff) / 1.8);
        return diff > 0 ? `+${v}° warmer` : diff < 0 ? `${-v}° cooler` : 'Same';
    };

    // ── Today (Daily High for navigation consistency) ────────────────────────
    const pillTodayTemp = document.getElementById('pill-today-temp');
    if (pillTodayTemp) pillTodayTemp.textContent = `${display(todayHigh)}°`;

    // ── Yesterday (estimate: todayHigh minus typical daily variation) ──────────
    const yest = new Date(baseDate); yest.setDate(baseDate.getDate() - 1);
    const yestHigh = todayHigh - 2; // lightweight estimate until we fetch archive
    const yestDiff = yestHigh - todayHigh;
    const pillYestTemp = document.getElementById('pill-yesterday-temp');
    const pillYestDiff = document.getElementById('pill-yesterday-diff');
    const pillYest = document.getElementById('pill-yesterday');
    if (pillYestTemp) pillYestTemp.textContent = `${display(yestHigh)}°`;
    if (pillYestDiff) pillYestDiff.textContent = diffText(yestDiff);
    if (pillYest) {
        pillYest.onclick = () => {
            setActivePill('pill-yesterday');
            updateAppFocus({ temperature: yestHigh, shortForecast: 'Yesterday\'s High', date: yest }, false);
        };
    }

    // ── Tomorrow ──────────────────────────────────────────────────────────────
    const tom = new Date(baseDate); tom.setDate(baseDate.getDate() + 1);
    const tomDiff = tomorrowHigh - todayHigh;
    const pillTomTemp = document.getElementById('pill-tomorrow-temp');
    const pillTomDiff = document.getElementById('pill-tomorrow-diff');
    const pillTom = document.getElementById('pill-tomorrow');
    if (pillTomTemp) pillTomTemp.textContent = `${display(tomorrowHigh)}°`;
    if (pillTomDiff) pillTomDiff.textContent = diffText(tomDiff);
    if (pillTom) {
        pillTom.onclick = () => {
            setActivePill('pill-tomorrow');
            const tomPeriod = ALL_DAILY_DATA.find(p => new Date(p.startTime).toDateString() === tom.toDateString());
            if (tomPeriod) {
                updateAppFocus(tomPeriod, false);
            } else {
                updateAppFocus({ temperature: tomorrowHigh, shortForecast: 'Tomorrow\'s Outlook', date: tom }, false);
            }
        };
    }

    // ── Last Year — fetch from archive API ────────────────────────────────────
    const ly = new Date(baseDate); ly.setFullYear(baseDate.getFullYear() - 1);
    const lyDate = ly.toISOString().split('T')[0];
    let lyHigh = todayHigh - 1;
    try {
        const lyRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${lyDate}&end_date=${lyDate}&daily=temperature_2m_max&temperature_unit=fahrenheit`);
        if (lyRes.ok) {
            const lyData = await lyRes.json();
            if (lyData.daily?.temperature_2m_max?.[0] != null) {
                lyHigh = Math.round(lyData.daily.temperature_2m_max[0]);
            }
        }
    } catch (e) {
        console.warn('Archive fetch failed, using estimate for Last Year pill.', e);
    }
    const lyDiff = lyHigh - todayHigh;
    const pillLYTemp = document.getElementById('pill-lastyear-temp');
    const pillLYDiff = document.getElementById('pill-lastyear-diff');
    const pillLY = document.getElementById('pill-lastyear');
    if (pillLYTemp) pillLYTemp.textContent = `${display(lyHigh)}°`;
    if (pillLYDiff) pillLYDiff.textContent = `${ly.getFullYear()}: ${diffText(lyDiff)}`;
    if (pillLY) {
        pillLY.onclick = () => {
            setActivePill('pill-lastyear');
            updateAppFocus({ temperature: lyHigh, shortForecast: `${ly.getFullYear()} Historical`, date: ly }, true);
        };
    }
}

function updateLoading(msg) { if (UI.state) { const msgEl = document.getElementById('loading-msg'); if (msgEl) msgEl.textContent = msg; } }
function showError(msg) { if (UI.state) UI.state.innerHTML = `<div class="error-view glass-card"><h3>Weather Interruption</h3><p>${msg}</p><button class="btn" onclick="location.reload()">Try Again</button></div>`; }
function calculateFeelsLike(t, h, w) { if (t <= 50 && w > 3) return Math.round(35.74 + 0.6215 * t - 35.75 * Math.pow(w, 0.16) + 0.4275 * t * Math.pow(w, 0.16)); if (t >= 80) return Math.round(0.5 * (t + 61 + (t - 68) * 1.2 + h * 0.094)); return Math.round(t); }
function saveToCache(data) { localStorage.setItem('weather_cache', JSON.stringify({ timestamp: Date.now(), data })); }
function loadFromCache() { const c = localStorage.getItem('weather_cache'); if (!c) return null; const { timestamp, data } = JSON.parse(c); return Date.now() - timestamp > 15 * 60 * 1000 ? null : { data }; }
function renderFullWeather(data) { const { current, hourly, daily, lat, lon, trendParams } = data; if (current) INITIAL_STATE = current; if (lat) { CURRENT_LAT = lat; CURRENT_LON = lon; } renderWeather(current, hourly); renderDailyForecast(daily); if (trendParams && lat) fetchTrends(lat, lon, trendParams.high, trendParams.low, trendParams.tomorrowHigh, trendParams.tomorrowLow); if (lat) updateMap(lat, lon); }

/**
 * Calculates the distance and cardinal direction from start to end coordinates.
 */
function getDistanceAndBearing(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of Earth in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in miles

    // Bearing
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    brng = (brng + 360) % 360;

    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(brng / 45) % 8;
    return {
        distance: distance.toFixed(1),
        direction: directions[index]
    };
}

/**
 * Maps Open-Meteo weather codes to clean descriptions.
 */
function getWeatherDescriptionFromCode(code) {
    if (code === 0) return 'Clear';
    if (code === 1 || code === 2 || code === 3) return 'Partly Cloudy';
    if (code === 45 || code === 48) return 'Foggy';
    if (code >= 51 && code <= 55) return 'Drizzle';
    if (code >= 61 && code <= 65) return 'Rain';
    if (code >= 71 && code <= 77) return 'Snow';
    if (code >= 80 && code <= 82) return 'Rain Showers';
    if (code >= 85 && code <= 86) return 'Snow Showers';
    if (code >= 95 && code <= 99) return 'Thunderstorm';
    return 'Cloudy';
}

/**
 * Maps Fahrenheit temperature to dynamically curated color codes.
 */
function getTempColor(tempF) {
    if (tempF <= 32) return '#38bdf8'; // Cyan
    if (tempF <= 50) return '#0ea5e9'; // Blue
    if (tempF <= 65) return '#10b981'; // Emerald
    if (tempF <= 80) return '#f59e0b'; // Amber
    if (tempF <= 95) return '#f97316'; // Orange
    return '#ef4444'; // Red
}

/**
 * Initializes and dynamically updates the Leaflet map, fetching
 * nearby stations and querying their temperatures concurrently.
 */
async function updateMap(lat, lon, shouldSetView = true) {
    if (typeof L === 'undefined') {
        console.warn('Leaflet mapping library is not available.');
        return;
    }

    const container = document.getElementById('weather-map');
    if (!container) return;

    mapUpdateCounter++;
    const currentId = mapUpdateCounter;

    try {
        // Initialize Map if not present
        if (!leafletMap) {
            leafletMap = L.map('weather-map', {
                zoomControl: false,
                attributionControl: true
            }).setView([lat, lon], 12);

            // Sleek zoom control top-right
            L.control.zoom({ position: 'topright' }).addTo(leafletMap);

            // CartoDB Dark Matter map tile layer
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
                maxZoom: 20
            }).addTo(leafletMap);

            mapMarkersGroup = L.layerGroup().addTo(leafletMap);

            // Sleek dynamic loading: fetch and show telemetry around the new map viewport center after panning or zooming finishes
            let moveEndTimeout;
            leafletMap.on('moveend', () => {
                clearTimeout(moveEndTimeout);
                moveEndTimeout = setTimeout(async () => {
                    const center = leafletMap.getCenter();
                    await updateMap(center.lat, center.lng, false);
                }, 300);
            });

            // Handle popup state tracking to prevent disappearing on redraws
            leafletMap.on('popupopen', (e) => {
                activePopupLatLng = e.popup.getLatLng();
            });
            leafletMap.on('popupclose', () => {
                if (!isRedrawingMarkers) {
                    activePopupLatLng = null;
                }
            });
        } else {
            if (shouldSetView) {
                leafletMap.setView([lat, lon], leafletMap.getZoom());
            }
        }

        // Pulse marker representing active weather location (remains at CURRENT_LAT/CURRENT_LON if panning around)
        if (shouldSetView || !mapCenterMarker) {
            if (mapCenterMarker) {
                mapCenterMarker.remove();
            }
            const centerIcon = L.divIcon({
                className: 'custom-center-icon',
                html: '<div class="center-gps-marker"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            const activeLat = shouldSetView ? lat : (CURRENT_LAT || lat);
            const activeLon = shouldSetView ? lon : (CURRENT_LON || lon);
            mapCenterMarker = L.marker([activeLat, activeLon], { icon: centerIcon }).addTo(leafletMap);
        }

        // Draw cached markers instantly for ultra-low latency zooming and panning!
        renderMapMarkersFromCache();

        // Perform deferred background fetching to keep data fresh and populate new regions
        setTimeout(async () => {
            if (currentId !== mapUpdateCounter) return;
            
            // 1. Fetch NWS physical sensor stations (inside the US)
            if (MAP_FILTER === 'all' || MAP_FILTER === 'nws-only') {
                try {
                    const stationsRes = await fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}/stations`, { headers: HEADERS });
                    if (currentId === mapUpdateCounter && stationsRes.ok) {
                        const data = await stationsRes.json();
                        const stations = data.features || [];
                        stations.slice(0, 6).forEach(s => {
                            const sId = s.properties.stationIdentifier;
                            const coords = s.geometry.coordinates;
                            const cellKey = getGridCellKey(coords[1], coords[0]);
                            
                            // Asynchronously fetch latest observation for this station
                            fetch(`${NWS_API}/stations/${sId}/observations/latest`, { headers: HEADERS }).then(r => {
                                if (r.ok) return r.json();
                            }).then(obsData => {
                                if (obsData && currentId === mapUpdateCounter) {
                                    const celsius = obsData.properties.temperature.value;
                                    if (celsius !== null) {
                                        const tempF = Math.round((celsius * 9/5) + 32);
                                        const condition = obsData.properties.textDescription || 'Clear';
                                        
                                        const markerObj = {
                                            lat: coords[1],
                                            lon: coords[0],
                                            tempF,
                                            condition,
                                            source: 'nws',
                                            name: `${sId} - ${s.properties.name.split(',')[0]}`,
                                            cellKey
                                        };
                                        
                                        if (!MAP_TELEMETRY_CACHE.has(cellKey)) {
                                            MAP_TELEMETRY_CACHE.set(cellKey, []);
                                        }
                                        const list = MAP_TELEMETRY_CACHE.get(cellKey);
                                        const existingIdx = list.findIndex(m => m.source === 'nws' && m.name.startsWith(sId));
                                        if (existingIdx >= 0) list[existingIdx] = markerObj;
                                        else list.push(markerObj);
                                        
                                        renderMapMarkersFromCache();
                                    }
                                }
                            }).catch(err => console.error(err));
                        });
                    }
                } catch (e) {
                    console.warn('Coordinates outside US, skipping NWS stations fetch.');
                }
            }

            // 2. Fetch Open-Meteo Grid Points
            if (MAP_FILTER === 'all' || MAP_FILTER === 'openmeteo-only') {
                const offsets = [
                    { dLat: 0, dLon: 0 },
                    { dLat: 0.06, dLon: 0.08 },
                    { dLat: -0.06, dLon: -0.08 },
                    { dLat: 0.06, dLon: -0.08 },
                    { dLat: -0.06, dLon: 0.08 }
                ];
                const omPoints = offsets.map(o => ({ lat: lat + o.dLat, lon: lon + o.dLon }));
                const omLats = omPoints.map(p => p.lat.toFixed(4)).join(',');
                const omLons = omPoints.map(p => p.lon.toFixed(4)).join(',');
                
                try {
                    const omRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${omLats}&longitude=${omLons}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`);
                    if (currentId === mapUpdateCounter && omRes.ok) {
                        const omData = await omRes.json();
                        const results = Array.isArray(omData) ? omData : [omData];
                        results.forEach((res, index) => {
                            const p = omPoints[index];
                            const cellKey = getGridCellKey(p.lat, p.lon);
                            const tempF = Math.round(res.current.temperature_2m);
                            const code = res.current.weather_code;
                            const condition = getWeatherDescriptionFromCode(code);
                            
                            const markerObj = {
                                lat: p.lat,
                                lon: p.lon,
                                tempF,
                                condition,
                                source: 'openmeteo',
                                name: `Open-Meteo Grid Node`,
                                cellKey
                            };
                            
                            if (!MAP_TELEMETRY_CACHE.has(cellKey)) {
                                MAP_TELEMETRY_CACHE.set(cellKey, []);
                            }
                            const list = MAP_TELEMETRY_CACHE.get(cellKey);
                            const existingIdx = list.findIndex(m => m.source === 'openmeteo');
                            if (existingIdx >= 0) list[existingIdx] = markerObj;
                            else list.push(markerObj);
                        });
                        renderMapMarkersFromCache();
                    }
                } catch (e) {
                    console.error('Failed to update Open-Meteo map grid:', e);
                }
            }

            // 3. Fetch MET Norway Grid Points (Staggered background queue)
            if (MAP_FILTER === 'all' || MAP_FILTER === 'metnorway-only') {
                const offsets = [
                    { dLat: 0.04, dLon: 0.04 },
                    { dLat: -0.04, dLon: -0.04 },
                    { dLat: 0.04, dLon: -0.04 },
                    { dLat: -0.04, dLon: 0.04 }
                ];
                
                let delay = 50;
                offsets.forEach(o => {
                    const pLat = lat + o.dLat;
                    const pLon = lon + o.dLon;
                    const cellKey = getGridCellKey(pLat, pLon);
                    
                    setTimeout(async () => {
                        if (currentId !== mapUpdateCounter) return;
                        try {
                            const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${pLat.toFixed(4)}&lon=${pLon.toFixed(4)}`;
                            const res = await fetch(metUrl, { headers: HEADERS });
                            if (currentId === mapUpdateCounter && res.ok) {
                                const metData = await res.json();
                                const latest = metData.properties.timeseries[0];
                                const tempC = latest.data.instant.details.air_temperature;
                                const tempF = Math.round((tempC * 9/5) + 32);
                                const symbol = latest.data.next_1_hours?.summary?.symbol_code || 'clearsky_day';
                                const condition = cleanMetNorwaySymbol(symbol);
                                
                                const markerObj = {
                                    lat: pLat,
                                    lon: pLon,
                                    tempF,
                                    condition,
                                    source: 'metnorway',
                                    name: `MET Norway Grid Node`,
                                    cellKey
                                };
                                
                                if (!MAP_TELEMETRY_CACHE.has(cellKey)) {
                                    MAP_TELEMETRY_CACHE.set(cellKey, []);
                                }
                                const list = MAP_TELEMETRY_CACHE.get(cellKey);
                                const existingIdx = list.findIndex(m => m.source === 'metnorway');
                                if (existingIdx >= 0) list[existingIdx] = markerObj;
                                else list.push(markerObj);
                                
                                renderMapMarkersFromCache();
                            }
                        } catch (e) {
                            console.error('Failed to update MET Norway map grid:', e);
                        }
                    }, delay);
                    delay += 600; // stagger yr.no hits by 600ms
                });
            }

            // Also trigger background preloading for surrounding 5x5 grid cells
            preloadSurroundingTelemetry(lat, lon);

        }, 100);

    } catch (e) {
        console.error('Failed to initialize or update weather map:', e);
    }
}

/**
 * Asynchronously preloads surrounding grid telemetry from all sources in the background.
 */
async function preloadSurroundingTelemetry(lat, lon) {
    if (lat === undefined || lon === undefined) return;

    // 1. Generate concentric radiating grid points up to 200 miles (~3.0 degrees)
    const points = [];
    
    // Ring 1: Immediate/Inner local neighborhood (0 to 25 miles, step size 0.08 degrees)
    for (let x = -2; x <= 2; x++) {
        for (let y = -2; y <= 2; y++) {
            if (x === 0 && y === 0) continue;
            points.push({
                lat: lat + x * 0.08,
                lon: lon + y * 0.08,
                distance: Math.sqrt(x*x + y*y) * 0.08
            });
        }
    }

    // Ring 2: Mid-range regional grid (25 to 80 miles, step size 0.45 degrees)
    for (let x = -2; x <= 2; x++) {
        for (let y = -2; y <= 2; y++) {
            if (Math.abs(x) <= 1 && Math.abs(y) <= 1) continue; // Skip Ring 1 region
            points.push({
                lat: lat + x * 0.45,
                lon: lon + y * 0.45,
                distance: Math.sqrt(x*x + y*y) * 0.45
            });
        }
    }

    // Ring 3: Outer regional grid (80 to 200 miles, step size 1.0 degree)
    for (let x = -3; x <= 3; x++) {
        for (let y = -3; y <= 3; y++) {
            if (Math.abs(x) <= 1 && Math.abs(y) <= 1) continue; // Skip Ring 2 region
            points.push({
                lat: lat + x * 1.0,
                lon: lon + y * 1.0,
                distance: Math.sqrt(x*x + y*y) * 1.0
            });
        }
    }

    // Sort coordinates by distance from search center to prioritize immediate loading
    points.sort((a, b) => a.distance - b.distance);

    const unCachedOpenMeteo = points.filter(p => {
        const cell = getGridCellKey(p.lat, p.lon);
        return !MAP_TELEMETRY_CACHE.has(cell) || !MAP_TELEMETRY_CACHE.get(cell).some(m => m.source === 'openmeteo');
    });

    if (unCachedOpenMeteo.length > 0) {
        // Fetch surrounding grid in one single fast batch request
        const latsStr = unCachedOpenMeteo.map(p => p.lat.toFixed(4)).join(',');
        const lonsStr = unCachedOpenMeteo.map(p => p.lon.toFixed(4)).join(',');
        const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latsStr}&longitude=${lonsStr}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
        
        try {
            const res = await fetch(omUrl);
            if (res.ok) {
                const data = await res.json();
                const results = Array.isArray(data) ? data : [data];
                results.forEach((resItem, idx) => {
                    const p = unCachedOpenMeteo[idx];
                    const cellKey = getGridCellKey(p.lat, p.lon);
                    const tempF = Math.round(resItem.current.temperature_2m);
                    const code = resItem.current.weather_code;
                    const condition = getWeatherDescriptionFromCode(code);
                    
                    const markerObj = {
                        lat: p.lat,
                        lon: p.lon,
                        tempF,
                        condition,
                        source: 'openmeteo',
                        name: `Open-Meteo Grid Node`,
                        cellKey
                    };
                    
                    if (!MAP_TELEMETRY_CACHE.has(cellKey)) {
                        MAP_TELEMETRY_CACHE.set(cellKey, []);
                    }
                    if (!MAP_TELEMETRY_CACHE.get(cellKey).some(m => m.source === 'openmeteo')) {
                        MAP_TELEMETRY_CACHE.get(cellKey).push(markerObj);
                    }
                });
                triggerMapMarkerRefresh();
            }
        } catch (e) {
            console.error('Failed to preload Open-Meteo grid telemetry:', e);
        }
    }

    // Surrounding grid offsets for MET Norway (3x3 grid = 8 points) to respect API rate limits
    const metPoints = [];
    for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
            if (dLat === 0 && dLon === 0) continue;
            metPoints.push({
                lat: lat + dLat * 0.08,
                lon: lon + dLon * 0.08
            });
        }
    }

    let metDelay = 200;
    metPoints.forEach(p => {
        const cellKey = getGridCellKey(p.lat, p.lon);
        if (MAP_TELEMETRY_CACHE.has(cellKey) && MAP_TELEMETRY_CACHE.get(cellKey).some(m => m.source === 'metnorway')) return;
        
        setTimeout(async () => {
            const fetchingKey = `metnorway:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
            if (MAP_FETCHING_SET.has(fetchingKey)) return;
            MAP_FETCHING_SET.add(fetchingKey);
            
            try {
                const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`;
                const res = await fetch(metUrl, { headers: HEADERS });
                if (res.ok) {
                    const data = await res.json();
                    const latest = data.properties.timeseries[0];
                    const tempC = latest.data.instant.details.air_temperature;
                    const tempF = Math.round((tempC * 9/5) + 32);
                    const symbol = latest.data.next_1_hours?.summary?.symbol_code || 'clearsky_day';
                    const condition = cleanMetNorwaySymbol(symbol);
                    
                    const markerObj = {
                        lat: p.lat,
                        lon: p.lon,
                        tempF,
                        condition,
                        source: 'metnorway',
                        name: `MET Norway Grid Node`,
                        cellKey
                    };
                    
                    if (!MAP_TELEMETRY_CACHE.has(cellKey)) {
                        MAP_TELEMETRY_CACHE.set(cellKey, []);
                    }
                    if (!MAP_TELEMETRY_CACHE.get(cellKey).some(m => m.source === 'metnorway')) {
                        MAP_TELEMETRY_CACHE.get(cellKey).push(markerObj);
                    }
                    triggerMapMarkerRefresh();
                }
            } catch (e) {
                console.error('Failed to preload MET Norway telemetry:', e);
            } finally {
                MAP_FETCHING_SET.delete(fetchingKey);
            }
        }, metDelay);
        metDelay += 800; // staggered by 800ms
    });

    // Surrounding NWS Physical Stations (if inside the US)
    try {
        const stationsRes = await fetch(`${NWS_API}/points/${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}/stations`, { headers: HEADERS });
        if (stationsRes.ok) {
            const data = await stationsRes.json();
            const stations = data.features || [];
            const activeStations = stations.slice(0, 6);
            
            let nwsDelay = 100;
            activeStations.forEach(s => {
                const sId = s.properties.stationIdentifier;
                const coords = s.geometry.coordinates; // [lon, lat]
                const cellKey = getGridCellKey(coords[1], coords[0]);
                
                if (MAP_TELEMETRY_CACHE.has(cellKey) && MAP_TELEMETRY_CACHE.get(cellKey).some(m => m.source === 'nws')) return;
                
                setTimeout(async () => {
                    const fetchingKey = `nws:${sId}`;
                    if (MAP_FETCHING_SET.has(fetchingKey)) return;
                    MAP_FETCHING_SET.add(fetchingKey);
                    
                    try {
                        const obsRes = await fetch(`${NWS_API}/stations/${sId}/observations/latest`, { headers: HEADERS });
                        if (obsRes.ok) {
                            const obsData = await obsRes.json();
                            const celsius = obsData.properties.temperature.value;
                            if (celsius !== null) {
                                const tempF = Math.round((celsius * 9/5) + 32);
                                const condition = obsData.properties.textDescription || 'Clear';
                                
                                const markerObj = {
                                    lat: coords[1],
                                    lon: coords[0],
                                    tempF,
                                    condition,
                                    source: 'nws',
                                    name: `${sId} - ${s.properties.name.split(',')[0]}`,
                                    cellKey
                                };
                                
                                if (!MAP_TELEMETRY_CACHE.has(cellKey)) {
                                    MAP_TELEMETRY_CACHE.set(cellKey, []);
                                }
                                if (!MAP_TELEMETRY_CACHE.get(cellKey).some(m => m.source === 'nws')) {
                                    MAP_TELEMETRY_CACHE.get(cellKey).push(markerObj);
                                }
                                triggerMapMarkerRefresh();
                            }
                        }
                    } catch (e) {
                        console.error(`Failed to preload NWS observations for ${sId}:`, e);
                    } finally {
                        MAP_FETCHING_SET.delete(fetchingKey);
                    }
                }, nwsDelay);
                nwsDelay += 400; // staggered by 400ms
            });
        }
    } catch (e) {
        console.warn('Coordinates outside US, skipping NWS stations preload.');
    }
}

/**
 * Triggers map redraw without shifting map center view.
 */
function triggerMapMarkerRefresh() {
    if (leafletMap) {
        renderMapMarkersFromCache();
    }
}

/**
 * Renders all weather badges from MAP_TELEMETRY_CACHE inside visible map bounds.
 */
function renderMapMarkersFromCache() {
    if (!leafletMap || !mapMarkersGroup) return;
    
    const wasPopupOpen = activePopupLatLng !== null;
    const prevPopupLatLng = activePopupLatLng;

    isRedrawingMarkers = true;
    mapMarkersGroup.clearLayers();
    
    const bounds = leafletMap.getBounds();
    const candidates = [];
    
    // 1. Gather all candidates currently inside map bounds
    for (const [cellKey, markers] of MAP_TELEMETRY_CACHE.entries()) {
        markers.forEach(loc => {
            if (bounds.contains([loc.lat, loc.lon])) {
                // Apply Settings map filter
                if (MAP_FILTER === 'nws-only' && loc.source !== 'nws') return;
                if (MAP_FILTER === 'openmeteo-only' && loc.source !== 'openmeteo') return;
                if (MAP_FILTER === 'metnorway-only' && loc.source !== 'metnorway') return;
                
                candidates.push(loc);
            }
        });
    }

    // 2. Prioritize most reliable sources (and ensure active popup marker has highest priority)
    const getReliabilityScore = (loc) => {
        if (activePopupLatLng && 
            Math.abs(loc.lat - activePopupLatLng.lat) < 0.0001 && 
            Math.abs(loc.lon - activePopupLatLng.lng) < 0.0001) {
            return 0; // Highest priority for the active popup marker!
        }
        if (loc.source === 'nws') return 1;
        if (loc.source === 'metnorway') return 2;
        return 3; // openmeteo
    };
    
    candidates.sort((a, b) => getReliabilityScore(a) - getReliabilityScore(b));

    // 3. Set dynamic zoom-based proximity thresholds (in degrees) to prevent overlapping
    const zoom = leafletMap.getZoom();
    let proximityThreshold = 0.005;
    if (zoom <= 5) {
        proximityThreshold = 0.6;   // ~40 miles
    } else if (zoom <= 7) {
        proximityThreshold = 0.3;   // ~20 miles
    } else if (zoom <= 9) {
        proximityThreshold = 0.12;  // ~8 miles
    } else if (zoom <= 11) {
        proximityThreshold = 0.04;  // ~2.5 miles
    } else if (zoom <= 13) {
        proximityThreshold = 0.012; // ~0.8 miles
    } else {
        proximityThreshold = 0.003; // ~0.2 miles
    }

    // Also limit max markers count based on zoom to keep rendering clean
    let maxMarkers = 35;
    if (zoom <= 5) maxMarkers = 8;
    else if (zoom <= 7) maxMarkers = 15;
    else if (zoom <= 9) maxMarkers = 25;
    else if (zoom <= 11) maxMarkers = 35;
    else if (zoom <= 13) maxMarkers = 50;
    else maxMarkers = 80;

    // 4. Proximity filtering: keep the highest reliability markers and drop nearby ones
    const visibleMarkers = [];
    
    for (const loc of candidates) {
        if (visibleMarkers.length >= maxMarkers) break;
        
        // Check if too close to an already rendered (and thus more reliable) marker
        const isTooClose = visibleMarkers.some(rendered => {
            const latDiff = Math.abs(rendered.lat - loc.lat);
            const lonDiff = Math.abs(rendered.lon - loc.lon);
            return latDiff < proximityThreshold && lonDiff < proximityThreshold;
        });
        
        if (!isTooClose) {
            visibleMarkers.push(loc);
        }
    }

    // 5. Render visible markers
    let markerToOpen = null;
    visibleMarkers.forEach(loc => {
        const displayTemp = CURRENT_UNITS === 'F' ? loc.tempF : Math.round((loc.tempF - 32) * 5/9);
        const color = getTempColor(loc.tempF);
        
        let sourceClass = 'src-openmeteo';
        if (loc.source === 'nws') {
            sourceClass = 'src-nws';
        } else if (loc.source === 'metnorway') {
            sourceClass = 'src-metnorway';
        }
        
        const tempIcon = L.divIcon({
            className: 'custom-temp-icon',
            html: `
                <div class="temp-marker-badge ${sourceClass}" style="background: ${color};">
                    ${displayTemp}°
                </div>
            `,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        const popupContent = `
            <div class="map-popup-card" style="min-width: 180px; padding: 4px 0; font-family: 'Outfit', sans-serif;">
                <div class="popup-location-name" style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 2px;">${loc.name}</div>
                <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 8px;">Source: ${loc.source === 'nws' ? 'NWS Live Observation' : loc.source === 'metnorway' ? 'MET Norway (yr.no)' : 'Open-Meteo Grid'}</div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
                    <span style="font-size: 1.4rem; font-weight: 800; color: ${color};">${displayTemp}°${CURRENT_UNITS}</span>
                    <span style="font-size: 0.75rem; font-weight: 600; opacity: 0.8; color: var(--text-secondary);">${loc.condition}</span>
                </div>
                <button class="clickable popup-select-btn" onclick="window.__selectMapLocation(${loc.lat}, ${loc.lon}, '${loc.name.replace(/'/g, "\\'")}')" 
                        style="background: var(--accent); color: #0f172a; border: none; padding: 7px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; width: 100%; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 10px rgba(56, 189, 248, 0.2);">
                    Set as Active Location
                </button>
            </div>
        `;
        
        const marker = L.marker([loc.lat, loc.lon], { icon: tempIcon })
            .bindPopup(popupContent, { closeButton: false, offset: L.point(0, -10) })
            .addTo(mapMarkersGroup);

        // Dynamic, high-accuracy reverse geocoding on popup open
        marker.on('popupopen', async (e) => {
            const popup = e.popup;
            const container = popup.getElement();
            if (!container) return;
            const nameEl = container.querySelector('.popup-location-name');
            const btnEl = container.querySelector('.popup-select-btn');
            
            // Only geocode generic placeholders to save Nominatim requests and prevent sluggishness
            if (loc.name.includes('Grid Node') || loc.name.includes('Coordinates')) {
                if (nameEl) nameEl.textContent = '📍 Resolving place...';
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${loc.lat}&lon=${loc.lon}&format=json&zoom=12`);
                    if (res.ok) {
                        const data = await res.json();
                        const addr = data.address;
                        const placeName = addr.city || addr.town || addr.village || addr.suburb || addr.neighbourhood || addr.municipality || addr.county || 'Grid Node';
                        const stateSuffix = addr.state ? `, ${addr.state}` : (addr.country ? `, ${addr.country}` : '');
                        const fullName = `${placeName}${stateSuffix}`;
                        
                        // Persist resolved location name in memory so subsequent activations and maps are instant
                        loc.name = fullName;
                        
                        if (nameEl) nameEl.textContent = fullName;
                        if (btnEl) {
                            btnEl.setAttribute('onclick', `window.__selectMapLocation(${loc.lat}, ${loc.lon}, '${fullName.replace(/'/g, "\\'")}')`);
                        }
                    } else {
                        if (nameEl) nameEl.textContent = loc.name;
                    }
                } catch (err) {
                    if (nameEl) nameEl.textContent = loc.name;
                }
            }
        });
            
        // Check if this marker matches the previously open popup's position
        if (wasPopupOpen && prevPopupLatLng && 
            Math.abs(loc.lat - prevPopupLatLng.lat) < 0.0001 && 
            Math.abs(loc.lon - prevPopupLatLng.lng) < 0.0001) {
            markerToOpen = marker;
        }
    });

    if (markerToOpen) {
        markerToOpen.openPopup();
    }
    isRedrawingMarkers = false;
}

init();
