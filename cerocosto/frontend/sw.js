const CACHE_NAME = 'registro-asistencia-v3';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/login.html',
    '/css/custom.css',
    '/js/config.js',
    '/js/api.js',
    '/js/layout.js',
    '/js/main.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/icons/icon.svg',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

// Instalación: Cachear recursos críticos
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('Algunos recursos externos no pudieron ser cacheados:', err);
            });
        })
    );
    self.skipWaiting();
});

// Activación: Limpieza de cachés antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Estrategia de Fetch: Network-First para páginas HTML, Cache-First para recursos estáticos
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Solo peticiones GET
    if (request.method !== 'GET') return;

    // Peticiones de navegación (Páginas HTML): Network first, fallback a caché
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    return response;
                })
                .catch(async () => {
                    const cachedResponse = await caches.match(request);
                    if (cachedResponse) return cachedResponse;
                    // Fallback offline básico
                    return new Response(
                        `<!DOCTYPE html>
                        <html lang="es">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Sin Conexión | Registro de Asistencia</title>
                            <link rel="stylesheet" href="/css/custom.css">
                        </head>
                        <body style="font-family: sans-serif; text-align: center; padding: 50px 20px; background-color: #f8fafc; color: #1e293b;">
                            <h2 style="color: #860063;">Sin Conexión a Internet</h2>
                            <p>No se pudo conectar con el servidor. Verifica tu red Wi-Fi o datos móviles para continuar registrando asistencia.</p>
                            <button onclick="window.location.reload()" style="background-color: #860063; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold;">Reintentar</button>
                        </body>
                        </html>`,
                        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                    );
                })
        );
        return;
    }

    // Recursos estáticos: Cache First con actualización en segundo plano (Stale-While-Revalidate)
    event.respondWith(
        caches.match(request).then((cached) => {
            const networked = fetch(request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || networked;
        })
    );
});
