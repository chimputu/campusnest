/* =====================================================================
   CampusNest SPA — Phase 1 (API-backed). Screen/function names preserved.
   Data lives on the server; this file keeps a small in-memory cache.
   ===================================================================== */

/* IMAGES map — unchanged */
const IMAGES = {
  roleBackground:     'image/campusnest-login-background.png',
  registerBackground:'image/campusnest-login-background.png',
  loginBackground:    'image/campusnest-login-background.png',
  homeBanner:         'image/sunlit-student-dorm-retreat.png',
  dashboardBanner:    'image/sunlit-student-dorm-retreat.png',
  listingPhotos: [
    'image/backG.jpg',
    'image/house1.jpg',
    'image/house2.jpg',
    'image/house3.jpg',
    'image/house4.jpg'
  ]
};

const APP_NAME = 'Off Campus Accommodation';
const MAX_PHOTOS = 5;
const OVERLAY = 0.75;

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
const $modal = document.getElementById('modal-root');
const api = window.api;
const apiErrorMessage = window.apiErrorMessage;

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const K = n => 'K ' + Number(n || 0).toLocaleString('en-US');
const initials = n => String(n).replace(/^(Mrs?\.|Dr\.|Ms\.)\s*/i, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = d => { if (!d) return '—'; const x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const uid = p => p + Math.random().toString(36).slice(2, 9);

function waLink(phone, text) {
  let d = String(phone || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '260' + d.slice(1);
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text);
}

/* ---------- in-memory state ---------- */
const S = {
  meUser: null,
  users: [], listings: [], requests: [], inbox: [], reviews: [], saved: [],
  notifications: [], unread: 0,
  zones: { MAIN: [], TOWN: [] },
  admin: { stats: null, landlords: [], reports: [] }
};

const LEGACY_KEYS = ['cn_seeded', 'cn_users', 'cn_listings', 'cn_requests', 'cn_saved', 'cn_session', 'cn_pendingRole', 'cn_ratings'];
function cleanupLegacy() {
  try { LEGACY_KEYS.forEach(k => localStorage.removeItem(k)); } catch (e) { /* storage unavailable */ }
}

function mapUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.full_name || u.name || '', email: u.email || '', phone: u.phone || '',
    role: String(u.role || '').toLowerCase(),
    verified: Boolean(u.landlord_verified !== undefined ? u.landlord_verified : u.verified),
    accountStatus: u.account_status || 'ACTIVE',
    studentId: u.student_id || '', registrationNumber: u.registration_number || '',
    about: u.about || '', since: u.since || '', rating: Number(u.avg_rating) || 0,
    reviewCount: Number(u.review_count) || 0
  };
}

function electricityLabel(v) {
  return ({ INCLUDED_IN_RENT: 'Electricity', PREPAID_ZESCO_SPLIT: 'Prepaid meter', TENANT_PAYS: 'Electricity not included' })[v] || '';
}

function mapListing(l) {
  if (!l) return null;
  const id = Number(l.id);
  const photos = (l.photos || []).map(p => (typeof p === 'string' ? p : p.url)).filter(Boolean);
  const cover = l.cover_photo_url || photos[0] || '';
  const amenities = [];
  if (l.security_level && l.security_level !== 'NONE') amenities.push('Security');
  if (l.kitchen === 'SHARED_KITCHEN') amenities.push('Kitchen');
  if (l.furnished) amenities.push('Furnished');
  if (l.has_parking) amenities.push('Parking');
  const utilities = [];
  if (l.electricity) utilities.push(electricityLabel(l.electricity));
  if (l.free_wifi) utilities.push('WiFi');
  if (l.water_included) utilities.push('Water');
  return {
    id, ownerId: Number(l.landlord_id || (l.landlord && l.landlord.id) || 0),
    campus: l.campus || 'MAIN', zoneId: Number(l.zone_id || 0),
    title: l.title || '', location: l.street_landmark || l.location || '',
    distance: Number(l.distance_to_campus_km || l.distance) || 1,
    price: Number(l.rent_per_month_zmw || l.price) || 0,
    deposit: Number(l.deposit_zmw || l.deposit) || 0,
    bedrooms: Number(l.total_beds || l.bedrooms) || 1, bathrooms: 1, perRoom: 1,
    selfContained: l.room_type === 'SELF_CONTAINED',
    available: l.status === 'ACTIVE', status: l.status || 'ACTIVE',
    availableFrom: l.created_at ? String(l.created_at).slice(0, 10) : '',
    utilities, amenities, description: l.description || '',
    hue: (id * 47) % 360, mapX: 120 + ((id * 83) % 420), mapY: 90 + ((id * 137) % 250),
    images: photos.length ? photos : (cover ? [cover] : []), img: cover,
    occupiedBeds: Number(l.occupied_beds) || 0, totalBeds: Number(l.total_beds) || 1,
    landlord: l.landlord ? {
      id: l.landlord.id, name: l.landlord.name, verified: l.landlord.verified,
      avg_rating: l.landlord.avg_rating, phone: l.landlord.phone, email: l.landlord.email
    } : null
  };
}

function mapStatus(v) {
  if (v === 'PENDING') return 'pending';
  if (v === 'ACCEPTED') return 'accepted';
  if (v === 'COMPLETED') return 'completed';
  return 'declined';
}

function mapRequest(r) {
  return {
    id: r.id, listingId: Number(r.listing_id), tenantId: Number(r.tenant_id),
    moveIn: r.move_in_date || '', duration: Number(r.duration_months) || 1,
    message: r.note || '', status: mapStatus(r.status), rawStatus: r.status,
    created: r.created_at ? Date.parse(r.created_at) : Date.now(),
    referenceCode: r.reference_code || '', acceptedAt: r.accepted_at || '',
    landlord: r.landlord || null,
    listingTitle: r.listing_title || '', zoneName: r.zone_name || '',
    coverPhotoUrl: r.cover_photo_url || '',
    tenantName: r.tenant_name || '', tenantDisplayName: r.tenant_display_name || '',
    tenantPhone: r.tenant_phone || '', studentId: r.student_id || '', registrationNumber: r.registration_number || '',
    listing: listingById(Number(r.listing_id))
  };
}

function mapReview(r) {
  return { landlordId: r.landlordId, tenantId: r.tenantId, stars: r.stars, comment: r.body || r.comment || '', created: r.created, reviewer: r.reviewer };
}

function upsertUser(u) {
  if (!u) return;
  const i = S.users.findIndex(x => x.id === u.id);
  if (i >= 0) S.users[i] = { ...S.users[i], ...u }; else S.users.push(u);
}

function users() { return S.users; }
function listings() { return S.listings; }
function requests() { return S.requests; }
function ratings() { return S.reviews; }
function me() { return S.meUser; }
function userById(id) { return S.users.find(u => String(u.id) === String(id)); }
function listingById(id) { return S.listings.find(l => String(l.id) === String(id)); }
function savedIds() { return S.saved; }

function ratingOf(o) {
  const rs = ratings().filter(r => String(r.landlordId) === String(o.id));
  const base = o.reviewCount || 0, n = base + rs.length;
  const sum = (o.rating || 0) * base + rs.reduce((a, r) => a + r.stars, 0);
  return { avg: n ? Math.round(sum / n * 10) / 10 : 0, count: n };
}

/* ---------- UI state ---------- */
let pendingRole = null;
let filters = { q: '', maxPrice: '', perRoom: '', selfContained: false, availableOnly: false, wifi: false, sort: 'near', open: false };
let formImgs = [];
let contactCache = {};
let notifThrottle = 0;

function toastTimerFn() {}
let toastTimer;
function toast(msg) {
  $toast.textContent = msg; $toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.remove('show'), 4000);
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function surface(err) { toast(apiErrorMessage(err)); }

let fbCount = 0;
document.addEventListener('error', e => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && !t.dataset.fb) { t.dataset.fb = '1'; t.src = photo(40 + (fbCount++ % 6) * 55, fbCount % 3); }
}, true);

const ICON = {
  logo: '<svg viewBox="0 0 32 32" fill="none"><path d="M3 15 16 4l13 11" stroke="#0f4c5c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 14v12h18V14" stroke="#0f4c5c" stroke-width="3" stroke-linejoin="round"/><rect x="13" y="18" width="6" height="8" rx="1" fill="#f2b134"/></svg>',
  tenant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  landlord: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-7h6v7"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>'
};

function homeFor(u) { return !u ? '#/home' : u.role === 'admin' ? '#/admin' : u.role === 'landlord' ? '#/dashboard' : '#/home'; }

/* ---------- data loading ---------- */
function queryFromFilters() {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.maxPrice) p.set('max_price', filters.maxPrice);
  if (filters.perRoom && filters.perRoom !== '4') p.set('occupancy', Number(filters.perRoom) === 1 ? 'SINGLE' : 'SHARING');
  if (filters.selfContained) p.set('room_type', 'SELF_CONTAINED');
  if (filters.availableOnly) p.set('status_available', '1');
  if (filters.wifi) p.set('free_wifi', 'true');
  if (filters.sort === 'near') p.set('sort', 'distance');
  else if (filters.sort === 'low') p.set('sort', 'price');
  else if (filters.sort === 'high') p.set('sort', 'price');
  return p.toString();
}

async function loadListings() {
  const mine = me() && me().role === 'landlord' ? '&mine=1' : '';
  try {
    const data = await api.get('/api/listings?' + queryFromFilters() + mine);
    S.listings = (data.listings || []).map(mapListing);
    S.listings.forEach(l => { if (l.landlord) upsertUser(mapUser({ ...l.landlord, role: 'LANDLORD' })); });
  } catch (e) { surface(e); }
}

async function loadSaved() {
  if (!me() || me().role !== 'tenant') { S.saved = []; return; }
  try { const d = await api.get('/api/saved'); S.saved = (d.listings || []).map(l => Number(l.id)); }
  catch (e) { surface(e); }
}

async function loadMyRequests() {
  if (!me() || me().role !== 'tenant') { S.requests = []; return; }
  try { const d = await api.get('/api/requests/mine'); S.requests = (d.requests || []).map(mapRequest); }
  catch (e) { surface(e); }
}

async function loadInbox() {
  if (!me() || me().role !== 'landlord') { S.inbox = []; return; }
  try { const d = await api.get('/api/requests/inbox'); S.inbox = (d.requests || []).map(mapRequest); }
  catch (e) { surface(e); }
}

async function loadReviews(listingId) {
  try {
    const d = await api.get('/api/listings/' + listingId + '/reviews');
    S.reviews = (d.reviews || []).map(r => mapReview({
      landlordId: null, tenantId: null, stars: r.stars, body: r.body,
      created: r.created_at ? Date.parse(r.created_at) : Date.now(), reviewer: r.reviewer
    })).map(r => withLandlord(r, listingId));
  } catch (e) { surface(e); }
}
function withLandlord(review, listingId) {
  const l = listingById(listingId);
  review.landlordId = l ? l.ownerId : null;
  return review;
}

