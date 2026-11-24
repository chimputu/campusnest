const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { asyncHandler, httpError, idParam } = require('../utils');
const momo = require('../lib/momo');

const router = express.Router();

const createSchema = z.object({
  request_id: z.coerce.number().int().positive(),
  phone: z.string().regex(/^(\+260|0)\d{9}$/)
});

router.post('/request-to-pay', requireAuth, validateBody(createSchema), asyncHandler(async (req, res) => {
  const b = req.valid.body;
  const { rows } = await pool.query(
    `SELECT r.id, r.tenant_id, r.status, l.deposit_zmw
       FROM requests r JOIN listings l ON l.id = r.listing_id
      WHERE r.id = $1`,
    [b.request_id]
  );
  const request = rows[0];
  if (!request) throw httpError(404, 'not_found');
  if (request.tenant_id !== req.user.id) throw httpError(403, 'forbidden');
  if (!['ACCEPTED', 'COMPLETED'].includes(request.status)) throw httpError(409, 'invalid_transition');
  if (!(request.deposit_zmw > 0)) throw httpError(409, 'nothing_to_pay');

  const referenceId = crypto.randomUUID();
  const externalId = `CN-PAY-${Date.now()}`;
  await momo.requestToPay({
    amount: request.deposit_zmw, phone: b.phone, externalId, referenceId,
    message: `CampusNest booking ${request.id}`
  });
  const { rows: stored } = await pool.query(
    `INSERT INTO payments (request_id, payer_id, amount_zmw, reference_id, external_id, status, phone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, NOW(), NOW()) RETURNING *`,
    [request.id, req.user.id, request.deposit_zmw, referenceId, externalId, b.phone]
  );
  return res.status(201).json({ payment: stored[0] });
}));

router.post('/webhook', asyncHandler(async (req, res) => {
  momo.verifyWebhook(req);
  const referenceId = String(req.body && (req.body.referenceId || req.body.reference_id) || '');
  const status = String(req.body && (req.body.status || '') || '').toUpperCase();
  if (!referenceId || !status) throw httpError(400, 'validation_failed', { issues: [{ path: 'referenceId', message: 'missing fields' }] });
  const mapped = ['SUCCESSFUL', 'COMPLETED'].includes(status) ? 'PAID'
    : ['FAILED', 'CANCELLED'].includes(status) ? 'FAILED' : 'PENDING';
  const { rows } = await pool.query(
    'UPDATE payments SET status = $2 WHERE reference_id = $1 RETURNING *',
    [referenceId, mapped]
  );
  if (!rows.length) throw httpError(404, 'not_found');
  return res.status(200).json({ payment: rows[0] });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
  if (!rows.length) throw httpError(404, 'not_found');
  const payment = rows[0];
  if (payment.payer_id !== req.user.id && req.user.role !== 'ADMIN') throw httpError(403, 'forbidden');
  return res.status(200).json({ payment });
}));

module.exports = router;
