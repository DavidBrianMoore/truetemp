/**
 * Antigravity Testing API (ATA)
 * Standardized interface for AI-driven testing and state inspection.
 */

class AntigravityTestingAPI {
    constructor(appName, appVersion = '1.0.0') {
        this.version = '1.0.0';
        this.app = { name: appName, version: appVersion };
        this.stateGetters = {};
        this.actions = {};
        this.mocks = {};
        this.events = new EventTarget();

        // Attach to window
        window.__ATA__ = this;
        console.log(`🚀 [ATA] ${appName} Testing API Initialized`);
    }

    /**
     * Register a function to retrieve part of the app state.
     */
    registerState(key, getter) {
        this.stateGetters[key] = getter;
    }

    /**
     * Get a snapshot of all registered state.
     */
    getState() {
        const snapshot = {};
        for (const [key, getter] of Object.entries(this.stateGetters)) {
            try {
                snapshot[key] = typeof getter === 'function' ? getter() : getter;
            } catch (e) {
                snapshot[key] = `Error: ${e.message}`;
            }
        }
        return snapshot;
    }

    /**
     * Register an action that can be triggered by the AI.
     */
    registerAction(name, fn) {
        this.actions[name] = fn;
    }

    /**
     * Register a mockable dependency.
     */
    registerMock(name, original, mockFn) {
        this.mocks[name] = { original, current: mockFn || original };
    }

    /**
     * Dispatch an internal event.
     */
    emit(event, detail = {}) {
        this.events.dispatchEvent(new CustomEvent(event, { detail }));
    }

    /**
     * Listen for an internal event.
     */
    on(event, callback) {
        this.events.addEventListener(event, (e) => callback(e.detail));
    }
}

export default AntigravityTestingAPI;
