function notFoundApi(req, res) {
  return res.status(404).json({ error: 'not_found' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.status && err.code) {
    const body = { error: err.code };
    if (err.issues) body.issues = err.issues;
    return res.status(err.status).json(body);
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_json' });
  }

  if (err.code === '23505') {
    return res.status(409).json({ error: 'conflict' });
  }

  if (err.code === '22P02') {
    return res.status(400).json({ error: 'bad_request' });
  }

  console.error(err);
  return res.status(500).json({ error: 'internal' });
}

module.exports = { errorHandler, notFoundApi };
