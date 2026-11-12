if (require.main === module) require('dotenv').config();
const limits = require('../config/usage-limits');
const mongoose = require('mongoose');
const { Document, Chat } = require('../modules/database');
const connectDB = require('../config/db');

const backfill = async ({ apply = false } = {}) => {
  const report = { apply, documents: 0, chats: 0, wouldExpireNow: 0, skippedWithoutTimestamp: 0 };
  for (const [model, days, key] of [[Document, limits.pdfRetentionDays, 'documents'], [Chat, limits.chatRetentionDays, 'chats']]) {
    for await (const resource of model.find({ expiresAt: null }).select('_id createdAt').lean().cursor()) {
      if (!resource.createdAt || !Number.isFinite(new Date(resource.createdAt).getTime())) { report.skippedWithoutTimestamp++; continue; }
      const expiresAt = new Date(new Date(resource.createdAt).getTime() + days * limits.DAY_MS);
      report[key]++;
      if (expiresAt <= new Date()) report.wouldExpireNow++;
      if (apply) await model.updateOne({ _id: resource._id, expiresAt: null }, { $set: { expiresAt } }, { timestamps: false });
    }
  }
  return report;
};
if (require.main === module) {
  const args = process.argv.slice(2);
  const main = async () => {
    if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) throw new Error('Use --dry-run or --apply');
    await connectDB();
    console.log(JSON.stringify(await backfill({ apply: args.includes('--apply') }), null, 2));
  };
  main().catch(() => { console.error('Retention backfill failed. Check database configuration.'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { backfill };
