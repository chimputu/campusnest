const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('./config/db');

let bcrypt;
try { bcrypt = require('bcrypt'); } catch (_) { bcrypt = require('bcryptjs'); }

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const ZONES = [
  ['MAIN', 'Main Gate / Great North Road', 0.20, 1.50, 1],
  ['MAIN', 'Katondo / Zesco Compound', 1.00, 2.50, 2],
  ['MAIN', 'Mukobeko Road / Town Centre', 2.00, 4.00, 3],
  ['TOWN', 'Highridge / Town Campus Vicinity', 0.20, 1.50, 1],
  ['TOWN', 'Town Centre / Mukobeko Road', 0.50, 2.00, 2]
];

const DEMO_LANDLORDS = [
  { email: 'demo.landlord.one@campusnest.local', name: 'Demo Landlord One', verified: true },
  { email: 'demo.landlord.two@campusnest.local', name: 'Demo Landlord Two', verified: false }
];

const DEMO_LISTINGS = [
  { title: 'Gate View Boarding House', photo: '/image/backG.jpg', beds: 4, rent: 850, deposit: 850 },
  { title: 'Katondo Shared Rooms', photo: '/image/background.jpg', beds: 6, rent: 600, deposit: 600 },
  { title: 'Mukobeko Studio Rooms', photo: '/image/1.webp', beds: 2, rent: 1200, deposit: 1200 }
];

async function seedAdmin() {
  const email = requireEnv('ADMIN_EMAIL');
  const password = requireEnv('ADMIN_PASSWORD');
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (full_name, email, password_hash, phone, role, account_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (LOWER(email)) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = 'ADMIN',
       account_status = 'ACTIVE',
       updated_at = NOW()`,
    ['Platform Admin', email, hash, 'N/A', 'ADMIN', 'ACTIVE']
  );
  console.log('admin upserted');
}

async function seedZones() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM zones');
  if (rows[0].n > 0) {
    console.log('zones already present, skipping');
    return;
  }
  for (const [campus, name, min, max, order] of ZONES) {
    await pool.query(
      `INSERT INTO zones (campus, name, approx_distance_min_km, approx_distance_max_km, display_order, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())`,
      [campus, name, min, max, order]
    );
  }
  console.log('zones seeded');
}

async function seedDemo() {
  if (process.env.SEED_DEMO !== '1') {
    console.log('demo seed skipped');
    return;
  }
  const password = requireEnv('SEED_DEMO_PASSWORD');
  const hash = await bcrypt.hash(password, 12);
  const { rows: mainZones } = await pool.query(
    'SELECT id FROM zones WHERE campus = $1 AND is_active = TRUE ORDER BY display_order',
    ['MAIN']
  );

  const landlordIds = [];
  for (let i = 0; i < DEMO_LANDLORDS.length; i++) {
    const demo = DEMO_LANDLORDS[i];
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [demo.email]);
    if (existing.rows.length) {
      console.log(`demo landlord ${i + 1} already present, skipping`);
      landlordIds.push(existing.rows[0].id);
      continue;
    }
    const { rows: inserted } = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, phone, role, account_status, landlord_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'LANDLORD', 'ACTIVE', $5, NOW(), NOW())
       RETURNING id`,
      [demo.name, demo.email, hash, 'N/A', demo.verified]
    );
    landlordIds.push(inserted[0].id);
    console.log(`demo landlord ${i + 1} inserted`);
  }

  for (let i = 0; i < DEMO_LISTINGS.length; i++) {
    const zone = mainZones[i];
    if (!zone) break;
    const spec = DEMO_LISTINGS[i];
    const ownerId = landlordIds[i % landlordIds.length];
    const { rows: existing } = await pool.query(
      'SELECT id FROM listings WHERE landlord_id = $1 AND title = $2',
      [ownerId, spec.title]
    );
    if (existing.rows.length) {
      console.log(`demo listing ${i + 1} already present, skipping`);
      continue;
    }
    const { rows: created } = await pool.query(
      `INSERT INTO listings (
         landlord_id, zone_id, campus, title, description, street_landmark,
         distance_to_campus_km, occupancy, gender_policy, electricity, room_type,
         kitchen, security_level, total_beds, rent_per_month_zmw, deposit_zmw,
         status, created_at, updated_at
       ) VALUES (
         $1, $2, 'MAIN', $3, $4, $5, 1.0, 'SHARING', 'MIXED_SEPARATE_BLOCKS',
         'INCLUDED_IN_RENT', 'SHARED_ABLUTION', 'SHARED_KITCHEN', 'FENCE_AND_GUARD',
         $6, $7, $8, 'ACTIVE', NOW(), NOW()
       ) RETURNING id`,
      [ownerId, zone.id, spec.title, 'Demo listing for local development.', 'Near campus', spec.beds, spec.rent, spec.deposit]
    );
    await pool.query(
      'INSERT INTO listing_photos (listing_id, url, sort_order, created_at) VALUES ($1, $2, 0, NOW())',
      [created[0].id, spec.photo]
    );
    console.log(`demo listing ${i + 1} inserted`);
  }
}

async function main() {
  await seedAdmin();
  await seedZones();
  await seedDemo();
  console.log('seed done');
}

main()
  .then(async () => { await pool.end(); })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