async function loadNotifications() {
  if (!me()) { S.notifications = []; S.unread = 0; return; }
  const now = Date.now();
  if (now - notifThrottle < 10000 && S.notifications.length) return;
  notifThrottle = now;
  try {
    const d = await api.get('/api/notifications');
    S.notifications = d.notifications || []; S.unread = Number(d.unread_count) || 0;
  } catch (e) { surface(e); }
}

async function loadAdmin() {
  if (!me() || me().role !== 'admin') return;
  try { S.admin.stats = await api.get('/api/admin/stats'); } catch (e) { surface(e); }
  try { S.admin.landlords = (await api.get('/api/admin/landlords')).landlords || []; } catch (e) { surface(e); }
  try { S.admin.reports = (await api.get('/api/admin/reports?status=OPEN')).reports || []; } catch (e) { surface(e); }
}

async function hydrate(page, parts) {
  await loadListings();
  await loadSaved();
  await loadMyRequests();
  await loadInbox();
  await loadNotifications();
  if (page === 'admin') await loadAdmin();
  const detailId = (page === 'listing' || page === 'owner' || page === 'receipt') ? parts[1] : null;
  if (detailId) await loadReviews(detailId);
}

async function refreshMe(silent) {
  try {
    const d = await api.get('/api/auth/me');
    S.meUser = mapUser(d.user);
    try { sessionStorage.setItem('cn_user', JSON.stringify(S.meUser)); } catch (e) { /* ignore */ }
  } catch (e) {
    if (e.status === 401) {
      S.meUser = null;
      try { sessionStorage.removeItem('cn_user'); } catch (_) { /* ignore */ }
    } else if (e.status === 403) {
      S.meUser = null;
      try { sessionStorage.removeItem('cn_user'); } catch (_) { /* ignore */ }
      if (!silent) toast('This account has been suspended.');
    } else if (!silent) surface(e);
  }
}

/* ---------- layout pieces ---------- */
function authLayout(title, sub, inner, bgUrl) {
  return `<div class="auth2" style="${bg(bgUrl, ' fixed')}">
    <header class="auth2-top">
      <a class="logo logo-pill" href="#/role">${ICON.logo}${APP_NAME}</a>
      <nav aria-label="Account"><a class="btn btn-ghost-w btn-sm" href="#/login">Log in</a><a class="btn btn-accent btn-sm" href="#/role">Sign up</a></nav>
    </header>
    <main class="auth2-body" id="main" tabindex="-1">
      <section class="auth2-hero" aria-label="About ${APP_NAME}"><h1>${esc(title)}</h1><p>${esc(sub)}</p>
        <ul class="auth2-points"><li>Browse boarding houses close to campus</li><li>Filter by price, people per room and WiFi</li><li>Contact landlords by phone, email or WhatsApp</li></ul></section>
      <section class="auth-box" aria-label="Account form">${inner}</section>
    </main>
    <footer class="auth2-foot"><p>&copy; 2026 ${APP_NAME}</p></footer>
  </div>`;
}

function shell(inner, active) {
  const u = me();
  const bell = u ? `<button class="btn btn-ghost btn-sm bell" data-act="toggle-notifs" aria-label="Notifications">${ICON.bell}${S.unread ? ` <span class="nbadge">${S.unread}</span>` : ''}</button>` : '';
  let items;
  if (!u) items = [['#/home', 'Home', 'home'], ['#/map', 'Map', 'map']];
  else if (u.role === 'admin') items = [['#/admin', 'Admin panel', 'admin']];
  else if (u.role === 'landlord') {
    const pend = S.inbox.filter(r => r.status === 'pending').length;
    items = [['#/dashboard', 'Dashboard', 'dashboard'], ['#/add-listing', 'Add listing', 'add'], ['#/requests', 'Requests' + (pend ? ` <span class="nbadge">${pend}</span>` : ''), 'requests'], ['#/profile', 'My profile', 'profile']];
  } else items = [['#/home', 'Home', 'home'], ['#/map', 'Map', 'map'], ['#/saved', 'Saved', 'saved'], ['#/my-requests', 'My requests', 'mine']];

  const userbox = u
    ? `<span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><span class="uname">${esc(u.name)}</span>${bell}<button class="btn btn-ghost btn-sm" data-act="logout">Log out</button>`
    : `<a class="btn btn-ghost btn-sm" href="#/login">Log in</a>`;

  $app.innerHTML = `<header class="topbar"><div class="topbar-in">
      <a class="logo" href="${homeFor(u)}">${ICON.logo}${APP_NAME}</a>
      <nav class="nav" aria-label="Main">${items.map(i => `<a href="${i[0]}" ${i[2] === active ? 'aria-current="page"' : ''}>${i[1]}</a>`).join('')}</nav>
      <div class="userbox">${userbox}</div>
    </div></header><main class="container" id="main" tabindex="-1">${inner}</main>
    <footer class="site-footer"><p>&copy; 2026 ${APP_NAME}. Helping students find a safe place to stay near campus.</p></footer>`;
  window.scrollTo(0, 0);
}

function availBadge(l) {
  return l.available ? '<span class="badge go">Available</span>' : `<span class="badge ${l.status === 'FULL' ? 'stop' : 'wait'}">${l.status === 'FULL' ? 'Full' : 'Paused'}</span>`;
}

function imgs(l) {
  return (l.images && l.images.length) ? l.images.slice(0, MAX_PHOTOS)
    : [l.img || pickPhoto(l.hue, 0), pickPhoto(l.hue, 1), pickPhoto(l.hue, 2), pickPhoto(l.hue, 3)];
}
function pickPhoto(seed, n) {
  const list = IMAGES.listingPhotos;
  return list[(Math.abs(Math.round(Number(seed) || 0)) + n) % list.length];
}
function bg(url, extra) {
  return `background:linear-gradient(rgba(15,76,92,${OVERLAY}),rgba(15,76,92,${OVERLAY})),url('${url}') center/cover no-repeat${extra || ''};background-color:#0f4c5c;`;
}

function cardHtml(l, withSave) {
  const saved = savedIds().includes(l.id);
  return `<article class="card" data-act="open-listing" data-id="${l.id}">
    <div class="ph"><img src="${imgs(l)[0]}" alt="" loading="lazy">${availBadge(l)}${(l.images && l.images.length > 1) ? `<span class="photo-count">${l.images.length} photos</span>` : ''}
      ${withSave && me() && me().role === 'tenant' ? `<button class="save-btn" data-act="toggle-save" data-id="${l.id}" aria-label="${saved ? 'Remove from saved' : 'Save listing'}">${saved ? '♥' : '♡'}</button>` : ''}</div>
    <div class="body"><h3><a class="card-link" href="#/listing/${l.id}">${esc(l.title)}</a></h3>
      <div class="loc">${esc(l.location)} | ${l.distance} km to campus</div>
      <div class="price">${K(l.price)} <small>/ month</small></div>
      <div class="tags"><span class="tag">${l.totalBeds} beds</span><span class="tag">${l.selfContained ? 'Self-contained' : 'Shared bathroom'}</span></div>
    </div></article>`;
}

/* ---------- auth screens ---------- */
function viewRole() {
  $app.innerHTML = authLayout('Find a room that\'s close to class.', APP_NAME + ' connects off-campus students with landlords who have boarding houses nearby.', `
    <h2>Join as a…</h2><p style="color:var(--muted)">Choose how you will use the app.</p>
    <div class="role-grid">
      <button class="role-card" data-act="pick-role" data-role="tenant" aria-pressed="${pendingRole === 'tenant'}"><span class="ico">${ICON.tenant}</span><span><strong>Tenant</strong><span class="sub">I am looking for a place to rent near campus.</span></span></button>
      <button class="role-card" data-act="pick-role" data-role="landlord" aria-pressed="${pendingRole === 'landlord'}"><span class="ico">${ICON.landlord}</span><span><strong>Landlord</strong><span class="sub">I want to list my property for students to find.</span></span></button>
    </div>
    <button class="btn btn-primary btn-block" id="role-continue" data-act="role-continue" ${pendingRole ? '' : 'disabled'}>Continue</button>
    <p class="auth-switch">Already have an account? <a href="#/login">Log in</a></p>`, IMAGES.roleBackground);
}

function viewRegister() {
  if (!pendingRole) return go('#/role');
  $app.innerHTML = authLayout('Create your account', pendingRole === 'tenant' ? 'Browse boarding houses, save favourites and send space requests.' : 'List your boarding houses and answer student requests in one place.', `
    <h2>Create your account</h2>
    <div class="role-chip">Registering as: <strong>${pendingRole === 'tenant' ? 'Tenant' : 'Landlord'}</strong> <a href="#/role" class="btn btn-ghost btn-sm">Change</a></div>
    <form data-form="register" novalidate>
      <div id="form-error"></div>
      <div class="field"><label for="r-name">Name</label><input id="r-name" name="name" type="text" placeholder="Full name" autocomplete="name" required></div>
      <div class="field"><label for="r-email">Email</label><input id="r-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required></div>
      <div class="field"><label for="r-phone">Phone number</label><input id="r-phone" name="phone" type="tel" placeholder="+260 9XX XXX XXX" autocomplete="tel" required><div class="hint">Shown to ${pendingRole === 'tenant' ? 'landlords you contact' : 'students who want to reach you'}.</div></div>
      ${pendingRole === 'tenant' ? '<div class="field"><label for="r-sid">Student ID</label><input id="r-sid" name="student_id" type="text" placeholder="University student ID"></div>' : ''}
      <div class="field-row">
        <div class="field"><label for="r-pass">Password</label><input id="r-pass" name="password" type="password" placeholder="At least 8 characters" autocomplete="new-password" required><div class="hint">At least 8 characters, with a letter and a number.</div></div>
        <div class="field"><label for="r-pass2">Confirm password</label><input id="r-pass2" name="password2" type="password" placeholder="Repeat password" autocomplete="new-password" required></div>
      </div>
      <label class="show-pw" for="r-show" style="margin:-.3rem 0 1rem"><input id="r-show" type="checkbox" data-act="toggle-pw"> Show passwords</label>
      <fieldset class="field fieldset"><legend class="lbl">Preferred way to be contacted</legend><div class="check-row">
        <label for="r-c-phone"><input id="r-c-phone" type="radio" name="contact" value="Phone call"> Phone call</label>
        <label for="r-c-wa"><input id="r-c-wa" type="radio" name="contact" value="WhatsApp"> WhatsApp</label>
        <label for="r-c-mail"><input id="r-c-mail" type="radio" name="contact" value="Email"> Email</label></div></fieldset>
      <div class="field"><label for="r-year">${pendingRole === 'tenant' ? 'Year of study' : 'Properties you manage'}</label>
        <select id="r-year" name="year"><option value="">Select an option</option>${(pendingRole === 'tenant' ? ['1st year', '2nd year', '3rd year', '4th year', '5th year or above', 'Postgraduate'] : ['1 property', '2 to 3 properties', '4 or more properties']).map(o => `<option>${o}</option>`).join('')}</select></div>
      <div class="field"><label for="r-terms" class="chk-l"><input id="r-terms" type="checkbox" name="terms"> I agree to the terms of use and to share my contact details with ${pendingRole === 'tenant' ? 'landlords I contact' : 'students who contact me'}.</label></div>
      <button class="btn btn-primary btn-block" type="submit">Register</button>
    </form>
    <p class="auth-switch">Already have an account? <a href="#/login">Log in</a></p>`, IMAGES.registerBackground);
}

