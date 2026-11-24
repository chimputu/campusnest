const crypto = require('crypto');
const env = require('../config/env');
const { httpError } = require('../utils');

function baseUrl() {
  return (env.MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com').replace(/\/$/, '');
}

function envName() {
  return env.MOMO_ENV === 'production' ? 'production' : 'sandbox';
}

function configured() {
  return Boolean(env.MOMO_CONSUMER_KEY && env.MOMO_API_USER && env.MOMO_API_KEY && env.MOMO_MERCHANT_ID);
}

function headers(extra = {}) {
  return {
    'Ocp-Apim-Subscription-Key': env.MOMO_CONSUMER_KEY || '',
    'Content-Type': 'application/json',
    ...extra
  };
}

async function accessToken() {
  if (!configured()) throw httpError(503, 'payments_unavailable');
  const basic = Buffer.from(`${env.MOMO_API_USER}:${env.MOMO_API_KEY}`).toString('base64');
  const res = await fetch(`${baseUrl()}/collection/token/`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': env.MOMO_CONSUMER_KEY }
  });
  if (!res.ok) throw httpError(502, 'payments_upstream_error');
  const data = await res.json();
  return data.access_token;
}

async function requestToPay({ amount, phone, externalId, referenceId, message }) {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: headers({
      Authorization: `Bearer ${token}`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': envName()
    }),
    body: JSON.stringify({
      amount: String(amount),
      currency: 'ZMW',
      externalId,
      payer: { partyIdType: 'MSISDN', partyIdentifier: String(phone).replace(/^0/, '260') },
      payerMessage: message || 'CampusNest booking',
      payeeNote: 'CampusNest accommodation'
    })
  });
  if (!res.ok && res.status !== 202 && res.status !== 201) throw httpError(502, 'payments_upstream_error');
  return { referenceId, accepted: true };
}

async function transactionStatus(referenceId) {
  const token = await accessToken();
  const res = await fetch(`${baseUrl()}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`, {
    headers: headers({ Authorization: `Bearer ${token}`, 'X-Target-Environment': envName() })
  });
  if (!res.ok) throw httpError(502, 'payments_upstream_error');
  const data = await res.json();
  return { status: data.status || 'PENDING', reason: data.reason || null };
}

function verifyWebhook(req) {
  const secret = env.MOMO_WEBHOOK_SECRET;
  if (!secret) throw httpError(503, 'payments_unavailable');
  const supplied = String(req.get('x-momo-secret') || '');
  const a = Buffer.from(supplied); const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(401, 'unauthenticated');
}

module.exports = { configured, requestToPay, transactionStatus, verifyWebhook };
