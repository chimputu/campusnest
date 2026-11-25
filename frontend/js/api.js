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
    upload_failed: 'The photo could not be uploaded. Try again.',
    invalid_photo_type: 'Photos must be JPEG, PNG or WebP.',
    photo_too_large: 'Each photo must be 5 MB or smaller.',
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

  /* ---------- listing photo upload ---------- */
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

  function validatePhoto(file) {
    if (!file || !PHOTO_TYPES.includes(file.type)) throw new ApiError(400, 'invalid_photo_type');
    if (file.size > MAX_PHOTO_BYTES) throw new ApiError(413, 'photo_too_large');
  }

  async function uploadToCloudinary(file, url, params) {
    const form = new FormData();
    form.append('file', file);
    Object.entries(params || {}).forEach(([key, value]) => form.append(key, String(value)));
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: form });
    } catch (e) {
      throw new ApiError(0, 'network_error');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON body */ }
    if (!res.ok || !data || !data.secure_url) throw new ApiError(res.status || 0, 'upload_failed');
    return data.secure_url;
  }

  async function uploadToS3(file, url) {
    let res;
    try {
      res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    } catch (e) {
      throw new ApiError(0, 'network_error');
    }
    if (!res.ok) throw new ApiError(res.status, 'upload_failed');
  }

  // Local-dev fallback: compress to a data URL the API already accepts.
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new ApiError(0, 'upload_failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new ApiError(0, 'upload_failed'));
        img.onload = () => {
          const scale = Math.min(1, 800 / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadListingPhoto(file) {
    validatePhoto(file);

    let signature = null;
    try {
      signature = await request('POST', '/api/uploads/presign', { content_type: file.type, bytes: file.size });
    } catch (err) {
      if (err.error !== 'storage_unavailable') throw err;
      return fileToDataUrl(file);
    }

    if (signature && signature.provider === 'cloudinary' && signature.upload_url) {
      return uploadToCloudinary(file, signature.upload_url, signature.params);
    }
    if (signature && signature.provider === 's3' && signature.url) {
      await uploadToS3(file, signature.url);
      return signature.public_url;
    }

    throw new ApiError(0, 'upload_failed');
  }

  window.ApiError = ApiError;
  window.api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body === undefined ? {} : body),
    patch: (path, body) => request('PATCH', path, body === undefined ? {} : body),
    del: (path) => request('DELETE', path),
    uploadListingPhoto,
    fileToDataUrl,
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
