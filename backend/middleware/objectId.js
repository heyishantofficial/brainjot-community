const mongoose = require('mongoose');

// Guard route params that must be Mongo ObjectIds. Without this, a probe like
// GET /api/posts/garbage throws a CastError deep in Mongoose and surfaces as a
// 500 — wrong semantics and error-log noise from every scanning bot. With it,
// malformed ids short-circuit to a clean 404 before touching the DB.
function objectIdParams(...names) {
  return (req, res, next) => {
    for (const name of names) {
      if (!mongoose.Types.ObjectId.isValid(req.params[name])) {
        return res.status(404).json({ error: 'Not found' });
      }
    }
    next();
  };
}

function isObjectId(value) {
  return typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);
}

module.exports = { objectIdParams, isObjectId };
