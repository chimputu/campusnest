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
  await assert.rejects(presignPut(1, 'image/jpeg', {}), (err) =>
    err.status === 503 && err.code === 'storage_unavailable'
  );
});

test('Cloudinary upload signature covers the signed folder and timestamp', () => {
  const crypto = require('node:crypto');
  const { signCloudinaryUpload } = require('../backend/lib/storage');
  const config = {
    CLOUDINARY_CLOUD_NAME: 'campusnest-test',
    CLOUDINARY_API_KEY: 'public-test-key',
    CLOUDINARY_API_SECRET: 'test-secret'
  };
  const signed = signCloudinaryUpload(42, config);
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
    total_beds: 1, rent_per_month_zmw: 700, photos: []
  };
  const { configured } = require('../backend/lib/storage');
  if (!configured()) {
    const unconfiguredUpload = await call('POST', '/api/uploads/presign', {
      cookie: login.cookie, body: { content_type: 'image/jpeg' }
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
  const landlordProfile = detail.json.listing.landlord;
  assert.ok(!('phone' in landlordProfile) && !('email' in landlordProfile), 'public detail must not leak contact data');
  const browse = await call('GET', '/api/listings');
  assert.ok(browse.json.listings.some(l => l.id === created.listingId));
  assert.equal((await call('DELETE', `/api/listings/${created.listingId}`, { cookie: login.cookie })).status, 204);
  assert.equal((await call('PATCH', `/api/listings/${created.listingId}`, { cookie: login.cookie, body: { title: 'changed' } })).json.error, 'listing_removed');
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
