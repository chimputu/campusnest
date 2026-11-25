const express = require('express');
const env = require('../config/env');
const { configured } = require('../lib/storage');

const router = express.Router();

// Public, non-secret client configuration. Never expose API secrets here.
router.get('/', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.status(200).json({
    cloudinary_cloud_name: env.CLOUDINARY_CLOUD_NAME || null,
    storage_configured: configured()
  });
});

module.exports = router;
