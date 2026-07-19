const mongoose = require('mongoose');

// Immutable trail of every superadmin action (bans, purges, report resolutions).
// The admin API only ever inserts — no update/delete route exists on purpose, so
// the log stays trustworthy even if an admin account is compromised.
const auditLogSchema = new mongoose.Schema({
  actorId: { type: String, required: true },
  actorName: { type: String, default: '' },
  action: { type: String, required: true }, // 'ban_user' | 'unban_user' | 'purge_content' | 'report_actioned' | ...
  targetType: { type: String, enum: ['user', 'post', 'comment', 'report', 'message'], required: true },
  targetId: { type: String, required: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false });

auditLogSchema.index({ createdAt: -1 });
// "What has been done to this user/post?" — the user-dossier view.
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
