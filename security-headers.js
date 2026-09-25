// security-headers.js — IK-SEC helmet + rate-limiting (additive, /api-safe)
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

function install(app) {
  // 1) Security headers. CSP OFF to avoid breaking existing inline scripts/pages.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

  // 2) Brute-force limiter — login only (strict).
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again in 15 minutes.' }
  });
  app.use('/api/login', loginLimiter);

  // 3) General API limiter — generous, won't break normal SAP usage/polling.
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' }
  });
  app.use('/api/', apiLimiter);
}

module.exports = { install };
