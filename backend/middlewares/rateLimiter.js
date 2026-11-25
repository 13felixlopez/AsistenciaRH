// Middleware de Rate Limiting en memoria para protección contra ataques de fuerza bruta
const loginAttempts = new Map();

// Configuración: 5 intentos fallidos máximos en una ventana de 15 minutos
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

// Limpieza periódica de registros vencidos cada 10 minutos para ahorrar memoria
const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of loginAttempts.entries()) {
        if (now - data.firstAttempt > WINDOW_MS && now > data.blockedUntil) {
            loginAttempts.delete(key);
        }
    }
}, 10 * 60 * 1000);

// Permitir que el proceso termine normalmente sin retener el event loop
if (cleanupTimer.unref) {
    cleanupTimer.unref();
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || req.ip || 'unknown';
}

function loginRateLimiter(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (record && record.blockedUntil > now) {
        const remainingMinutes = Math.ceil((record.blockedUntil - now) / 60000);
        return res.status(429).json({
            success: false,
            message: `Demasiados intentos fallidos de inicio de sesión. Por seguridad, el acceso desde esta IP ha sido temporalmente bloqueado. Intenta nuevamente en ${remainingMinutes} minuto(s).`,
            retryAfterMinutes: remainingMinutes
        });
    }

    next();
}

function recordFailedLogin(req) {
    const ip = getClientIp(req);
    const now = Date.now();
    let record = loginAttempts.get(ip);

    if (!record || (now - record.firstAttempt > WINDOW_MS && now > record.blockedUntil)) {
        record = {
            count: 1,
            firstAttempt: now,
            blockedUntil: 0
        };
    } else {
        record.count += 1;
        if (record.count >= MAX_FAILED_ATTEMPTS) {
            record.blockedUntil = now + WINDOW_MS;
            console.warn(`🚨 RateLimit: IP ${ip} bloqueada por ${WINDOW_MS / 60000} minutos tras ${record.count} intentos fallidos.`);
        }
    }

    loginAttempts.set(ip, record);
}

function resetLoginAttempts(req) {
    const ip = getClientIp(req);
    loginAttempts.delete(ip);
}

module.exports = {
    loginRateLimiter,
    recordFailedLogin,
    resetLoginAttempts
};
