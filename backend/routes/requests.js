const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const pool = require('../config/db');
const { withTransaction } = require('../config/tx');
const { requireRole } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler, httpError, idParam, isUnique } = require('../utils');
const { notify, displayName } = require('../lib/helpers');
const { recomputeListingStatus, lockListing } = require('../lib/listingStatus');

const router = express.Router();

const createSchema = z.object({
  listing_id: z.coerce.number().int().positive(),
  move_in_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d >= new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  }, 'move_in_date must not be in the past'),
  duration_months: z.coerce.number().int().min(1).max(24),
  note: z.string().trim().max(500).optional()
});

const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeReferenceCode(seq) {
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (const b of bytes) suffix += SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length];
  return `CN-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}-${suffix}`;
}

async function readRequest(client, id, lock) {
  const sql = lock
    ? 'SELECT * FROM requests WHERE id = $1 FOR UPDATE'
    : 'SELECT * FROM requests WHERE id = $1';
  const { rows } = await client.query(sql, [id]);
  return rows[0];
}

async function occupied(client, listingId) {
  const { rows } = await client.query(
    "SELECT COUNT(*)::int AS n FROM requests WHERE listing_id = $1 AND status = 'ACCEPTED'",
    [listingId]
  );
  return rows[0].n;
}

function invalidTransition() {
  return httpError(409, 'invalid_transition');
}

async function transition(params) {
  const { req, res, roles, from, to, extra = {}, notice, noticeTitle, noticeBody, noticeLink, allowedActor } = params;
  const id = idParam(req.params.id);
  const initial = await readRequest(pool, id, false);
  if (!initial) throw httpError(404, 'not_found');

  return withTransaction(async (client) => {
    const listing = await lockListing(client, initial.listing_id);
    if (!listing) throw httpError(404, 'not_found');

    if (roles === 'LANDLORD' && listing.landlord_id !== req.user.id) throw httpError(403, 'forbidden');
    if (roles === 'TENANT' && initial.tenant_id !== req.user.id) throw httpError(403, 'forbidden');
    if (roles === 'EITHER') {
      const isTenant = initial.tenant_id === req.user.id;
      const isLandlord = listing.landlord_id === req.user.id;
      if (!isTenant && !isLandlord) throw httpError(403, 'forbidden');
      if (allowedActor === 'tenant' && !isTenant) throw httpError(403, 'forbidden');
    }

    const current = await readRequest(client, id, true);
    if (!current || !from.includes(current.status)) throw invalidTransition();

    const sets = ['status = $2'];
    const values = [id, to];
    for (const [key, value] of Object.entries(extra)) {
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    values.push(from);
    const { rowCount } = await client.query(
      `UPDATE requests SET ${sets.join(', ')} WHERE id = $1 AND status::text = ANY($${values.length}::text[])`,
      values
    );
    if (!rowCount) throw invalidTransition();

    await recomputeListingStatus(client, initial.listing_id);

    if (notice) {
      const { rows: recipients } = await client.query(
        'SELECT tenant_id, listing_id FROM requests WHERE id = $1',
        [id]
      );
      const { rows: owner } = await client.query('SELECT landlord_id FROM listings WHERE id = $1', [recipients[0].listing_id]);
      const target = notice === 'landlord' ? owner[0].landlord_id : recipients[0].tenant_id;
      await notify(client, target, noticeTitle, noticeTitle, noticeBody, noticeLink || null);
    }

    const { rows: fresh } = await client.query('SELECT * FROM requests WHERE id = $1', [id]);
    return fresh[0];
  });
}

router.post('/', requireRole('TENANT'), validateBody(createSchema), asyncHandler(async (req, res) => {
  const b = req.valid.body;
  const created = await withTransaction(async (client) => {
    const listing = await lockListing(client, b.listing_id);
    if (!listing) throw httpError(404, 'not_found');
    if (listing.status === 'FULL' || await occupied(client, b.listing_id) >= listing.total_beds) {
      throw httpError(409, 'listing_full');
    }
    if (listing.status !== 'ACTIVE') throw httpError(409, 'listing_unavailable');

    const { rows: existing } = await client.query(
      "SELECT id FROM requests WHERE listing_id = $1 AND tenant_id = $2 AND status IN ('PENDING','ACCEPTED')",
      [b.listing_id, req.user.id]
    );
    if (existing.length) throw httpError(409, 'already_requested');

    try {
      const { rows } = await client.query(
        `INSERT INTO requests (listing_id, tenant_id, move_in_date, duration_months, note, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW(), NOW()) RETURNING *`,
        [b.listing_id, req.user.id, b.move_in_date, b.duration_months, b.note || null]
      );
      await notify(client, listing.landlord_id, 'REQUEST_CREATED', 'New space request', 'A student requested a space.', `#/requests`);
      return rows[0];
    } catch (err) {
      if (isUnique(err, 'requests_one_active_per_pair')) throw httpError(409, 'already_requested');
      throw err;
    }
  });
  return res.status(201).json({ request: created });
}));

router.get('/mine', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, l.title AS listing_title, l.street_landmark,
            z.name AS zone_name,
            (SELECT p.url FROM listing_photos p WHERE p.listing_id = l.id ORDER BY p.sort_order, p.id LIMIT 1) AS cover_photo_url,
            u.full_name AS landlord_name, u.phone AS landlord_phone, u.email AS landlord_email
       FROM requests r
       JOIN listings l ON l.id = r.listing_id
       JOIN zones z ON z.id = l.zone_id
       JOIN users u ON u.id = l.landlord_id
      WHERE r.tenant_id = $1 AND l.status <> 'REMOVED'
      ORDER BY r.created_at DESC`,
    [req.user.id]
  );
  const requests = rows.map((r) => {
    const { landlord_name, landlord_phone, landlord_email, ...rest } = r;
    const out = { ...rest };
    if (['ACCEPTED', 'COMPLETED'].includes(r.status)) {
      out.landlord = { name: landlord_name, phone: landlord_phone, email: landlord_email };
    }
    return out;
  });
  return res.status(200).json({ requests });
}));

router.get('/inbox', requireRole('LANDLORD'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, l.title AS listing_title, u.full_name AS tenant_name,
            u.phone AS tenant_phone, u.student_id, u.registration_number
       FROM requests r
       JOIN listings l ON l.id = r.listing_id
       JOIN users u ON u.id = r.tenant_id
      WHERE l.landlord_id = $1 AND l.status <> 'REMOVED'
      ORDER BY r.created_at DESC`,
    [req.user.id]
  );
  const requests = rows.map((r) => {
    const { tenant_name, tenant_phone, student_id, registration_number, ...rest } = r;
    const out = { ...rest, tenant_display_name: displayName(tenant_name) };
    if (['ACCEPTED', 'COMPLETED'].includes(r.status)) {
      out.tenant_name = tenant_name;
      out.tenant_phone = tenant_phone;
      out.student_id = student_id;
      out.registration_number = registration_number;
    }
    return out;
  });
  return res.status(200).json({ requests });
}));

