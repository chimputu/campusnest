(function () {
  class ApiError extends Error {
    constructor(status, error, issues) {
      super(error || 'request_failed');
      this.status = status;
      this.error = error || 'request_failed';
      this.issues = issues || null;
    }
  }

  const MESSAGES = {
    unauthenticated: 'Please log in to continue.',
    forbidden: 'You do not have permission to do that.',
    suspended: 'This account has been suspended.',
    invalid_credentials: 'Incorrect email or password.',
    email_taken: 'That email is already registered.',
    listing_full: 'This listing is full.',
    listing_unavailable: 'This listing is not available.',
    listing_removed: 'This listing has been removed.',
    already_requested: 'You already have an active request for this listing.',
    already_reviewed: 'You have already reviewed this listing.',
    already_reported: 'You have already reported this listing.',
    not_eligible: 'You can review only after your booking is accepted.',
    invalid_transition: 'That action is no longer possible for this request.',
    beds_below_occupied: 'Total beds cannot be lower than the beds already taken.',
    payload_too_large: 'That upload is too large. Try fewer or smaller photos.',
    not_found: 'Not found.',
    rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
    storage_unavailable: 'Photo storage is not configured.',
    payments_unavailable: 'Payments are not configured yet.',
    payments_upstream_error: 'The payment provider could not be reached. Try again.',
    internal: 'Something went wrong. Please try again.',
  };

  async function request(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new ApiError(0, 'network_error');
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok) {
      const code = (data && data.error) || (res.status === 429 ? 'rate_limited' : 'request_failed');
      throw new ApiError(res.status, code, data && data.issues);
    }
    return data;
  }

  window.ApiError = ApiError;
  window.api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body === undefined ? {} : body),
    patch: (path, body) => request('PATCH', path, body === undefined ? {} : body),
    del: (path) => request('DELETE', path),
  };
  window.apiErrorMessage = function (err) {
    if (!err) return MESSAGES.internal;
    if (err.error === 'validation_failed' && err.issues && err.issues.length) {
      return err.issues[0].message || 'Please check the form and try again.';
    }
    if (err.error === 'network_error') return 'Cannot reach the server. Check your connection.';
    return MESSAGES[err.error] || MESSAGES.internal;
  };
})();
