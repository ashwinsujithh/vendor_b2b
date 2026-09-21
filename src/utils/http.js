class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap an async route handler with uniform error handling. */
function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ success: false, message: err.message });
      }
      console.error(err);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Normalize a DATE value (string or Date) to 'YYYY-MM-DD'. */
function dayStr(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

module.exports = { HttpError, wrap, todayStr, dayStr };