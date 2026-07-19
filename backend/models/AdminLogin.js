const mongoose = require('mongoose');

// Devices a superadmin has logged in from (deviceKey = hash of UA+IP). A login
// whose {userId, deviceKey} pair isn't here yet triggers the new-device push
// alert — if someone hijacks the account, the real owner's phone lights up.
// TTL 180 days so long-unused devices eventually re-trigger the alert.
const adminLoginSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  deviceKey: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

adminLoginSchema.index({ userId: 1, deviceKey: 1 }, { unique: true });
adminLoginSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('AdminLogin', adminLoginSchema);