router.post('/:id/accept', requireRole('LANDLORD'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const initial = await readRequest(pool, id, false);
  if (!initial) return res.status(404).json({ error: 'not_found' });

  const result = await withTransaction(async (client) => {
    const listing = await lockListing(client, initial.listing_id);
    if (!listing) throw httpError(404, 'not_found');
    if (listing.landlord_id !== req.user.id) throw httpError(403, 'forbidden');
    const current = await readRequest(client, id, true);
    if (!current || current.status !== 'PENDING') throw invalidTransition();
    if (listing.status !== 'ACTIVE') throw httpError(409, 'listing_unavailable');
    if (await occupied(client, listing.id) >= listing.total_beds) throw httpError(409, 'listing_full');

    const { rows: seqRows } = await client.query("SELECT nextval('request_reference_seq') AS seq");
    const code = makeReferenceCode(seqRows[0].seq);
    const { rowCount } = await client.query(
      `UPDATE requests SET status = 'ACCEPTED', accepted_at = NOW(), reference_code = $2
        WHERE id = $1 AND status = 'PENDING'`,
      [id, code]
    );
    if (!rowCount) throw invalidTransition();

    await recomputeListingStatus(client, listing.id);
    await notify(client, current.tenant_id, 'REQUEST_ACCEPTED', 'Request accepted', `Your reference is ${code}.`, `#/receipt/${code}`);
    const { rows: fresh } = await client.query('SELECT * FROM requests WHERE id = $1', [id]);
    return fresh[0];
  });
  return res.status(200).json({ request: result });
}));

router.post('/:id/decline', requireRole('LANDLORD'), asyncHandler(async (req, res) => {
  const result = await transition({
    req, res, roles: 'LANDLORD', from: ['PENDING'], to: 'DECLINED_BY_LANDLORD',
    notice: 'tenant', noticeTitle: 'REQUEST_DECLINED', noticeBody: 'Your request was declined.'
  });
  return res.status(200).json({ request: result });
}));

router.post('/:id/cancel', requireRole('TENANT'), asyncHandler(async (req, res) => {
  const result = await transition({
    req, res, roles: 'TENANT', from: ['PENDING', 'ACCEPTED'], to: 'CANCELLED_BY_STUDENT',
    notice: 'landlord', noticeTitle: 'REQUEST_CANCELLED_BY_STUDENT', noticeBody: 'A student cancelled a request.'
  });
  return res.status(200).json({ request: result });
}));

router.post('/:id/cancel-by-landlord', requireRole('LANDLORD'), asyncHandler(async (req, res) => {
  const result = await transition({
    req, res, roles: 'LANDLORD', from: ['ACCEPTED'], to: 'CANCELLED_BY_LANDLORD',
    notice: 'tenant', noticeTitle: 'REQUEST_CANCELLED_BY_LANDLORD', noticeBody: 'The landlord cancelled your booking.'
  });
  return res.status(200).json({ request: result });
}));

router.post('/:id/complete', requireRole('TENANT', 'LANDLORD'), asyncHandler(async (req, res) => {
  const result = await transition({
    req, res, roles: 'EITHER', from: ['ACCEPTED'], to: 'COMPLETED'
  });
  return res.status(200).json({ request: result });
}));

module.exports = router;
