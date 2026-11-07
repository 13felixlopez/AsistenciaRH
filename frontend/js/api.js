// Cliente API Centralizado y Manejo de Sesión JWT

const Auth = {
    TOKEN_KEY: 'asistencia_jwt_token',
    USER_KEY: 'asistencia_user_data',

    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },

    setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    },

    getUser() {
        try {
            const raw = localStorage.getItem(this.USER_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    setUser(user) {
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    },

    clearSession() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
    },

    isAuthenticated() {
        return Boolean(this.getToken());
    },

    isAdmin() {
        const user = this.getUser();
        return Boolean(user && user.rol_codigo === 'ADMIN');
    },

    requireAuth() {
        if (!this.isAuthenticated()) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    },

    requireAdmin() {
        if (!this.requireAuth()) return false;
        if (!this.isAdmin()) {
            window.location.href = '/dashboard.html';
            return false;
        }
        return true;
    },

    logout() {
        this.clearSession();
        window.location.href = '/login.html';
    }
};

// Petición HTTP Authenticated Fetch hacia el Backend
async function apiFetch(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
    
    const headers = options.headers ? { ...options.headers } : {};
    
    const token = Auth.getToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }

    options.headers = headers;

    try {
        const response = await fetch(url, options);

        if (response.status === 401) {
            // Token expirado o no válido
            Auth.clearSession();
            if (!window.location.pathname.endsWith('login.html')) {
                window.location.href = '/login.html';
            }
            throw new Error('Sesión expirada o no autorizada.');
        }

        // Si es descarga de archivo (ej. Excel)
        const contentType = response.headers.get('content-type');
        if (contentType && (contentType.includes('spreadsheet') || contentType.includes('octet-stream'))) {
            return response.blob();
        }

        const rawText = await response.text();
        let data = {};
        if (rawText && rawText.trim().length > 0) {
            if (rawText.trim().startsWith('<')) {
                throw new Error(`El servidor devolvió una página web (HTML) en lugar de una respuesta API (HTTP ${response.status}). Verifica el despliegue de las Netlify Functions.`);
            }
            try {
                data = JSON.parse(rawText);
            } catch (jsonErr) {
                throw new Error(`Respuesta inválida del servidor (${response.status}): ${rawText.substring(0, 120)}`);
            }
        }

        if (!response.ok) {
            throw new Error(data.message || `Error del servidor (${response.status})`);
        }
        return data;
    } catch (err) {
        console.error(`Error en apiFetch [${endpoint}]:`, err);
        throw err;
    }
}

// Atajos para métodos HTTP
const api = {
    get: (endpoint) => apiFetch(endpoint, { method: 'GET' }),
    post: (endpoint, body) => apiFetch(endpoint, { method: 'POST', body }),
    put: (endpoint, body) => apiFetch(endpoint, { method: 'PUT', body }),
    delete: (endpoint) => apiFetch(endpoint, { method: 'DELETE' })
};

// Notificaciones Toast elegantes con SweetAlert2
function showToast(icon, title) {
    if (typeof Swal !== 'undefined') {
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3500,
            timerProgressBar: true
        });
        Toast.fire({ icon, title });
    } else {
        alert(title);
    }
}
