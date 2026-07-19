// Week helpers shared by activity recording (server.js) and the admin growth
// endpoint. Weeks start on Monday, keyed by the Monday's 'YYYY-MM-DD'.

function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function weekKey(d) {
  return mondayOf(d).toISOString().slice(0, 10);
}

function recordActivity(userId) {
  if (!userId) return;
  const UserActivity = require('../models/UserActivity');
  const monday = mondayOf(new Date());
  // Fire-and-forget — activity recording must never slow or fail a request.
  UserActivity.updateOne(
    { userId, week: weekKey(monday) },
    { $setOnInsert: { userId, week: weekKey(monday), weekStart: monday } },
    { upsert: true },
  ).catch(() => {});
}

module.exports = { mondayOf, weekKey, recordActivity };