function viewLogin() {
  $app.innerHTML = authLayout('Welcome back', 'Log in to continue your search or manage your listings.', `
    <h2>Log in</h2>
    <form data-form="login" novalidate>
      <div id="form-error"></div>
      <div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required></div>
      <div class="field"><label for="l-pass">Password</label><input id="l-pass" name="password" type="password" placeholder="Your password" autocomplete="current-password" required><label class="show-pw"><input type="checkbox" data-act="toggle-pw"> Show password</label></div>
      <button class="btn btn-primary btn-block" type="submit">Log in</button>
    </form>
    <p class="auth-switch">New here? <a href="#/role">Create an account</a></p>`, IMAGES.loginBackground);
}

/* ---------- tenant screens ---------- */
function filtered() {
  const q = filters.q.trim().toLowerCase();
  return listings().filter(l => {
    if (q && !((l.title + ' ' + l.location).toLowerCase().includes(q))) return false;
    if (filters.maxPrice && l.price > Number(filters.maxPrice)) return false;
    if (filters.availableOnly && !l.available) return false;
    return true;
  }).sort((a, b) => filters.sort === 'low' ? a.price - b.price : filters.sort === 'high' ? b.price - a.price : a.distance - b.distance);
}

function drawCards() {
  const list = filtered(); const box = document.getElementById('cards'); if (!box) return;
  document.getElementById('count').textContent = list.length + (list.length === 1 ? ' place' : ' places');
  box.innerHTML = list.length ? list.map(l => cardHtml(l, true)).join('') :
    '<div class="empty" style="grid-column:1/-1"><h3>No places match</h3><p>Try a higher price, or clear a filter.</p><button class="btn btn-ghost" data-act="clear-filters">Clear filters</button></div>';
}

async function viewHome() {
  await loadListings();
  const u = me();
  shell(`<section class="welcome" style="${bg(IMAGES.homeBanner)}border-radius:14px;padding:1.5rem;color:#fff;">
      <h1 style="color:#fff">${u ? 'Welcome, ' + esc(u.name.split(' ')[0]) : 'Find a place near campus'}</h1><p style="color:#fff">Find a boarding house close to campus, then send the landlord a request.</p>
      <div class="searchbar"><input type="search" data-filter="q" value="${esc(filters.q)}" placeholder="Search area or name…" aria-label="Search area or name">
        <button class="btn btn-accent" data-act="toggle-filters" aria-expanded="${filters.open}">Filters</button></div>
      <div class="filters" id="filters" ${filters.open ? '' : 'hidden'}>
        <div><label for="f-price">Max price (K / month)</label><input id="f-price" type="number" min="0" step="50" data-filter="maxPrice" value="${esc(filters.maxPrice)}" placeholder="Any"></div>
        <div><label for="f-room">People per room</label><select id="f-room" data-filter="perRoom"><option value="">Any</option>${[1, 2, 3].map(n => `<option value="${n}" ${filters.perRoom == n ? 'selected' : ''}>${n}</option>`).join('')}<option value="4" ${filters.perRoom == '4' ? 'selected' : ''}>4 or more</option></select></div>
        <div><label for="f-sort">Sort by</label><select id="f-sort" data-filter="sort"><option value="near" ${filters.sort === 'near' ? 'selected' : ''}>Nearest to campus</option><option value="low" ${filters.sort === 'low' ? 'selected' : ''}>Price: low to high</option><option value="high" ${filters.sort === 'high' ? 'selected' : ''}>Price: high to low</option></select></div>
        <label class="chk" for="f-self"><input id="f-self" type="checkbox" data-filter="selfContained" ${filters.selfContained ? 'checked' : ''}> Self-contained only</label>
        <label class="chk" for="f-avail"><input id="f-avail" type="checkbox" data-filter="availableOnly" ${filters.availableOnly ? 'checked' : ''}> Available only</label>
        <label class="chk" for="f-wifi"><input id="f-wifi" type="checkbox" data-filter="wifi" ${filters.wifi ? 'checked' : ''}> WiFi included</label>
      </div></section>
    <div class="section-head"><h2>Available near campus <small id="count" style="font-size:.9rem;color:var(--muted);font-family:var(--font-body);font-weight:400"></small></h2><a href="#/map" class="btn btn-ghost btn-sm">Map view</a></div>
    <div class="grid" id="cards"></div>`, 'home');
  drawCards();
}

async function viewSaved() {
  await loadSaved();
  const ids = savedIds(); const list = listings().filter(l => ids.includes(l.id) || ids.includes(String(l.id)));
  shell(`<div class="page-head"><div><h1>Saved places</h1><p>Listings you've bookmarked.</p></div></div>
    ${list.length ? `<h2 class="sr-only">Saved listings</h2><div class="grid">${list.map(l => cardHtml(l, true)).join('')}</div>` : '<div class="empty"><h3>Nothing saved yet</h3><p>Tap the heart on a listing to keep it here.</p><a class="btn btn-primary" href="#/home">Browse listings</a></div>'}`, 'saved');
}

