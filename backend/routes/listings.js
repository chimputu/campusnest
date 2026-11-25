const express = require('express');
const { z } = require('zod');
const pool = require('../config/db');
const { withTransaction } = require('../config/tx');
const { optionalAuth, requireRole } = require('../middleware/auth');
const { validateBody, validateQuery } = require('../middleware/validate');
const { asyncHandler, httpError, idParam } = require('../utils');
const { recomputeListingStatus, lockListing } = require('../lib/listingStatus');
const env = require('../config/env');

const router = express.Router();

const CAMPUS = z.enum(['MAIN', 'TOWN']);
const OCCUPANCY = z.enum(['SINGLE', 'SHARING', 'DORMITORY']);
const GENDER = z.enum(['MALE_ONLY', 'FEMALE_ONLY', 'MIXED_SEPARATE_BLOCKS']);
const ELECTRICITY = z.enum(['INCLUDED_IN_RENT', 'PREPAID_ZESCO_SPLIT', 'TENANT_PAYS']);
const ROOM_TYPE = z.enum(['SELF_CONTAINED', 'SHARED_ABLUTION']);
const KITCHEN = z.enum(['SHARED_KITCHEN', 'OUTDOOR_COOKING', 'NONE']);
const SECURITY = z.enum(['NONE', 'FENCE_ONLY', 'FENCE_AND_GUARD', '24H_GUARD_AND_CCTV']);

function isAllowedPhotoUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;

  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  if (cloudName && url.hostname === 'res.cloudinary.com' && url.pathname.startsWith(`/${cloudName}/`)) return true;

  const s3Host = env.S3_BUCKET && env.S3_REGION ? `${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com` : '';
  return Boolean(s3Host && url.hostname === s3Host && url.pathname.startsWith('/listings/'));
}

const photoUrl = z.string().max(7000000).refine((v) => {
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return true;
  if (isAllowedPhotoUrl(v)) return true;
  return /^\/image\/[A-Za-z0-9._-]+$/.test(v);
}, 'invalid photo url');

const listingBase = z.object({
  zone_id: z.coerce.number().int().positive(),
  campus: CAMPUS,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  street_landmark: z.string().trim().min(2).max(120),
  distance_to_campus_km: z.coerce.number().min(0).max(100).optional(),
  walk_time_minutes: z.coerce.number().int().min(0).max(240).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  occupancy: OCCUPANCY,
  gender_policy: GENDER,
  electricity: ELECTRICITY,
  room_type: ROOM_TYPE,
  kitchen: KITCHEN,
  security_level: SECURITY,
  has_solar_backup: z.boolean().optional().default(false),
  has_borehole: z.boolean().optional().default(false),
  has_overhead_tank: z.boolean().optional().default(false),
  has_parking: z.boolean().optional().default(false),
  free_wifi: z.boolean().optional().default(false),
  water_included: z.boolean().optional().default(false),
  furnished: z.boolean().optional().default(false),
  furnishings_note: z.string().trim().max(500).optional(),
  has_curfew: z.boolean().optional().default(false),
  curfew_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  total_beds: z.coerce.number().int().min(1).max(100),
  rent_per_month_zmw: z.coerce.number().int().positive(),
  deposit_zmw: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['DRAFT', 'ACTIVE']).optional().default('ACTIVE'),
  photos: z.array(z.object({ url: photoUrl })).max(5).optional().default([])
});

const createListingSchema = listingBase.superRefine((v, ctx) => {
  if (v.has_curfew && !v.curfew_time) {
    ctx.addIssue({ code: 'custom', path: ['curfew_time'], message: 'curfew_time is required when has_curfew is true' });
  }
});

const patchListingSchema = listingBase.partial().extend({
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional()
}).superRefine((v, ctx) => {
  if (v.has_curfew === true && !v.curfew_time) {
    ctx.addIssue({ code: 'custom', path: ['curfew_time'], message: 'curfew_time is required when has_curfew is true' });
  }
});

