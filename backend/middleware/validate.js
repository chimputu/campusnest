const formatIssues = (error) =>
  error.issues.map((issue) => ({
    path: issue.path.map((p) => String(p)).join('.'),
    message: issue.message
  }));

const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'validation_failed', issues: formatIssues(result.error) });
  }
  req.valid = req.valid || {};
  req.valid.body = result.data;
  return next();
};

const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({ error: 'validation_failed', issues: formatIssues(result.error) });
  }
  req.valid = req.valid || {};
  req.valid.query = result.data;
  return next();
};

module.exports = { validateBody, validateQuery };