function viewMyRequests() {
  const list = requests().slice().sort((a, b) => b.created - a.created);
  shell(`<div class="page-head"><div><h1>My requests</h1><p>Space requests you've sent to landlords.</p></div></div>
    ${list.length ? `<h2 class="sr-only">Your requests</h2><div class="req-list">${list.map(r => { const l = r.listing; if (!l) return ''; const statusLabel = r.status === 'accepted' ? 'Accepted' : r.status === 'completed' ? 'Completed' : r.status === 'declined' ? 'Declined' : 'Waiting for reply'; const badge = r.status === 'accepted' || r.status === 'completed' ? 'go' : r.status === 'declined' ? 'stop' : 'wait';
      return `<div class="req"><div class="info"><h3 style="margin:0">${esc(l.title)}</h3><p>${esc(l.location)} | ${K(l.price)} / month | Move in ${fmtDate(r.moveIn)}</p><p>"${esc(r.message || 'No message')}"</p>${r.referenceCode ? `<p>Reference: <strong>${esc(r.referenceCode)}</strong> <a href="#/receipt/${encodeURIComponent(r.referenceCode)}">View receipt</a></p>` : ''}</div>
      <div style="text-align:right"><span class="badge ${badge}">${statusLabel}</span>
      <div class="actions" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-act="open-listing" data-id="${l.id}">View listing</button>
      ${r.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-act="cancel-request" data-id="${r.id}">Cancel</button>` : ''}
      ${r.status === 'accepted' ? `<button class="btn btn-ghost btn-sm" data-act="complete-request" data-id="${r.id}">Mark complete</button>` : ''}
      ${r.landlord && (r.status === 'accepted' || r.status === 'completed') ? `<button class="btn btn-primary btn-sm" data-act="contact" data-id="${l.id}">Contact owner</button>` : ''}</div></div></div>`; }).join('')}</div>`
      : '<div class="empty"><h3>No requests yet</h3><p>Open a listing and choose "Request a space".</p><a class="btn btn-primary" href="#/home">Browse listings</a></div>'}`, 'mine');
}

function contactFor(l) {
  const u = me(); if (!u) return null;
  if (u.id === l.ownerId && l.landlord) return { phone: l.landlord.phone, email: l.landlord.email };
  if (u.role === 'tenant') {
    const r = requests().find(x => x.listingId === l.id && ['accepted', 'completed'].includes(x.status));
    if (r && r.landlord) return { phone: r.landlord.phone, email: r.landlord.email };
  }
  return null;
}

async function viewListing(id) {
  try {
    const d = await api.get('/api/listings/' + encodeURIComponent(id));
    const raw = d.listing;
    const l = mapListing(raw);
    const idx = S.listings.findIndex(x => String(x.id) === String(l.id));
    if (idx >= 0) S.listings[idx] = l; else S.listings.push(l);
    if (l.landlord) upsertUser(mapUser({ ...l.landlord, role: 'LANDLORD' }));
    await loadReviews(l.id);
    contactCache[l.id] = contactFor(l);
    const owner = userById(l.ownerId) || mapUser({ ...l.landlord, role: 'LANDLORD' });
    const u = me(); const isOwner = u && u.id === l.ownerId; const tenant = u && u.role === 'tenant';
    const pics = imgs(l); const saved = savedIds().includes(l.id);
    const myReq = requests().find(r => r.listingId === l.id);
    let reqBtn = '';
    if (tenant) {
      if (myReq) reqBtn = `<span class="badge ${myReq.status === 'accepted' ? 'go' : myReq.status === 'declined' ? 'stop' : 'wait'}">Request ${myReq.status}</span>`;
      else if (l.available) reqBtn = `<button class="btn btn-accent" data-act="request" data-id="${l.id}">Request a space</button>`;
      else reqBtn = '<button class="btn btn-ghost" disabled>Currently full</button>';
    }
    const contact = contactCache[l.id];
    const contactBtn = contact && (contact.phone || contact.email)
      ? `<button class="btn btn-primary" data-act="contact" data-id="${l.id}">Contact owner</button>`
      : (tenant ? '<p class="hint">Contact details appear once your request is accepted.</p>' : '');
    shell(`<a class="back" href="${tenant ? '#/home' : '#/dashboard'}">‹ ${tenant ? 'Back to results' : 'Back to dashboard'}</a>
      <div class="detail-top"><div class="price" style="font-size:1.8rem">${K(l.price)} <small>/ month</small></div>${availBadge(l)} <span class="tag">${l.occupiedBeds}/${l.totalBeds} beds taken</span></div>
      <div class="detail-grid">
        <div><div class="main-photo zoomable" data-act="lightbox" data-id="${l.id}" tabindex="0" role="button" title="Click to enlarge"><img id="main-img" src="${pics[0]}" alt="Photo of ${esc(l.title)}"></div>
          <div class="thumbs">${pics.slice(1).map((p, i) => `<button data-act="swap-img" data-src="${p}" aria-pressed="false" aria-label="Show photo ${i + 2}"><img src="${p}" alt=""></button>`).join('')}</div>
          <div class="panel" style="margin-top:1rem"><h2 style="font-size:1.15rem">About this place</h2><p style="margin:0">${esc(l.description)}</p></div></div>
        <div>
          <div class="panel"><h1 style="font-size:1.6rem">${esc(l.title)}</h1><p style="color:var(--muted)">${esc(l.location)} | ${l.distance} km from campus</p>
            <button class="owner-row" data-act="open-owner" data-id="${l.ownerId}" data-l="${l.id}"><span class="avatar">${esc(initials(owner.name))}</span><span class="who"><strong>${esc(owner.name)}</strong><small>${owner.verified ? 'Verified landlord' : 'Landlord'} | View full profile</small></span><span>›</span></button>
            <div class="tags" style="margin:1rem 0">${[l.bedrooms + ' beds', l.selfContained ? 'Self-contained' : 'Shared bathroom'].concat(l.utilities.map(x => x + ' incl.')).concat(l.amenities).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
            <dl class="facts"><div><dt>Deposit</dt><dd>${K(l.deposit)}</dd></div><div><dt>Available from</dt><dd>${fmtDate(l.availableFrom)}</dd></div><div><dt>Distance to campus</dt><dd>${l.distance} km</dd></div></dl>
            <div class="actions">${tenant ? `${reqBtn}${contactBtn}
              <button class="btn btn-ghost" data-act="toggle-save" data-id="${l.id}" data-refresh="1">${saved ? '♥ Saved' : '♡ Save'}</button>
              <a class="btn btn-ghost" href="#/map/${l.id}">View on map</a>
              <button class="btn btn-ghost" data-act="copy-link">Share link</button>
              ${tenant ? `<button class="btn btn-ghost btn-sm" data-act="report" data-id="${l.id}">Report this listing</button>` : ''}` : (isOwner ? `<a class="btn btn-primary" href="#/edit/${l.id}">Edit listing</a>` : '')}</div>
          </div></div>
      </div>`, tenant ? 'home' : 'dashboard');
  } catch (e) {
    if (e.status === 404) { toast('Listing not found'); return go(me() && me().role === 'landlord' ? '#/dashboard' : '#/home'); }
    surface(e);
  }
}

function viewOwner(oid, lid) {
  const o = userById(oid); if (!o) return go('#/home');
  const props = listings().filter(l => l.ownerId === Number(oid));
  const sel = props.find(l => String(l.id) === String(lid)) || props[0];
  const pics = sel ? imgs(sel) : [];
  const rt = ratingOf(o); const stars = '★'.repeat(Math.round(rt.avg)) + '☆'.repeat(5 - Math.round(rt.avg));
  const canContact = Boolean(contactCache[sel && sel.id] || (me() && me().id === o.id));
  shell(`<a class="back" href="${sel ? '#/listing/' + sel.id : '#/home'}">‹ Back to listing</a>
    <div class="profile-grid">
      <aside class="panel"><div class="profile-photo">${esc(initials(o.name))}</div><h1 style="font-size:1.5rem">${esc(o.name)}</h1>
        ${o.verified ? '<span class="badge go">Verified landlord</span>' : '<span class="badge wait plain">Not yet verified</span>'}
        <p style="margin:.8rem 0 0"><span class="stars">${stars}</span> ${rt.count ? rt.avg + ' / 5 (' + rt.count + ' review' + (rt.count > 1 ? 's' : '') + ')' : 'No reviews yet'}</p>
        <ul class="contact-list"><li><span>Phone</span><span>${esc(o.phone || '—')}</span></li><li><span>Email</span><span>${esc(o.email || '—')}</span></li><li><span>Member since</span><span>${esc(o.since || '—')}</span></li><li><span>Properties listed</span><span>${props.length}</span></li></ul>
        <h2 style="font-size:1.15rem">About the owner</h2><p>${esc(o.about || 'This landlord has not added a description yet.')}</p>
        ${me() && me().role === 'tenant' && sel && canContact ? `<button class="btn btn-primary btn-block" data-act="contact" data-id="${sel.id}">Contact owner</button>` : ''}</aside>
      <section>${sel ? `<div class="panel"><div class="detail-top" style="margin-bottom:.6rem"><div><h2 style="margin:0">${esc(sel.title)}</h2><span style="color:var(--muted)">${esc(sel.location)} | ${sel.distance} km from campus</span></div><div class="price">${K(sel.price)} <small>/ month</small></div></div>
        <div class="main-photo"><img src="${pics[0]}" alt=""></div><div class="thumbs">${pics.slice(1).map(p => `<button disabled><img src="${p}" alt=""></button>`).join('')}</div></div>
        <div class="panel"><h3>Property details</h3><dl class="facts"><div><dt>Beds</dt><dd>${sel.totalBeds}</dd></div><div><dt>Distance to campus</dt><dd>${sel.distance} km</dd></div><div><dt>Deposit</dt><dd>${K(sel.deposit)}</dd></div><div><dt>Utilities</dt><dd>${sel.utilities.join(', ') || 'None included'}</dd></div></dl>
          <div class="tags" style="margin-top:1rem">${sel.amenities.map(a => `<span class="tag">${esc(a)}</span>`).join('')}</div><p style="margin:1rem 0 0">${esc(sel.description)}</p>
          <div class="actions"><button class="btn btn-ghost" data-act="open-listing" data-id="${sel.id}">Open listing</button></div></div>` : '<div class="empty">This landlord has no listings yet.</div>'}
        ${props.length > 1 ? `<div class="panel"><h3>All properties (${props.length})</h3><div class="mini-list">${props.map(p => `<button class="mini ${sel && p.id === sel.id ? 'on' : ''}" data-act="open-owner" data-id="${o.id}" data-l="${p.id}"><img src="${imgs(p)[0]}" alt=""><span class="t"><strong>${esc(p.title)}</strong><br><small>${K(p.price)} / month</small></span>${availBadge(p)}</button>`).join('')}</div></div>` : ''}
      ${reviewsPanel(o)}</section></div>`, me() && me().role === 'tenant' ? 'home' : 'dashboard');
}

function reviewsPanel(o) {
  const u = me(); const rs = ratings().filter(r => String(r.landlordId) === String(o.id)).sort((a, b) => b.created - a.created);
  const ids = listings().filter(l => l.ownerId === o.id).map(l => l.id);
  const can = u && u.role === 'tenant' && requests().some(r => r.tenantId === u.id && r.status === 'accepted' && ids.includes(r.listingId));
  const mine = rs.find(r => u && r.tenantId === u.id);
  const form = can ? `<form data-form="review" data-id="${o.id}" data-listing="${ids[0] || ''}" novalidate style="margin-bottom:1rem">
      <div class="field"><label for="v-stars">Your rating</label><select id="v-stars" name="stars">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${mine && mine.stars === n ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)} (${n})</option>`).join('')}</select></div>
      <div class="field"><label for="v-msg">Comment</label><textarea id="v-msg" name="comment" placeholder="How was your stay?">${esc(mine ? mine.comment : '')}</textarea></div>
      <button class="btn btn-primary btn-sm" type="submit">${mine ? 'Update review' : 'Post review'}</button></form>`
    : (u && u.role === 'tenant' ? '<p class="hint" style="color:var(--muted);font-size:.9rem">You can review this landlord after they accept one of your requests.</p>' : '');
  return `<div class="panel"><h3>Student reviews</h3>${form}${rs.length ? rs.map(r => `<div class="review"><span class="stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span> <strong>${esc(r.reviewer || 'Student')}</strong> <small style="color:var(--muted)">${new Date(r.created).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</small><p>${esc(r.comment || 'No comment.')}</p></div>`).join('') : '<p style="color:var(--muted);margin:0">No student reviews yet.</p>'}</div>`;
}

function viewMap(focusId) {
  const list = listings().sort((a, b) => a.distance - b.distance);
  const pin = l => { const c = l.available ? '#1b7a40' : '#a8412c'; return `<g class="pin ${l.id === focusId ? 'on' : ''}" data-act="pin" data-id="${l.id}" transform="translate(${l.mapX},${l.mapY})" tabindex="0" role="button" aria-label="${esc(l.title)}, ${K(l.price)}">
      <path class="pin-shape" d="M0,0 C-8,-12 -15,-19 -15,-27 a15,15 0 1,1 30,0 C15,-19 8,-12 0,0Z" fill="${c}" stroke="#fff" stroke-width="2"/><circle cy="-27" r="5.5" fill="#fff"/></g>`; };
  shell(`<div class="page-head"><div><h1>Listings on the map</h1><p>See how far each place is from campus.</p></div><a class="btn btn-ghost" href="#/home">Back to list</a></div>
    <div class="map-layout"><div><div class="map-box">
      <svg viewBox="0 0 600 420" role="group" aria-label="Map of listings around campus">
        <rect width="600" height="420" fill="#e6eddc"/>
        <path d="M-10 330 C120 300 200 360 320 340 S520 270 610 300 L610 340 C520 310 420 380 320 385 S120 345 -10 372Z" fill="#b9d8e6"/>
        <g fill="#d7ddcb"><rect x="40" y="40" width="110" height="70" rx="6"/><rect x="170" y="30" width="90" height="60" rx="6"/><rect x="380" y="40" width="120" height="50" rx="6"/><rect x="60" y="150" width="90" height="70" rx="6"/><rect x="430" y="140" width="110" height="80" rx="6"/><rect x="60" y="240" width="110" height="50" rx="6"/></g>
        <g stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round"><path d="M0 130 H600"/><path d="M0 255 H600"/><path d="M160 0 V300"/><path d="M400 0 V300"/><path d="M0 60 L170 130 L300 210 L600 400" stroke-width="6"/></g>
        <g><rect x="258" y="178" width="84" height="64" rx="8" fill="#0f4c5c"/><text x="300" y="206" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="13" font-weight="700">Campus</text><text x="300" y="224" text-anchor="middle" fill="#f2b134" font-family="sans-serif" font-size="11">Mulungushi</text></g>
        ${list.map(pin).join('')}
      </svg><button class="btn btn-primary btn-sm search-area" data-act="search-area">Search this area</button></div>
      <div class="legend"><span><i style="background:#1b7a40"></i>Available</span><span><i style="background:#a8412c"></i>Full</span><span><i style="background:#0f4c5c;border-radius:2px"></i>Campus</span></div></div>
      <div class="map-panel" id="map-panel">${list.map(l => `<div class="map-card ${l.id === focusId ? 'hl' : ''}" id="mc-${l.id}" data-act="open-listing" data-id="${l.id}" tabindex="0" role="button"><img src="${imgs(l)[0]}" alt=""><div><strong>${esc(l.title)}</strong><br><small style="color:var(--muted)">${l.distance} km from campus</small><br><span class="price" style="font-size:1rem">${K(l.price)}</span> ${availBadge(l)}</div></div>`).join('')}</div></div>
    <p style="color:var(--muted);margin-top:1rem;font-size:.9rem">Tap a pin to highlight its card, then tap the card to open the listing.</p>`, 'map');
  if (focusId) { const el = document.getElementById('mc-' + focusId); if (el) el.scrollIntoView({ block: 'nearest' }); }
}

/* ---------- landlord screens ---------- */
async function viewDashboard() {
  await loadListings(); await loadInbox();
  const u = me(); const mine = listings().filter(l => l.ownerId === u.id);
  const reqs = S.inbox.filter(r => mine.some(l => l.id === r.listingId));
  const pending = reqs.filter(r => r.status === 'pending');
  shell(`<div class="page-head" style="${bg(IMAGES.dashboardBanner)}border-radius:14px;padding:1.5rem;color:#fff;min-height:140px;align-items:flex-end;"><div><h1 style="color:#fff">Welcome, ${esc(u.name)}</h1><p style="color:#fff;margin:.3rem 0 0">Manage your boarding houses and student requests.</p></div><a class="btn btn-accent" href="#/add-listing">Add listing</a></div>
    <div class="stats"><div class="stat"><b>${mine.length}</b><span>Properties listed</span></div><div class="stat"><b>${mine.filter(l => l.available).length}</b><span>Available now</span></div><div class="stat"><b>${pending.length}</b><span>Requests waiting</span></div><div class="stat"><b>${reqs.filter(r => r.status === 'accepted').length}</b><span>Requests accepted</span></div></div>
    <div class="section-head"><h2>Your properties</h2>${pending.length ? '<a href="#/requests" class="btn btn-ghost btn-sm">Review ' + pending.length + ' request' + (pending.length > 1 ? 's' : '') + '</a>' : ''}</div>
    ${mine.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Property</th><th scope="col">Price</th><th scope="col">Beds</th><th scope="col">Status</th><th scope="col">Requests</th><th scope="col">Actions</th></tr></thead><tbody>
      ${mine.map(l => `<tr><td><div class="row-title"><img src="${imgs(l)[0]}" alt=""><div><strong>${esc(l.title)}</strong><br><small style="color:var(--muted)">${esc(l.location)}</small></div></div></td><td>${K(l.price)}</td><td>${l.occupiedBeds}/${l.totalBeds}</td>
      <td><button class="badge ${l.available ? 'go' : 'stop'}" style="border:0;cursor:pointer" data-act="toggle-avail" data-id="${l.id}">${l.available ? 'Available' : 'Paused'}</button></td>
      <td>${reqs.filter(r => r.listingId === l.id && r.status === 'pending').length || '—'}</td>
      <td><div class="row-actions"><button class="btn btn-ghost btn-sm" data-act="open-listing" data-id="${l.id}">View</button><a class="btn btn-ghost btn-sm" href="#/edit/${l.id}">Edit</a><button class="btn btn-danger btn-sm" data-act="delete-listing" data-id="${l.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><h3>No properties yet</h3><p>Add your first boarding house so students can find it.</p><a class="btn btn-primary" href="#/add-listing">Add listing</a></div>'}`, 'dashboard');
}

async function viewRequests() {
  await loadInbox();
  const list = S.inbox.slice().sort((a, b) => b.created - a.created);
  shell(`<div class="page-head"><div><h1>Student requests</h1><p>Accept or decline requests, then contact the student by phone or email.</p></div></div>
    ${list.length ? `<h2 class="sr-only">Requests received</h2><div class="req-list">${list.map(r => { const l = r.listing; if (!l) return ''; const privileged = ['accepted', 'completed'].includes(r.status); return `<div class="req"><div class="info"><h3 style="margin:0">${esc(privileged ? (r.tenantName || r.tenantDisplayName) : r.tenantDisplayName)} <small style="font-weight:400;color:var(--muted)">for ${esc(l.title)}</small></h3>
      <p>Move in: ${fmtDate(r.moveIn)} | ${privileged && r.tenantPhone ? `<a href="tel:${esc(r.tenantPhone.replace(/\s/g, ''))}">${esc(r.tenantPhone)}</a>` : 'Contact details appear once accepted'} | ${privileged ? esc(r.studentId || 'No student ID') : 'Student ID appears once accepted'}</p><p>"${esc(r.message || 'No message')}"</p>
      ${r.referenceCode ? `<p>Reference: <strong>${esc(r.referenceCode)}</strong></p>` : ''}</div>
      <div style="text-align:right">${r.rawStatus === 'PENDING' ? `<div class="actions" style="margin:0"><button class="btn btn-primary btn-sm" data-act="req-status" data-id="${r.id}" data-s="accept">Accept</button><button class="btn btn-danger btn-sm" data-act="req-status" data-id="${r.id}" data-s="decline">Decline</button></div>`
        : r.rawStatus === 'ACCEPTED' ? `<div class="actions" style="margin:0"><button class="btn btn-ghost btn-sm" data-act="cancel-by-landlord" data-id="${r.id}">Cancel</button><button class="btn btn-ghost btn-sm" data-act="complete-request" data-id="${r.id}">Complete</button></div>`
        : `<span class="badge ${r.status === 'accepted' || r.status === 'completed' ? 'go' : 'stop'}">${esc(r.rawStatus.replaceAll('_', ' ').toLowerCase())}</span>`}</div></div>`; }).join('')}</div>`
      : '<div class="empty"><h3>No requests yet</h3><p>When a student requests a space, it will show up here.</p></div>'}`, 'requests');
}

function photoGridHtml() {
  if (!formImgs.length) return '<p class="hint" style="margin:0">No photos yet. A default picture will be used.</p>';
  return formImgs.map((src, i) => `<div class="ph-item${i === 0 ? ' is-main' : ''}"><img src="${src}" alt="Photo ${i + 1}">
    ${i === 0 ? '<span class="ph-tag">Main</span>' : `<button type="button" class="ph-btn" data-act="main-photo" data-i="${i}">Make main</button>`}
    <button type="button" class="ph-x" data-act="remove-photo" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join('')
    + `<p class="hint" style="grid-column:1/-1;margin:0">${formImgs.length} of ${MAX_PHOTOS} photos</p>`;
}
function drawPhotoGrid() { const g = document.getElementById('photo-grid'); if (g) g.innerHTML = photoGridHtml(); }

async function viewListingForm(id) {
  const u = me(); const l = id ? listingById(id) : null;
  if (id && (!l || l.ownerId !== u.id)) return go('#/dashboard');
  formImgs = l ? (l.images || []).slice() : [];
  let zoneOptions = '';
  try {
    const zones = await api.get('/api/zones');
    const campus = l ? (l.campus || 'MAIN') : 'MAIN';
    zoneOptions = (zones[campus] || []).map(z => `<option value="${z.id}" ${l && l.zoneId === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
  } catch (e) { surface(e); }
  const v = l || { title: '', location: '', price: '', deposit: '', totalBeds: 1, status: 'ACTIVE' };
  shell(`<a class="back" href="#/dashboard">‹ Back to dashboard</a><div class="page-head"><h1>${l ? 'Edit listing' : 'Add a listing'}</h1></div>
    <form class="form-card" data-form="listing" data-id="${l ? l.id : ''}" novalidate><div id="form-error"></div>
      <div class="field"><label for="f-title">Property title</label><input id="f-title" name="title" type="text" value="${esc(v.title)}" placeholder="e.g. Gate View Boarding House" required></div>
      <div class="field"><label for="f-loc">Street / landmark</label><input id="f-loc" name="location" type="text" value="${esc(v.location)}" placeholder="Area or street" required></div>
      <div class="field"><label for="f-zone">Zone</label><select id="f-zone" name="zone_id" required>${zoneOptions}</select></div>
      <input type="hidden" name="campus" value="MAIN">
      <div class="field-row"><div class="field"><label for="f-dist">Distance to campus (km)</label><input id="f-dist" name="distance" type="number" min="0" step="0.1" value="${v.distance || 1}" required></div>
        <div class="field"><label for="f-beds">Total beds</label><input id="f-beds" name="total_beds" type="number" min="1" value="${v.totalBeds}" required></div></div>
      <div class="field-row"><div class="field"><label for="f-price">Price per month (K)</label><input id="f-price" name="price" type="number" min="0" value="${v.price}" required></div>
        <div class="field"><label for="f-dep">Deposit (K)</label><input id="f-dep" name="deposit" type="number" min="0" value="${v.deposit || 0}"></div></div>
      <fieldset class="field fieldset"><legend class="lbl">Occupancy &amp; type</legend><div class="check-row">
        <label for="f-occ">Occupancy <select id="f-occ" name="occupancy"><option value="SHARING">Sharing</option><option value="SINGLE">Single</option><option value="DORMITORY">Dormitory</option></select></label>
        <label for="f-gender">Gender policy <select id="f-gender" name="gender_policy"><option value="MIXED_SEPARATE_BLOCKS">Mixed / separate blocks</option><option value="FEMALE_ONLY">Female only</option><option value="MALE_ONLY">Male only</option></select></label>
        <label for="f-room">Room type <select id="f-room" name="room_type"><option value="SHARED_ABLUTION">Shared bathroom</option><option value="SELF_CONTAINED">Self-contained</option></select></label>
        <label for="f-elec">Electricity <select id="f-elec" name="electricity"><option value="INCLUDED_IN_RENT">Included in rent</option><option value="PREPAID_ZESCO_SPLIT">Prepaid / Zesco split</option><option value="TENANT_PAYS">Tenant pays</option></select></label>
        <label for="f-kitchen">Kitchen <select id="f-kitchen" name="kitchen"><option value="SHARED_KITCHEN">Shared kitchen</option><option value="OUTDOOR_COOKING">Outdoor cooking</option><option value="NONE">None</option></select></label>
        <label for="f-sec">Security <select id="f-sec" name="security_level"><option value="NONE">None</option><option value="FENCE_ONLY">Fence only</option><option value="FENCE_AND_GUARD">Fence and guard</option><option value="24H_GUARD_AND_CCTV">24h guard and CCTV</option></select></label>
      </div></fieldset>
      <fieldset class="field fieldset"><legend class="lbl">Extras</legend><div class="check-row">
        <label for="f-wifi"><input id="f-wifi" type="checkbox" name="free_wifi"> Free WiFi</label>
        <label for="f-furn"><input id="f-furn" type="checkbox" name="furnished"> Furnished</label>
        <label for="f-bore"><input id="f-bore" type="checkbox" name="has_borehole"> Borehole</label>
        <label for="f-tank"><input id="f-tank" type="checkbox" name="has_overhead_tank"> Overhead tank</label>
        <label for="f-solar"><input id="f-solar" type="checkbox" name="has_solar_backup"> Solar backup</label>
      </div></fieldset>
      <div class="field"><label for="f-desc">Description</label><textarea id="f-desc" name="description" placeholder="Tell students what makes this place a good fit."></textarea></div>
      <div class="field"><label for="f-img">Photos (up to ${MAX_PHOTOS})</label><input id="f-img" type="file" accept="image/*" multiple data-upload="1"><div id="photo-grid" class="photo-grid">${photoGridHtml()}</div></div>
      <div class="actions"><button class="btn btn-primary" type="submit">${l ? 'Save changes' : 'Publish listing'}</button><a class="btn btn-ghost" href="#/dashboard">Cancel</a></div>
    </form>`, 'add');
}

function viewProfile() {
  const u = me();
  shell(`<div class="page-head"><div><h1>My profile</h1><p>This is what students see when they open your owner page.</p></div></div>
    <p class="hint">Contact details and verification are managed by the server; to update your name or phone, contact an administrator.</p>
    <div class="panel"><p><strong>${esc(u.name)}</strong></p><p>Phone: ${esc(u.phone || '—')}</p><p>Status: ${u.verified ? 'Verified landlord' : 'Not yet verified'}</p></div>`, 'profile');
}

/* ---------- admin ---------- */
function viewAdmin() {
  const s = S.admin.stats || {};
  shell(`<div class="page-head"><div><h1>Admin panel</h1><p>Verify landlords, resolve reports and suspend accounts.</p></div></div>
    <div class="stats"><div class="stat"><b>${s.active_tenants ?? '—'}</b><span>Active tenants</span></div><div class="stat"><b>${s.verified_landlords ?? '—'}</b><span>Verified landlords</span></div><div class="stat"><b>${s.active_listings ?? '—'}</b><span>Active listings</span></div><div class="stat"><b>${s.open_reports ?? '—'}</b><span>Open reports</span></div><div class="stat"><b>${s.pending_verifications ?? '—'}</b><span>Pending verifications</span></div></div>
    <div class="section-head"><h2>Landlords</h2></div>
    ${S.admin.landlords.length ? `<div class="table-wrap"><table><thead><tr><th>Landlord</th><th>Contact</th><th>Listings</th><th>Status</th><th>Actions</th></tr></thead><tbody>${S.admin.landlords.map(u => `<tr><td><strong>${esc(u.full_name)}</strong><br><small>${esc(u.email)}</small></td><td>${esc(u.phone || '—')}</td><td>${u.listing_count}</td><td>${u.landlord_verified ? 'Verified' : 'Pending'}</td>
      <td><div class="row-actions">${u.landlord_verified ? `<button class="btn btn-ghost btn-sm" data-act="admin-unverify" data-id="${u.id}">Unverify</button>` : `<button class="btn btn-primary btn-sm" data-act="admin-verify" data-id="${u.id}">Verify</button>`}
      ${u.account_status === 'SUSPENDED' ? `<button class="btn btn-ghost btn-sm" data-act="admin-reactivate" data-id="${u.id}">Reactivate</button>` : `<button class="btn btn-danger btn-sm" data-act="admin-suspend" data-id="${u.id}">Suspend</button>`}</div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>No landlords.</p></div>'}
    <div class="section-head" style="margin-top:2rem"><h2>Open reports</h2></div>
    ${S.admin.reports.length ? `<div class="table-wrap"><table><thead><tr><th>Listing</th><th>Reporter</th><th>Reason</th><th>Actions</th></tr></thead><tbody>${S.admin.reports.map(r => `<tr><td>${esc(r.listing_title)}</td><td>${esc(r.reporter || r.reporter_name)}</td><td>${esc(r.reason)}</td>
      <td><div class="row-actions"><button class="btn btn-primary btn-sm" data-act="admin-resolve" data-id="${r.id}" data-s="ACTIONED">Action</button><button class="btn btn-ghost btn-sm" data-act="admin-resolve" data-id="${r.id}" data-s="DISMISSED">Dismiss</button><button class="btn btn-ghost btn-sm" data-act="admin-hide" data-id="${r.listing_id}">Hide listing</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>No open reports.</p></div>'}`, 'admin');
}

/* ---------- modals ---------- */
let lastFocus = null;
function openModal(html) {
  if (!$modal.firstChild) lastFocus = document.activeElement;
  $modal.innerHTML = `<div class="modal-back" data-act="close-modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const h = $modal.querySelector('h2'), dlg = $modal.querySelector('.modal'); if (h) { h.id = 'modal-title'; dlg.setAttribute('aria-labelledby', 'modal-title'); }
  const f = $modal.querySelector('input,textarea,button,a'); if (f) f.focus();
}
function closeModal() { const f = lastFocus; lastFocus = null; $modal.innerHTML = ''; lb = null; if (f && document.contains(f)) f.focus(); }
let lb = null;
function showLightbox() {
  const l = listingById(lb.id); const p = imgs(l);
  if (!$modal.firstChild) lastFocus = document.activeElement;
  $modal.innerHTML = `<div class="modal-back lb" data-act="close-modal-bg"><div class="lb-box" role="dialog" aria-modal="true" aria-label="Photo viewer"><img class="lb-img" src="${p[lb.i]}" alt="Photo ${lb.i + 1}">
    <button class="lb-x" data-act="close-modal" aria-label="Close">×</button>
    ${p.length > 1 ? `<button class="lb-nav lb-prev" data-act="lb-step" data-d="-1" aria-label="Previous photo">‹</button><button class="lb-nav lb-next" data-act="lb-step" data-d="1" aria-label="Next photo">›</button><span class="lb-count">${lb.i + 1} / ${p.length}</span>` : ''}</div></div>`;
  const x = $modal.querySelector('.lb-x'); if (x) x.focus();
}
function lbStep(d) { if (!lb) return; const n = imgs(listingById(lb.id)).length; lb.i = (lb.i + d + n) % n; showLightbox(); }

function contactModal(lid) {
  const l = listingById(lid); const c = contactCache[lid] || contactFor(l);
  if (!c || (!c.phone && !c.email)) { toast('Contact details are available once your request is accepted.'); return; }
  openModal(`<h2>Contact the owner</h2><p style="color:var(--muted)">About: ${esc(l.title)}.</p>
    <div class="contact-big">${c.phone ? `<a href="tel:${esc((c.phone || '').replace(/\s/g, ''))}">Call ${esc(c.phone)}</a><a href="${waLink(c.phone, 'Hello, I am interested in ' + l.title)}" target="_blank" rel="noopener">WhatsApp ${esc(c.phone)}</a>` : ''}${c.email ? `<a href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Room enquiry: ' + l.title)}">Email ${esc(c.email)}</a>` : ''}</div>
    <div class="actions"><button class="btn btn-ghost" data-act="close-modal">Close</button></div>`);
}

function requestModal(lid) {
  const l = listingById(lid);
  openModal(`<h2>Request a space</h2><p style="color:var(--muted)">${esc(l.title)} | ${K(l.price)} / month</p>
    <form data-form="request" data-id="${l.id}"><div class="field"><label for="q-date">Move-in date</label><input id="q-date" name="moveIn" type="date" value="${esc(l.availableFrom)}" required></div>
      <div class="field"><label for="q-duration">Duration (months)</label><input id="q-duration" name="duration" type="number" min="1" max="24" value="6" required></div>
      <div class="field"><label for="q-msg">Message to the landlord</label><textarea id="q-msg" name="message" placeholder="Introduce yourself and say what you need."></textarea></div>
      <div class="actions"><button type="button" class="btn btn-ghost" data-act="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Send request</button></div></form>`);
}

function reportModal(lid) {
  const l = listingById(lid);
  openModal(`<h2>Report this listing</h2><p style="color:var(--muted)">${esc(l.title)}</p>
    <form data-form="report" data-id="${l.id}"><div class="field"><label for="rp-reason">Reason</label><select id="rp-reason" name="reason"><option value="FAKE_PHOTOS">Fake photos</option><option value="WRONG_PRICE">Wrong price</option><option value="PROPERTY_FULL">Property full</option><option value="HARASSMENT">Harassment</option><option value="OTHER">Other</option></select></div>
      <div class="field"><label for="rp-body">Details</label><textarea id="rp-body" name="body"></textarea></div>
      <div class="actions"><button type="button" class="btn btn-ghost" data-act="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Send report</button></div></form>`);
}

function notifPanel() {
  const list = S.notifications;
  openModal(`<h2>Notifications</h2>
    ${list.length ? `<div class="req-list">${list.map(n => `<div class="req"><div class="info"><strong>${esc(n.title)}</strong><p>${esc(n.body || '')}</p><small>${new Date(n.created_at).toLocaleString('en-GB')}</small></div>
      <div class="actions" style="justify-content:flex-end">${n.link_path ? `<button class="btn btn-primary btn-sm" data-act="read-notif" data-id="${n.id}" data-path="${esc(n.link_path)}">Open</button>` : ''}<button class="btn btn-ghost btn-sm" data-act="read-notif" data-id="${n.id}" data-path="">Mark read</button></div></div>`).join('')}</div>` : '<p style="color:var(--muted)">No notifications yet.</p>'}
    <div class="actions"><button class="btn btn-ghost" data-act="read-all-notifs">Mark all read</button><button class="btn btn-ghost" data-act="close-modal">Close</button></div>`);
}

async function viewReceipt(code) {
  try {
    const r = await api.get('/api/receipts/' + encodeURIComponent(code));
    shell(`<div class="page-head"><div><h1>Booking receipt</h1><p>Verified booking reference ${esc(r.reference_code)}</p></div></div>
      <div class="panel receipt-card" id="receipt-card"><h2>${esc(r.listing_title)}</h2><p><strong>Reference:</strong> ${esc(r.reference_code)}</p>
        <p><strong>Student:</strong> ${esc(r.tenant_name)}</p><p><strong>Zone:</strong> ${esc(r.zone_name)}</p>
        <p><strong>Rent:</strong> ${K(r.rent_per_month_zmw)} / month</p><p><strong>Deposit:</strong> ${K(r.deposit_zmw)}</p>
        <p><strong>Move in:</strong> ${fmtDate(r.move_in_date)}</p><p><strong>Accepted:</strong> ${r.accepted_at ? new Date(r.accepted_at).toLocaleString('en-GB') : '—'}</p>
        <div class="actions"><button class="btn btn-primary" data-act="print-receipt">Print</button><a class="btn btn-ghost" href="#/home">Back</a></div></div>`, 'home');
  } catch (e) {
    shell(`<div class="empty"><h3>Receipt not found</h3><p>This reference is unknown or the booking is no longer active.</p><a class="btn btn-primary" href="#/home">Back to listings</a></div>`, 'home');
  }
}

/* ---------- actions ---------- */
const actions = {
  'pick-role'(el) {
    pendingRole = el.dataset.role;
    document.querySelectorAll('.role-card').forEach(b => b.setAttribute('aria-pressed', b === el));
    document.getElementById('role-continue').disabled = false;
  },
  'role-continue'() { if (pendingRole) go('#/register'); },
  async logout() { try { await api.post('/api/auth/logout'); } catch (e) { surface(e); } S.meUser = null; try { sessionStorage.removeItem('cn_user'); } catch (_) {} closeModal(); go('#/login'); },
  'toggle-pw'(el) { el.closest('form').querySelectorAll('input[name="password"],input[name="password2"]').forEach(i => { i.type = el.checked ? 'text' : 'password'; }); },
  lightbox(el) { const l = listingById(el.dataset.id); const cur = document.getElementById('main-img').getAttribute('src'); lb = { id: l.id, i: Math.max(0, imgs(l).indexOf(cur)) }; showLightbox(); },
  'lb-step'(el) { lbStep(Number(el.dataset.d)); },
  'copy-link'() { if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(() => toast('Link copied'), () => toast('Copy the link from the address bar')); else toast('Copy the link from the address bar'); },
  skip(el, e) { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); },
  'focus-field'(el) { const t = document.getElementById(el.dataset.id); if (t) t.focus(); },
  'open-listing'(el) { go('#/listing/' + el.dataset.id); },
  'open-owner'(el) { go('#/owner/' + el.dataset.id + '/' + (el.dataset.l || '')); },
  'toggle-filters'(el) { filters.open = !filters.open; document.getElementById('filters').hidden = !filters.open; el.setAttribute('aria-expanded', filters.open); },
  'clear-filters'() { filters = { q: '', maxPrice: '', perRoom: '', selfContained: false, availableOnly: false, wifi: false, sort: 'near', open: true }; viewHome(); },
  async 'toggle-save'(el) {
    if (!me()) return go('#/login');
    const id = Number(el.dataset.id);
    const has = S.saved.includes(id) || S.saved.includes(String(id));
    try {
      if (has) { await api.del('/api/saved/' + id); S.saved = S.saved.filter(x => Number(x) !== id); toast('Removed from saved'); }
      else { await api.post('/api/saved/' + id); S.saved.push(id); toast('Saved to your list'); }
      if (el.dataset.refresh) el.textContent = S.saved.includes(id) ? '♥ Saved' : '♡ Save';
      else if (document.getElementById('cards')) drawCards(); else route();
    } catch (e) { surface(e); }
  },
  'swap-img'(el) { const main = document.getElementById('main-img'); const old = main.src; main.src = el.dataset.src; el.dataset.src = old; el.querySelector('img').src = old; },
  contact(el) { contactModal(el.dataset.id); },
  request(el) { requestModal(el.dataset.id); },
  report(el) { reportModal(el.dataset.id); },
  'close-modal'() { closeModal(); },
  'close-modal-bg'(el, e) { if (e.target === el) closeModal(); },
  pin(el) {
    document.querySelectorAll('.pin').forEach(p => p.classList.toggle('on', p === el));
    document.querySelectorAll('.map-card').forEach(c => c.classList.remove('hl'));
    const c = document.getElementById('mc-' + el.dataset.id); if (c) { c.classList.add('hl'); c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  },
  'search-area'() { const n = listings().filter(l => l.available).length; toast(n + ' places available in this area'); },
  async 'toggle-avail'(el) {
    const l = listingById(el.dataset.id); if (!l) return;
    try {
      await api.patch('/api/listings/' + l.id, { status: l.available ? 'PAUSED' : 'ACTIVE' });
      l.available = !l.available; l.status = l.available ? 'ACTIVE' : 'PAUSED';
      toast(l.title + (l.available ? ' marked available' : ' paused')); route();
    } catch (e) { surface(e); }
  },
  'delete-listing'(el) {
    const l = listingById(el.dataset.id);
    openModal(`<h2>Delete this listing?</h2><p>"${esc(l.title)}" will be removed and students will no longer see it.</p><div class="actions"><button class="btn btn-ghost" data-act="close-modal">Keep it</button><button class="btn btn-danger" data-act="confirm-delete" data-id="${l.id}">Delete listing</button></div>`);
  },
  async 'confirm-delete'(el) {
    try { await api.del('/api/listings/' + el.dataset.id); S.listings = S.listings.filter(l => String(l.id) !== String(el.dataset.id)); closeModal(); toast('Listing deleted'); route(); }
    catch (e) { surface(e); }
  },
  async 'req-status'(el) {
    const path = '/api/requests/' + el.dataset.id + '/' + (el.dataset.s === 'accept' ? 'accept' : 'decline');
    try {
      const d = await api.post(path);
      const r = S.inbox.find(x => String(x.id) === String(el.dataset.id));
      if (r) { if (d.request) Object.assign(r, mapRequest(d.request)); else r.status = el.dataset.s === 'accept' ? 'accepted' : 'declined'; }
      toast(d.request && d.request.reference_code ? 'Accepted — reference ' + d.request.reference_code : 'Request ' + el.dataset.s + 'ed'); route();
    } catch (e) { surface(e); }
  },
  async 'cancel-request'(el) {
    try { await api.post('/api/requests/' + el.dataset.id + '/cancel'); toast('Request cancelled'); route(); }
    catch (e) { surface(e); }
  },
  async 'cancel-by-landlord'(el) {
    try { await api.post('/api/requests/' + el.dataset.id + '/cancel-by-landlord'); toast('Booking cancelled'); route(); }
    catch (e) { surface(e); }
  },
  async 'complete-request'(el) {
    try { await api.post('/api/requests/' + el.dataset.id + '/complete'); toast('Booking completed'); route(); }
    catch (e) { surface(e); }
  },
  'remove-photo'(el) { formImgs.splice(Number(el.dataset.i), 1); drawPhotoGrid(); },
  'main-photo'(el) { const i = Number(el.dataset.i); const [p] = formImgs.splice(i, 1); formImgs.unshift(p); drawPhotoGrid(); },
  async 'admin-verify'(el) {
    try { await api.post('/api/admin/landlords/' + el.dataset.id + '/verify'); toast('Landlord verified'); route(); } catch (e) { surface(e); }
  },
  async 'admin-unverify'(el) {
    try { await api.post('/api/admin/landlords/' + el.dataset.id + '/unverify'); toast('Landlord unverified'); route(); } catch (e) { surface(e); }
  },
  'admin-suspend'(el) {
    openModal(`<h2>Suspend this user?</h2><form data-form="suspend" data-id="${el.dataset.id}"><div class="field"><label for="su-reason">Reason</label><input id="su-reason" name="reason" required></div><div class="actions"><button type="button" class="btn btn-ghost" data-act="close-modal">Cancel</button><button class="btn btn-danger" type="submit">Suspend</button></div></form>`);
  },
  async 'admin-reactivate'(el) {
    try { await api.post('/api/admin/users/' + el.dataset.id + '/reactivate'); toast('Account reactivated'); route(); } catch (e) { surface(e); }
  },
  async 'admin-resolve'(el) {
    try { await api.post('/api/admin/reports/' + el.dataset.id + '/resolve', { status: el.dataset.s }); toast('Report resolved'); route(); } catch (e) { surface(e); }
  },
  async 'admin-hide'(el) {
    try { await api.post('/api/admin/listings/' + el.dataset.id + '/hide'); toast('Listing hidden'); route(); } catch (e) { surface(e); }
  },
  'toggle-notifs'() { notifPanel(); },
  async 'read-notif'(el) {
    const path = el.dataset.path;
    try { await api.post('/api/notifications/' + el.dataset.id + '/read'); closeModal(); if (path && path.startsWith('#/')) go(path); else route(); }
    catch (e) { surface(e); }
  },
  async 'read-all-notifs'() { try { await api.post('/api/notifications/read-all'); S.unread = 0; closeModal(); toast('All notifications marked read'); } catch (e) { surface(e); } },
  'print-receipt'() { window.print(); }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = actions[el.dataset.act]; if (fn) fn(el, e);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    const m = $modal.querySelector('.modal, .lb-box');
    if (m) {
      const f = Array.from(m.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea')).filter(x => x.offsetParent !== null);
      if (f.length) { const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    }
  }
  if (e.key === 'Escape') closeModal();
  if (lb && e.key === 'ArrowLeft') lbStep(-1);
  if (lb && e.key === 'ArrowRight') lbStep(1);
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});

let filterTimer;
document.addEventListener('input', e => {
  const key = e.target.dataset && e.target.dataset.filter; if (!key) return;
  filters[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  clearTimeout(filterTimer); filterTimer = setTimeout(() => { loadListings().then(drawCards); }, 250);
});
document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.filter) { const k = e.target.dataset.filter; filters[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; loadListings().then(drawCards); }
  if (e.target.dataset && e.target.dataset.upload) handleUpload(e.target);
});

/* ---------- photo upload ---------- */
function readPhoto(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        const scale = Math.min(1, 800 / img.width); const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function handleUpload(input) {
  const files = Array.from(input.files || []); input.value = '';
  if (!files.length) return;
  const room = MAX_PHOTOS - formImgs.length;
  if (room <= 0) return toast('You can add up to ' + MAX_PHOTOS + ' photos. Remove one first.');
  if (files.length > room) toast('Only ' + room + ' more photo' + (room > 1 ? 's' : '') + ' can be added.');
  for (const f of files.slice(0, room)) { const d = await readPhoto(f); if (d) formImgs.push(d); }
  drawPhotoGrid();
}

/* ---------- validation ---------- */
const RULES = {
  register: {
    name: { label: 'Full name', required: true, min: 3, max: 60 },
    email: { label: 'Email', required: true, type: 'email' },
    phone: { label: 'Phone number', required: true, type: 'phone' },
    password: { label: 'Password', required: true, min: 8, custom: v => (/[A-Za-z]/.test(v) && /\d/.test(v)) ? '' : 'Password must include at least one letter and one number.' },
    password2: { label: 'Confirm password', required: true, match: 'password', matchMsg: 'The two passwords do not match.' },
    contact: { label: 'Preferred contact method', required: true, msg: 'Choose how you want to be contacted.' },
    year: { label: 'Year of study or properties', required: true, msg: 'Select an option from the list.' },
    terms: { label: 'Terms of use', required: true, msg: 'You must agree to the terms to create an account.' }
  },
  login: { email: { label: 'Email', required: true, type: 'email' }, password: { label: 'Password', required: true } },
  profile: {},
  request: { moveIn: { label: 'Move-in date', required: true }, duration: { label: 'Duration (months)', required: true, type: 'number', minVal: 1, maxVal: 24 }, message: { label: 'Message', max: 300 } },
  report: { reason: { label: 'Reason', required: true }, body: { label: 'Details', max: 1000 } },
  suspend: { reason: { label: 'Reason', required: true } },
  review: { stars: { label: 'Rating', required: true } },
  listing: {
    title: { label: 'Property title', required: true, min: 3, max: 80 },
    location: { label: 'Location', required: true, min: 3, max: 80 },
    zone_id: { label: 'Zone', required: true },
    distance: { label: 'Distance to campus', required: true, type: 'number', minVal: 0, maxVal: 50 },
    price: { label: 'Price per month', required: true, type: 'number', gt: 0 },
    deposit: { label: 'Deposit', type: 'number', minVal: 0 },
    total_beds: { label: 'Total beds', required: true, type: 'number', minVal: 1, maxVal: 100 }
  }
};

function fieldValue(form, name) {
  const els = form.querySelectorAll('[name="' + name + '"]'); if (!els.length) return null;
  const f = els[0];
  if (f.type === 'radio') { const c = form.querySelector('[name="' + name + '"]:checked'); return c ? c.value : ''; }
  if (f.type === 'checkbox') return f.checked ? 'on' : '';
  return (f.value || '').trim();
}
function ruleError(form, name, r) {
  const v = fieldValue(form, name); if (v === null) return '';
  const L = r.label || name;
  if (!v) return r.required ? (r.msg || L + ' is required.') : '';
  if (r.min && v.length < r.min) return L + ' must be at least ' + r.min + ' characters.';
  if (r.max && v.length > r.max) return L + ' must be ' + r.max + ' characters or fewer.';
  if (r.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Enter a valid email address, like you@example.com.';
  if (r.type === 'phone' && !/^(\+260|0)\d{9}$/.test(v.replace(/[\s-]/g, ''))) return 'Enter a valid phone number, like +260 977 123 456 or 0977 123 456.';
  if (r.type === 'number') {
    const n = Number(v);
    if (isNaN(n)) return L + ' must be a number.';
    if (r.gt !== undefined && !(n > r.gt)) return L + ' must be greater than ' + r.gt + '.';
    if (r.minVal !== undefined && n < r.minVal) return L + ' must be ' + r.minVal + ' or more.';
    if (r.maxVal !== undefined && n > r.maxVal) return L + ' must be ' + r.maxVal + ' or less.';
  }
  if (r.match && v !== fieldValue(form, r.match)) return r.matchMsg || 'The two values do not match.';
  if (r.custom) { const m = r.custom(v); if (m) return m; }
  return '';
}
function enhanceForm(form) {
  form.dataset.enh = '1';
  const type = form.dataset.form, rules = RULES[type]; if (!rules) return;
  let box = form.querySelector('#form-error');
  if (!box) { box = document.createElement('div'); box.id = 'form-error'; form.prepend(box); }
  box.setAttribute('role', 'alert'); box.setAttribute('aria-atomic', 'true');
  const note = document.createElement('p'); note.className = 'req-note'; note.innerHTML = '<span aria-hidden="true">*</span> marks a required field.'; box.after(note);
  const status = document.createElement('p'); status.className = 'sr-only'; status.id = 'status-' + type; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); form.append(status);
  Object.keys(rules).forEach(name => {
    const els = form.querySelectorAll('[name="' + name + '"]'); if (!els.length) return;
    const first = els[0], r = rules[name], group = first.type === 'radio' ? first.closest('fieldset') : null;
    const holder = group || first.closest('.field') || first.parentElement;
    const err = document.createElement('div'); err.className = 'field-err'; err.id = 'err-' + type + '-' + name; holder.append(err);
    const hint = holder.querySelector('.hint'); let ids = err.id;
    if (hint) { hint.id = hint.id || 'hint-' + type + '-' + name; ids = hint.id + ' ' + err.id; }
    if (group) { group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-describedby', ids); if (r.required) group.setAttribute('aria-required', 'true'); }
    else els.forEach(el => { el.setAttribute('aria-describedby', ids); if (r.required) el.setAttribute('aria-required', 'true'); });
    if (r.required) {
      const lab = group ? group.querySelector('legend') : form.querySelector('label[for="' + first.id + '"]');
      if (lab && !lab.querySelector('.req-mark')) lab.insertAdjacentHTML('beforeend', '<span class="req-mark" aria-hidden="true"> *</span>');
    }
  });
}
new MutationObserver(() => document.querySelectorAll('form[data-form]:not([data-enh])').forEach(enhanceForm))
  .observe(document.body, { childList: true, subtree: true });

function validateField(form, name) {
  const type = form.dataset.form, r = (RULES[type] || {})[name]; if (!r) return '';
  const els = form.querySelectorAll('[name="' + name + '"]'); if (!els.length) return '';
  const msg = ruleError(form, name, r);
  const err = document.getElementById('err-' + type + '-' + name); if (err) err.textContent = msg;
  const group = els[0].type === 'radio' ? els[0].closest('fieldset') : null;
  (group ? [group] : Array.from(els)).forEach(el => { el.setAttribute('aria-invalid', msg ? 'true' : 'false'); el.classList.toggle('is-invalid', !!msg); });
  if (name === 'password') { const p2 = form.querySelector('[name="password2"]'); if (p2 && p2.dataset.touched) validateField(form, 'password2'); }
  return msg;
}
function validateForm(form) {
  const type = form.dataset.form, rules = RULES[type], errs = [];
  Object.keys(rules).forEach(name => { const m = validateField(form, name); if (m) { const el = form.querySelector('[name="' + name + '"]'); errs.push({ msg: m, id: el.id }); } });
  const box = document.getElementById('form-error');
  if (!errs.length) { if (box) box.innerHTML = ''; return true; }
  if (box) box.innerHTML = `<div class="form-error"><strong>${errs.length === 1 ? '1 problem needs fixing' : errs.length + ' problems need fixing'}:</strong><ul>${errs.map(e => `<li><button type="button" class="link-btn" data-act="focus-field" data-id="${esc(e.id)}">${esc(e.msg)}</button></li>`).join('')}</ul></div>`;
  const first = document.getElementById(errs[0].id); if (first) first.focus();
  return false;
}
function refreshStatus(f) {
  const type = f.dataset.form, rules = RULES[type];
  const ok = Object.keys(rules).every(n => !ruleError(f, n, rules[n]));
  const s = document.getElementById('status-' + type); if (s) s.textContent = ok ? 'All required information is valid. You can submit the form.' : '';
}
function liveCheck(e, force) {
  const t = e.target, f = t && t.form; if (!f || !f.dataset || !RULES[f.dataset.form] || !t.name || !RULES[f.dataset.form][t.name]) return;
  const discrete = t.type === 'radio' || t.type === 'checkbox' || t.tagName === 'SELECT';
  if (force || discrete) t.dataset.touched = '1';
  if (t.dataset.touched) { validateField(f, t.name); refreshStatus(f); }
}
document.addEventListener('input', e => liveCheck(e, false));
document.addEventListener('change', e => liveCheck(e, false));
document.addEventListener('focusout', e => { if (e.target.type !== 'radio' && e.target.type !== 'checkbox') liveCheck(e, true); });
function showError(msg) { const b = document.getElementById('form-error'); if (b) { b.innerHTML = `<div class="form-error srv">${esc(msg)}</div>`; b.scrollIntoView({ block: 'nearest' }); } }

/* ---------- form submissions ---------- */
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]'); if (!form) return; e.preventDefault();
  const fd = new FormData(form); const type = form.dataset.form;
  if (RULES[type] && !validateForm(form)) return;

  if (type === 'register') {
    const payload = {
      full_name: fd.get('name').trim(), email: fd.get('email').trim(), password: fd.get('password'),
      phone: fd.get('phone').trim(), role: pendingRole.toUpperCase(),
      student_id: fd.get('student_id') ? fd.get('student_id').trim() : undefined
    };
    try {
      const d = await api.post('/api/auth/register', payload);
      S.meUser = mapUser(d.user); try { sessionStorage.setItem('cn_user', JSON.stringify(S.meUser)); } catch (_) {}
      toast('Account created'); go(homeFor(S.meUser));
    } catch (err) { surface(err); showError(apiErrorMessage(err)); }
  }

  if (type === 'login') {
    try {
      const d = await api.post('/api/auth/login', { email: fd.get('email').trim(), password: fd.get('password') });
      S.meUser = mapUser(d.user); try { sessionStorage.setItem('cn_user', JSON.stringify(S.meUser)); } catch (_) {}
      go(homeFor(S.meUser));
    } catch (err) { surface(err); showError(apiErrorMessage(err)); }
  }

  if (type === 'suspend') {
    try { await api.post('/api/admin/users/' + form.dataset.id + '/suspend', { reason: fd.get('reason').trim() }); closeModal(); toast('Account suspended'); route(); }
    catch (err) { surface(err); }
  }

  if (type === 'review') {
    const lid = form.dataset.listing;
    if (!lid) return toast('Open the listing to review this landlord.');
    try { await api.post('/api/listings/' + lid + '/reviews', { stars: Number(fd.get('stars')), body: fd.get('comment').trim() }); toast('Thanks for your review'); route(); }
    catch (err) { surface(err); }
  }

  if (type === 'request') {
    try {
      await api.post('/api/requests', {
        listing_id: Number(form.dataset.id), move_in_date: fd.get('moveIn'),
        duration_months: Number(fd.get('duration')), note: fd.get('message').trim()
      });
      closeModal(); toast('Request sent to the landlord');
      await loadMyRequests(); route();
    } catch (err) { surface(err); }
  }

  if (type === 'report') {
    try { await api.post('/api/listings/' + form.dataset.id + '/reports', { reason: fd.get('reason'), body: fd.get('body').trim() }); closeModal(); toast('Report sent'); }
    catch (err) { surface(err); }
  }

  if (type === 'listing') {
    const id = form.dataset.id;
    const payload = {
      zone_id: Number(fd.get('zone_id')), campus: fd.get('campus') || 'MAIN',
      title: fd.get('title').trim(), street_landmark: fd.get('location').trim(),
      distance_to_campus_km: Number(fd.get('distance')), total_beds: Number(fd.get('total_beds')),
      rent_per_month_zmw: Number(fd.get('price')), deposit_zmw: Number(fd.get('deposit')) || 0,
      occupancy: fd.get('occupancy'), gender_policy: fd.get('gender_policy'), electricity: fd.get('electricity'),
      room_type: fd.get('room_type'), kitchen: fd.get('kitchen'), security_level: fd.get('security_level'),
      free_wifi: Boolean(fd.get('free_wifi')), furnished: Boolean(fd.get('furnished')),
      has_borehole: Boolean(fd.get('has_borehole')), has_overhead_tank: Boolean(fd.get('has_overhead_tank')),
      has_solar_backup: Boolean(fd.get('has_solar_backup')),
      description: fd.get('description').trim(),
      photos: formImgs.map(url => ({ url }))
    };
    try {
      if (id) { delete payload.status; await api.patch('/api/listings/' + id, payload); toast('Listing updated'); }
      else { await api.post('/api/listings', payload); toast('Listing published'); }
      await loadListings(); go('#/dashboard');
    } catch (err) { surface(err); showError(apiErrorMessage(err)); }
  }
});

/* ---------- router ---------- */
const TITLES = { role: 'Join', register: 'Create account', login: 'Log in', home: 'Find a place', map: 'Map', saved: 'Saved places', 'my-requests': 'My requests', listing: 'Listing details', owner: 'Owner profile', dashboard: 'Dashboard', 'add-listing': 'Add listing', edit: 'Edit listing', requests: 'Student requests', profile: 'My profile', admin: 'Admin panel', receipt: 'Receipt' };

async function route() {
  closeModal();
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/'); const page = parts[0];
  document.title = (TITLES[page] || 'Welcome') + ' – ' + APP_NAME;
  const u = me();
  const publicPages = ['role', 'register', 'login', 'home', 'map', 'listing', 'owner', 'receipt'];
  const guestOnly = ['role', 'register', 'login'];

  if (!u && !publicPages.includes(page)) return go('#/login');
  if (u && guestOnly.includes(page)) return go(homeFor(u));
  if (u && page === '') return go(homeFor(u));

  if (u && u.role === 'admin' && page !== 'admin') return go('#/admin');
  if (u && u.role !== 'admin' && page === 'admin') return go(homeFor(u));

  const tenantOnly = ['home', 'map', 'saved', 'my-requests'], landlordOnly = ['dashboard', 'add-listing', 'requests', 'edit', 'profile'];
  if (u && u.role === 'landlord' && tenantOnly.includes(page)) return go('#/dashboard');
  if (u && u.role === 'tenant' && landlordOnly.includes(page)) return go('#/home');

  await hydrate(page, parts);

  switch (page) {
    case 'home': return viewHome();
    case 'saved': return viewSaved();
    case 'my-requests': return viewMyRequests();
    case 'map': return viewMap(parts[1]);
    case 'listing': return viewListing(parts[1]);
    case 'owner': return viewOwner(parts[1], parts[2]);
    case 'dashboard': return viewDashboard();
    case 'add-listing': return viewListingForm();
    case 'edit': return viewListingForm(parts[1]);
    case 'requests': return viewRequests();
    case 'profile': return viewProfile();
    case 'admin': return viewAdmin();
    case 'receipt': return viewReceipt(parts[1]);
    case 'role': return viewRole();
    case 'register': return viewRegister();
    case 'login': return viewLogin();
    default: return go(homeFor(u));
  }
}

window.addEventListener('hashchange', () => {
  route();
  const m = document.getElementById('main'); if (m) m.focus({ preventScroll: true });
  const a = document.getElementById('announce'); if (a) a.textContent = 'Page loaded: ' + document.title;
});

async function boot() {
  cleanupLegacy();
  try {
    const cached = sessionStorage.getItem('cn_user');
    if (cached) S.meUser = mapUser(JSON.parse(cached));
  } catch (e) { /* ignore */ }
  await refreshMe(true);
  route();
}
boot();
