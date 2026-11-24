const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const pool = require('./config/db');
const { notFoundApi, errorHandler } = require('./middleware/error');
const { checkOrigin } = require('./middleware/security');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org'],
      connectSrc: ["'self'", 'https://tile.openstreetmap.org'],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cookieParser());
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(checkOrigin);

const bigJson = express.json({ limit: '6mb' });
app.post('/api/listings', bigJson);
app.patch('/api/listings/:id', bigJson);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT current_database() AS database');
    res.json({
      status: 'success',
      message: 'Backend connected to PostgreSQL',
      database: result.rows[0].database
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

app.use('/api/listings/:listingId/reviews', require('./routes/reviews'));
app.use('/api/listings/:listingId/reports', require('./routes/reports'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/saved', require('./routes/saved'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/receipts', require('./routes/receipts'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/payments', require('./routes/payments'));

app.use('/api', notFoundApi);

app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use(errorHandler);

module.exports = app;
