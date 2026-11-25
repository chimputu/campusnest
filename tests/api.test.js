const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Tests run the Express app in-process unless TEST_BASE_URL points at an
// already-running server. The explicit test flag disables rate limits for
// repeatable in-process tests without weakening production based on NODE_ENV.
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = 'true';
const BASE = process.env.TEST_BASE_URL || null;
let baseUrl = BASE;
let server = null;
let appPool = null;
const stamp = Date.now();
const credentials = {
  tenant: { email: `test.tenant.${stamp}@example.com`, password: 'testpass123' },
  landlord: { email: `test.landlord.${stamp}@example.com`, password: 'testpass123' }
};
const created = { tenantId: null, landlordId: null, listingId: null, requestId: null, code: null };

async function call(method, path, { cookie, body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (cookie) opts.headers.cookie = cookie;
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(baseUrl + path, opts);
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  try { json = await res.json(); } catch (_) { /* empty */ }
  return { status: res.status, json, headers: res.headers, cookie: setCookie ? setCookie.split(';')[0] : null };
}

async function register(role, who) {
  const r = await call('POST', '/api/auth/register', {
    body: { full_name: role === 'TENANT' ? 'Test Tenant' : 'Test Landlord', email: who.email, password: who.password, phone: '+260977000999', role }
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r;
}

before(async () => {
  if (!baseUrl) {
    const app = require('../backend/app');
    appPool = require('../backend/config/db');
    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200, 'server must be reachable');
});

after(async () => {
  let pool = appPool;
  let ownsPool = false;
  if (!pool) {
    const { Pool } = require('pg');
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    ownsPool = true;
  }
  for (const key of ['tenantId', 'landlordId']) {
    if (created[key]) await pool.query('DELETE FROM users WHERE id = $1', [created[key]]);
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  if (ownsPool || appPool) await pool.end();
});

test('health, zones and public browse are reachable', async () => {
  assert.equal((await call('GET', '/api/health')).status, 200);
  const zones = await call('GET', '/api/zones');
  assert.equal(zones.status, 200);
  assert.ok(Array.isArray(zones.json.MAIN));
  const browse = await call('GET', '/api/listings');
  assert.equal(browse.status, 200);
  for (const key of ['listings', 'total', 'limit', 'offset']) assert.ok(key in browse.json, key);
});

test('public config contains no storage credentials and is briefly cacheable', async () => {
  const r = await call('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.storage_configured, 'boolean');
  assert.deepEqual(Object.keys(r.json).sort(), ['cloudinary_cloud_name', 'storage_configured']);
  assert.match(r.headers.get('cache-control') || '', /max-age=60/);
});

test('storage presigning returns 503 when no provider is configured', async () => {
  const { presignPut } = require('../backend/lib/storage');
  await assert.rejects(presignPut(1, 'image/jpeg', 1024, {}), (err) =>
    err.status === 503 && err.code === 'storage_unavailable'
  );
});

test('storage refuses oversized uploads before signing credentials', async () => {
  const { presignPut } = require('../backend/lib/storage');
  await assert.rejects(presignPut(1, 'image/jpeg', 5 * 1024 * 1024 + 1, {}), (err) =>
    err.status === 413 && err.code === 'payload_too_large'
  );
});

test('Cloudinary signatures refuse oversized uploads', () => {
  const { signCloudinaryUpload } = require('../backend/lib/storage');
  const config = {
    CLOUDINARY_CLOUD_NAME: 'campusnest-test',
    CLOUDINARY_API_KEY: 'public-test-key',
    CLOUDINARY_API_SECRET: 'test-secret'
  };
  assert.throws(() => signCloudinaryUpload(42, config, 5 * 1024 * 1024 + 1), (err) =>
    err.status === 413 && err.code === 'payload_too_large'
  );
});

test('browser upload sends file size and uses the local data URL fallback', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  let presignBody;
  const context = {
    window: {},
    queueMicrotask,
    fetch: async (_path, options) => {
      presignBody = JSON.parse(options.body);
      return { status: 503, ok: false, json: async () => ({ error: 'storage_unavailable' }) };
    },
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/png;base64,INPUT'; queueMicrotask(() => this.onload()); }
    },
    Image: class {
      width = 20;
      height = 20;
      set src(_value) { queueMicrotask(() => this.onload()); }
    },
    document: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/jpeg;base64,LOCAL'
      })
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/js/api.js'), 'utf8'), context);
  const file = { type: 'image/png', size: 1024 };
  const result = await context.window.api.uploadListingPhoto(file);
  assert.equal(JSON.stringify(presignBody), JSON.stringify({ content_type: 'image/png', bytes: 1024 }));
  assert.equal(result, 'data:image/jpeg;base64,LOCAL');
});

test('browser upload uses a signed Cloudinary response when storage is configured', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const requests = [];
  const context = {
    window: {},
    FormData: class { append() {} },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/uploads/presign') {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            provider: 'cloudinary',
            upload_url: 'https://api.cloudinary.com/v1_1/campusnest-test/image/upload',
            params: { api_key: 'test-key', timestamp: 123, signature: 'test-signature', folder: 'campusnest/42' }
          })
        };
      }
      return { status: 200, ok: true, json: async () => ({ secure_url: 'https://res.cloudinary.com/campusnest-test/image/upload/photo.jpg' }) };
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/js/api.js'), 'utf8'), context);
  const result = await context.window.api.uploadListingPhoto({ type: 'image/jpeg', size: 2048 });
  assert.equal(result, 'https://res.cloudinary.com/campusnest-test/image/upload/photo.jpg');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].path, '/api/uploads/presign');
  assert.equal(JSON.stringify(JSON.parse(requests[0].options.body)), JSON.stringify({ content_type: 'image/jpeg', bytes: 2048 }));
  assert.equal(requests[1].path, 'https://api.cloudinary.com/v1_1/campusnest-test/image/upload');
});

