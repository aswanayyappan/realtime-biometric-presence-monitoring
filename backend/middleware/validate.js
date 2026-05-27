/**
 * Input validation and sanitization middleware.
 * Lightweight — no heavy validation libraries.
 */

/**
 * Sanitize a string: trim, strip control chars, limit length.
 */
function sanitizeString(val, maxLen = 255) {
  if (typeof val !== 'string') return '';
  // Strip control characters except newlines/tabs
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

/**
 * Validate integer within range.
 */
function validateInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Validate float within range.
 */
function validateFloat(val, min, max, fallback) {
  const n = parseFloat(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Express middleware: reject payloads over size limit.
 */
function payloadSizeLimit(maxBytes = 10240) {
  return (req, res, next) => {
    const len = parseInt(req.headers['content-length'] || '0', 10);
    if (len > maxBytes) {
      return res.status(413).json({ error: 'Payload too large', maxBytes });
    }
    next();
  };
}

/**
 * Express middleware: validate JSON content type for POST/PUT.
 */
function requireJson(req, res, next) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
}

module.exports = {
  sanitizeString,
  validateInt,
  validateFloat,
  payloadSizeLimit,
  requireJson,
};
