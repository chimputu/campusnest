const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const env = require('../config/env');
const { httpError } = require('../utils');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function configured() {
  return Boolean(env.S3_REGION && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

function makeClient() {
  if (!configured()) throw httpError(503, 'storage_unavailable');
  return new S3Client({
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
  });
}

function publicUrl(key) {
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
}

async function presignPut(userId, contentType) {
  const ext = EXT[contentType];
  if (!ext) throw httpError(400, 'validation_failed', { issues: [{ path: 'content_type', message: 'unsupported image type' }] });
  const key = `listings/${userId}/${crypto.randomUUID()}.${ext}`;
  const url = await getSignedUrl(makeClient(), new PutObjectCommand({
    Bucket: env.S3_BUCKET, Key: key, ContentType: contentType
  }), { expiresIn: 300 });
  return { key, url, public_url: publicUrl(key) };
}

module.exports = { configured, presignPut, publicUrl };