const querySchema = z.object({
  campus: CAMPUS.optional(),
  zone_id: z.coerce.number().int().positive().optional(),
  min_price: z.coerce.number().min(0).optional(),
  max_price: z.coerce.number().min(0).optional(),
  occupancy: OCCUPANCY.optional(),
  gender_policy: GENDER.optional(),
  electricity: ELECTRICITY.optional(),
  room_type: ROOM_TYPE.optional(),
  kitchen: KITCHEN.optional(),
  security_level: SECURITY.optional(),
  has_solar_backup: z.enum(['0', '1', 'false', 'true']).optional(),
  has_borehole: z.enum(['0', '1', 'false', 'true']).optional(),
  has_overhead_tank: z.enum(['0', '1', 'false', 'true']).optional(),
  has_parking: z.enum(['0', '1', 'false', 'true']).optional(),
  free_wifi: z.enum(['0', '1', 'false', 'true']).optional(),
  water_included: z.enum(['0', '1', 'false', 'true']).optional(),
  furnished: z.enum(['0', '1', 'false', 'true']).optional(),
  sort: z.enum(['distance', 'price', 'newest']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  mine: z.enum(['0', '1']).optional()
});

const LISTING_SELECT = `
  l.*,
  (SELECT COUNT(*)::int FROM requests r WHERE r.listing_id = l.id AND r.status = 'ACCEPTED') AS occupied_beds,
  (SELECT p.url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY p.sort_order, p.id LIMIT 1) AS cover_photo_url,
  COALESCE((SELECT AVG(v.stars) FROM reviews v WHERE v.listing_id = l.id), 0) AS avg_rating,
  (SELECT COUNT(*)::int FROM reviews v WHERE v.listing_id = l.id) AS review_count,
  json_build_object('id', u.id, 'name', u.full_name, 'verified', u.landlord_verified) AS landlord
`;

const LISTING_FROM = 'FROM listings l JOIN users u ON u.id = l.landlord_id';

async function verifyZone(client, zoneId, campus) {
  const { rows } = await client.query(
    'SELECT id FROM zones WHERE id = $1 AND is_active = TRUE AND campus = $2',
    [zoneId, campus]
  );
  if (!rows.length) throw httpError(400, 'validation_failed', {
    issues: [{ path: 'zone_id', message: 'zone does not exist for this campus' }]
  });
}

router.get('/', optionalAuth, validateQuery(querySchema), asyncHandler(async (req, res) => {
  const q = req.valid.query;
  const isMine = q.mine === '1';
  if (isMine && !req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (isMine && req.user.role !== 'LANDLORD') return res.status(403).json({ error: 'forbidden' });

  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('$N', `$${params.length}`));
  };

  if (isMine) {
    add('l.landlord_id = $N', req.user.id);
    where.push("l.status IN ('DRAFT','ACTIVE','PAUSED','FULL')");
  } else {
    where.push("l.status IN ('ACTIVE','FULL')");
    where.push("u.account_status = 'ACTIVE'");
  }

  if (q.campus) add('l.campus = $N', q.campus);
  if (q.zone_id) add('l.zone_id = $N', q.zone_id);
  if (q.min_price !== undefined) add('l.rent_per_month_zmw >= $N', q.min_price);
  if (q.max_price !== undefined) add('l.rent_per_month_zmw <= $N', q.max_price);
  if (q.occupancy) add('l.occupancy = $N', q.occupancy);
  if (q.gender_policy) add('l.gender_policy = $N', q.gender_policy);
  if (q.electricity) add('l.electricity = $N', q.electricity);
  if (q.room_type) add('l.room_type = $N', q.room_type);
  if (q.kitchen) add('l.kitchen = $N', q.kitchen);
  if (q.security_level) add('l.security_level = $N', q.security_level);
  for (const flag of ['has_solar_backup', 'has_borehole', 'has_overhead_tank', 'has_parking', 'free_wifi', 'water_included', 'furnished']) {
    if (q[flag] && ['1', 'true'].includes(q[flag])) where.push(`l.${flag} = TRUE`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = q.sort === 'distance'
    ? 'l.distance_to_campus_km ASC NULLS LAST'
    : q.sort === 'price'
      ? 'l.rent_per_month_zmw ASC'
      : q.sort === 'newest'
        ? 'l.created_at DESC'
        : "u.landlord_verified DESC, CASE WHEN l.status = 'ACTIVE' THEN 0 ELSE 1 END, l.created_at DESC";

  const countParams = params.slice();
  const count = await pool.query(`SELECT COUNT(*)::int AS total ${LISTING_FROM} ${whereSql}`, countParams);
  params.push(q.limit, q.offset);
  const data = await pool.query(
    `SELECT ${LISTING_SELECT} ${LISTING_FROM} ${whereSql} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return res.status(200).json({ listings: data.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset });
}));

router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query(
    `SELECT ${LISTING_SELECT} ${LISTING_FROM} WHERE l.id = $1`,
    [id]
  );
  const listing = rows[0];
  if (!listing) return res.status(404).json({ error: 'not_found' });

  const isAdmin = Boolean(req.user && req.user.role === 'ADMIN');
  const isOwner = Boolean(req.user && req.user.id === listing.landlord_id);
  const privileged = isAdmin || isOwner;
  if (!privileged && !['ACTIVE', 'FULL'].includes(listing.status)) {
    return res.status(404).json({ error: 'not_found' });
  }

  const photos = await pool.query(
    'SELECT id, url, sort_order FROM listing_photos WHERE listing_id = $1 ORDER BY sort_order, id',
    [id]
  );
  const landlord = await pool.query(
    `SELECT u.id, u.full_name, u.landlord_verified, u.phone, u.email, u.account_status,
            COALESCE((SELECT AVG(v.stars) FROM reviews v JOIN listings l2 ON l2.id = v.listing_id
                       WHERE l2.landlord_id = u.id), 0) AS avg_rating
       FROM users u WHERE u.id = $1`,
    [listing.landlord_id]
  );
  const owner = landlord.rows[0] || {};
  if (!privileged && owner.account_status !== 'ACTIVE') {
    return res.status(404).json({ error: 'not_found' });
  }

  const profile = { id: owner.id, name: owner.full_name, verified: owner.landlord_verified, avg_rating: owner.avg_rating };
  if (privileged) { profile.phone = owner.phone; profile.email = owner.email; }

  return res.status(200).json({ listing: { ...listing, photos: photos.rows, landlord: profile } });
}));

router.post('/', requireRole('LANDLORD'), validateBody(createListingSchema), asyncHandler(async (req, res) => {
  const b = req.valid.body;
  const created = await withTransaction(async (client) => {
    await verifyZone(client, b.zone_id, b.campus);
    const { rows } = await client.query(
      `INSERT INTO listings (
         landlord_id, zone_id, campus, title, description, street_landmark,
         distance_to_campus_km, walk_time_minutes, latitude, longitude,
         occupancy, gender_policy, electricity, room_type, kitchen, security_level,
         has_solar_backup, has_borehole, has_overhead_tank, has_parking, free_wifi, water_included, furnished,
         furnishings_note, has_curfew, curfew_time, total_beds, rent_per_month_zmw,
         deposit_zmw, status, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
         $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,NOW(),NOW()
       ) RETURNING *`,
      [
        req.user.id, b.zone_id, b.campus, b.title, b.description || null, b.street_landmark,
        b.distance_to_campus_km ?? null, b.walk_time_minutes ?? null, b.latitude ?? null, b.longitude ?? null,
        b.occupancy, b.gender_policy, b.electricity, b.room_type, b.kitchen, b.security_level,
        b.has_solar_backup, b.has_borehole, b.has_overhead_tank, b.has_parking, b.free_wifi, b.water_included, b.furnished,
        b.furnishings_note || null, b.has_curfew, b.curfew_time || null, b.total_beds, b.rent_per_month_zmw,
        b.deposit_zmw, b.status
      ]
    );
    const listing = rows[0];
    for (let i = 0; i < b.photos.length; i++) {
      await client.query(
        'INSERT INTO listing_photos (listing_id, url, sort_order, created_at) VALUES ($1, $2, $3, NOW())',
        [listing.id, b.photos[i].url, i]
      );
    }
    return listing;
  });
  return res.status(201).json({ listing: created });
}));

router.patch('/:id', requireRole('LANDLORD'), validateBody(patchListingSchema), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const b = req.valid.body;
  const updated = await withTransaction(async (client) => {
    const listing = await lockListing(client, id);
    if (!listing) throw httpError(404, 'not_found');
    if (listing.landlord_id !== req.user.id) throw httpError(403, 'forbidden');
    if (listing.status === 'REMOVED') throw httpError(409, 'listing_removed');

    const campus = b.campus ?? listing.campus;
    if (b.zone_id !== undefined || b.campus !== undefined) {
      await verifyZone(client, b.zone_id ?? listing.zone_id, campus);
    }

    if (b.total_beds !== undefined && b.total_beds < listing.total_beds) {
      const { rows: occupiedRows } = await client.query(
        "SELECT COUNT(*)::int AS n FROM requests WHERE listing_id = $1 AND status = 'ACCEPTED'",
        [id]
      );
      if (b.total_beds < occupiedRows[0].n) throw httpError(409, 'beds_below_occupied');
    }

    const fields = [
      'campus', 'title', 'description', 'street_landmark', 'distance_to_campus_km',
      'walk_time_minutes', 'latitude', 'longitude', 'occupancy', 'gender_policy',
      'electricity', 'room_type', 'kitchen', 'security_level', 'has_solar_backup',
      'has_borehole', 'has_overhead_tank', 'has_parking', 'free_wifi', 'water_included', 'furnished', 'furnishings_note',
      'has_curfew', 'curfew_time', 'total_beds', 'rent_per_month_zmw', 'deposit_zmw',
      'status', 'zone_id'
    ];
    const sets = [];
    const values = [];
    for (const field of fields) {
      if (b[field] !== undefined) {
        values.push(b[field]);
        sets.push(`${field} = $${values.length}`);
      }
    }
    if (sets.length) {
      values.push(id);
      await client.query(`UPDATE listings SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    }

    if (b.photos !== undefined) {
      await client.query('DELETE FROM listing_photos WHERE listing_id = $1', [id]);
      for (let i = 0; i < b.photos.length; i++) {
        await client.query(
          'INSERT INTO listing_photos (listing_id, url, sort_order, created_at) VALUES ($1, $2, $3, NOW())',
          [id, b.photos[i].url, i]
        );
      }
    }

    await recomputeListingStatus(client, id);
    const { rows: fresh } = await client.query('SELECT * FROM listings WHERE id = $1', [id]);
    return fresh[0];
  });
  return res.status(200).json({ listing: updated });
}));

router.delete('/:id', requireRole('LANDLORD'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query('SELECT landlord_id, status FROM listings WHERE id = $1', [id]);
  const listing = rows[0];
  if (!listing) return res.status(404).json({ error: 'not_found' });
  if (listing.landlord_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (listing.status === 'REMOVED') return res.status(409).json({ error: 'listing_removed' });
  await pool.query("UPDATE listings SET status = 'REMOVED' WHERE id = $1", [id]);
  return res.status(204).end();
}));

module.exports = router;