test('Cloudinary upload signature covers the signed folder and timestamp', () => {
  const crypto = require('node:crypto');
  const { signCloudinaryUpload } = require('../backend/lib/storage');
  const config = {
    CLOUDINARY_CLOUD_NAME: 'campusnest-test',
    CLOUDINARY_API_KEY: 'public-test-key',
    CLOUDINARY_API_SECRET: 'test-secret'
  };
  const signed = signCloudinaryUpload(42, config, 1024);
  const { timestamp, folder, signature, api_key } = signed.params;
  const expected = crypto.createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${config.CLOUDINARY_API_SECRET}`)
    .digest('hex');
  assert.equal(signed.provider, 'cloudinary');
  assert.equal(signed.upload_url, 'https://api.cloudinary.com/v1_1/campusnest-test/image/upload');
  assert.equal(folder, 'campusnest/42');
  assert.equal(api_key, config.CLOUDINARY_API_KEY);
  assert.equal(signature, expected);
});

test('CSP header is present and restrictive', async () => {
  const r = await call('GET', '/');
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp && csp.includes("default-src 'self'"), csp || 'missing CSP');
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.match(csp, /img-src[^;]*https:\/\/res\.cloudinary\.com/);
  assert.doesNotMatch(csp, /connect-src[^;]*https:\/\/res\.cloudinary\.com/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.cloudinary\.com/);
});

test('source files are not exposed over HTTP', async () => {
  for (const path of ['/backend/server.js', '/package.json', '/.env']) {
    assert.equal((await call('GET', path)).status, 404, path);
  }
});

test('cross-origin writes are rejected', async () => {
  const r = await call('POST', '/api/auth/register', {
    body: { full_name: 'Origin Test', email: `origin.${stamp}@example.com`, password: 'testpass123', phone: '+260977000999', role: 'TENANT' },
    headers: { origin: 'https://evil.example' }
  });
  assert.equal(r.status, 403);
});

test('register validation and duplicate email', async () => {
  const bad = await call('POST', '/api/auth/register', {
    body: { full_name: 'Bad', email: `bad.${stamp}@example.com`, password: 'short', phone: '+260977000999', role: 'ADMIN' }
  });
  assert.equal(bad.status, 400);
  const tenant = await register('TENANT', credentials.tenant);
  created.tenantId = tenant.json.user.id;
  const duplicate = await call('POST', '/api/auth/register', {
    body: { full_name: 'Test Tenant', email: credentials.tenant.email, password: credentials.tenant.password, phone: '+260977000999', role: 'TENANT' }
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.error, 'email_taken');
});

test('login / me / logout', async () => {
  const login = await call('POST', '/api/auth/login', { body: credentials.tenant });
  assert.equal(login.status, 200);
  const cookie = login.cookie;
  assert.ok(cookie && cookie.startsWith('cn_session='));
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { cookie })).status, 200);
  assert.equal((await call('POST', '/api/auth/logout', { cookie })).status, 204);
});

test('wrong credentials do not reveal which field failed', async () => {
  const r = await call('POST', '/api/auth/login', { body: { email: `nobody.${stamp}@example.com`, password: 'wrongpass' } });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'invalid_credentials');
});

test('RBAC guards reject wrong roles', async () => {
  assert.equal((await call('POST', '/api/listings', { body: { title: 'x' } })).status, 401);
  const login = await call('POST', '/api/auth/login', { body: credentials.tenant });
  assert.equal((await call('POST', '/api/listings', { cookie: login.cookie, body: { title: 'x' } })).status, 403);
  assert.equal((await call('GET', '/api/admin/stats', { cookie: login.cookie })).status, 403);
});

test('listing create, browse, detail and soft delete', async () => {
  const landlord = await register('LANDLORD', credentials.landlord);
  created.landlordId = landlord.json.user.id;
  const login = await call('POST', '/api/auth/login', { body: credentials.landlord });
  const zones = await call('GET', '/api/zones');
  const zoneId = zones.json.MAIN[0].id;
  const payload = {
    zone_id: zoneId, campus: 'MAIN', title: 'Integration Test House', street_landmark: 'Main Gate',
    occupancy: 'SHARING', gender_policy: 'MIXED_SEPARATE_BLOCKS', electricity: 'INCLUDED_IN_RENT',
    room_type: 'SHARED_ABLUTION', kitchen: 'SHARED_KITCHEN', security_level: 'FENCE_ONLY',
    total_beds: 1, rent_per_month_zmw: 700,
    has_parking: true, water_included: true,
    photos: [{ url: 'data:image/jpeg;base64,' + 'A'.repeat(650000) }]
  };
  const { configured } = require('../backend/lib/storage');
  const missingBytes = await call('POST', '/api/uploads/presign', {
    cookie: login.cookie, body: { content_type: 'image/jpeg' }
  });
  assert.equal(missingBytes.status, 400);
  const oversizedUpload = await call('POST', '/api/uploads/presign', {
    cookie: login.cookie, body: { content_type: 'image/jpeg', bytes: 5 * 1024 * 1024 + 1 }
  });
  assert.equal(oversizedUpload.status, 413);
  assert.equal(oversizedUpload.json.error, 'payload_too_large');
  if (!configured()) {
    const unconfiguredUpload = await call('POST', '/api/uploads/presign', {
      cookie: login.cookie, body: { content_type: 'image/jpeg', bytes: 1024 }
    });
    assert.equal(unconfiguredUpload.status, 503);
    assert.equal(unconfiguredUpload.json.error, 'storage_unavailable');
  }
  const invalidPhoto = await call('POST', '/api/listings', {
    cookie: login.cookie,
    body: { ...payload, photos: [{ url: 'https://example.com/untrusted.jpg' }] }
  });
  assert.equal(invalidPhoto.status, 400);
  const create = await call('POST', '/api/listings', { cookie: login.cookie, body: payload });
  assert.equal(create.status, 201, JSON.stringify(create.json));
  created.listingId = create.json.listing.id;
  const detail = await call('GET', `/api/listings/${created.listingId}`);
  assert.equal(detail.status, 200);
  assert.ok('occupied_beds' in detail.json.listing);
  assert.equal(detail.json.listing.has_parking, true);
  assert.equal(detail.json.listing.water_included, true);
  assert.ok(detail.json.listing.photos[0].url.length > 600000);
  const landlordProfile = detail.json.listing.landlord;
  assert.ok(!('phone' in landlordProfile) && !('email' in landlordProfile), 'public detail must not leak contact data');
  const browse = await call('GET', '/api/listings');
  assert.ok(browse.json.listings.some(l => l.id === created.listingId));
  const filtered = await call('GET', '/api/listings?has_parking=1&water_included=true');
  assert.ok(filtered.json.listings.some(l => l.id === created.listingId));
  const updated = await call('PATCH', `/api/listings/${created.listingId}`, {
    cookie: login.cookie, body: { has_parking: false, water_included: false }
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.listing.has_parking, false);
  assert.equal(updated.json.listing.water_included, false);
  assert.equal((await call('DELETE', `/api/listings/${created.listingId}`, { cookie: login.cookie })).status, 204);
  assert.equal((await call('PATCH', `/api/listings/${created.listingId}`, { cookie: login.cookie, body: { title: 'changed' } })).json.error, 'listing_removed');
});

test('admin user mutations never return password hashes', async () => {
  const env = require('../backend/config/env');
  const adminLogin = await call('POST', '/api/auth/login', {
    body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }
  });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.json));
  const actions = [
    ['POST', `/api/admin/landlords/${created.landlordId}/verify`],
    ['POST', `/api/admin/landlords/${created.landlordId}/unverify`],
    ['POST', `/api/admin/users/${created.tenantId}/suspend`, { reason: 'integration test' }],
    ['POST', `/api/admin/users/${created.tenantId}/reactivate`]
  ];
  for (const [method, path, body] of actions) {
    const response = await call(method, path, { cookie: adminLogin.cookie, body });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.ok(response.json.user);
    assert.ok(!('password_hash' in response.json.user), path);
  }
});

test('request lifecycle and redacted receipt', async () => {
  const zones = await call('GET', '/api/zones');
  const zoneId = zones.json.MAIN[1] ? zones.json.MAIN[1].id : zones.json.MAIN[0].id;
  const landlordLogin = await call('POST', '/api/auth/login', { body: credentials.landlord });
  const tenantLogin = await call('POST', '/api/auth/login', { body: credentials.tenant });
  const create = await call('POST', '/api/listings', {
    cookie: landlordLogin.cookie,
    body: { zone_id: zoneId, campus: 'MAIN', title: 'Receipt Test House', street_landmark: 'Katondo', occupancy: 'SINGLE', gender_policy: 'MALE_ONLY', electricity: 'TENANT_PAYS', room_type: 'SELF_CONTAINED', kitchen: 'NONE', security_level: 'NONE', total_beds: 1, rent_per_month_zmw: 900, deposit_zmw: 900, photos: [] }
  });
  assert.equal(create.status, 201);
  const listingId = create.json.listing.id;
  const req = await call('POST', '/api/requests', {
    cookie: tenantLogin.cookie,
    body: { listing_id: listingId, move_in_date: '2031-01-01', duration_months: 6 }
  });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  created.requestId = req.json.request.id;
  const duplicate = await call('POST', '/api/requests', {
    cookie: tenantLogin.cookie, body: { listing_id: listingId, move_in_date: '2031-01-01', duration_months: 6 }
  });
  assert.equal(duplicate.status, 409);
  const accept = await call('POST', `/api/requests/${created.requestId}/accept`, { cookie: landlordLogin.cookie });
  assert.equal(accept.status, 200, JSON.stringify(accept.json));
  created.code = accept.json.request.reference_code;
  assert.ok(created.code && created.code.startsWith('CN-'));
  const receipt = await call('GET', `/api/receipts/${created.code}`);
  assert.equal(receipt.status, 200);
  for (const key of ['phone', 'email', 'student_id', 'registration_number']) assert.ok(!(key in receipt.json), key);
  assert.equal((await call('GET', '/api/receipts/CN-0000-0000-AAAAAA')).status, 404);
  assert.equal((await call('POST', `/api/requests/${created.requestId}/cancel`, { cookie: tenantLogin.cookie })).status, 200);
  assert.equal((await call('GET', `/api/receipts/${created.code}`)).status, 404);
});
