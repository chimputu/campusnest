const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const httpError = (status, code, extra = {}) =>
  Object.assign(new Error(code), { status, code, ...extra });

const idParam = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw httpError(404, 'not_found');
  return n;
};

const isUnique = (err, constraint) =>
  Boolean(err) && err.code === '23505' && (!constraint || err.constraint === constraint);

module.exports = { asyncHandler, httpError, idParam, isUnique };
