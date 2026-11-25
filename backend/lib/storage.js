const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const env = require('../config/env');
const { httpError } = require('../utils');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function cloudinaryConfigured(config = env) {
  return Boolean(config.CLOUDINARY_CLOUD_NAME && config.CLOUDINARY_API_KEY && config.CLOUDINARY_API_SECRET);
}

function s3Configured(config = env) {
  return Boolean(config.S3_REGION && config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
}

function configured(config = env) {
  return cloudinaryConfigured(config) || s3Configured(config);
}

function makeClient(config = env) {
  return new S3Client({
    region: config.S3_REGION,
    credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
  });
}

function publicUrl(key, config = env) {
  return `https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com/${key}`;
}

// Cloudinary signs the upload parameters (not the file) with the API secret.
// https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
function signCloudinaryUpload(userId, config = env) {
  const folder = `campusnest/${userId}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + config.CLOUDINARY_API_SECRET).digest('hex');
  return {
    provider: 'cloudinary',
    upload_url: `https://api.cloudinary.com/v1_1/${config.CLOUDINARY_CLOUD_NAME}/image/upload`,
    params: {
      api_key: config.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder
    }
  };
}

async function presignPut(userId, contentType, config = env) {
  if (!EXT[contentType]) throw httpError(400, 'validation_failed', { issues: [{ path: 'content_type', message: 'unsupported image type' }] });
  if (cloudinaryConfigured(config)) return signCloudinaryUpload(userId, config);

  const ext = EXT[contentType];
  if (!s3Configured(config)) throw httpError(503, 'storage_unavailable');

  const key = `listings/${userId}/${crypto.randomUUID()}.${ext}`;
  const url = await getSignedUrl(makeClient(config), new PutObjectCommand({
    Bucket: config.S3_BUCKET, Key: key, ContentType: contentType
  }), { expiresIn: 300 });
  return { provider: 's3', key, url, public_url: publicUrl(key, config) };
}

module.exports = { configured, cloudinaryConfigured, s3Configured, presignPut, publicUrl, signCloudinaryUpload };
