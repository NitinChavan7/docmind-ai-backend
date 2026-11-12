require('dotenv').config();
require('../config/usage-limits');
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--apply'].includes(arg)) || (args.includes('--dry-run') && args.includes('--apply'))) throw new Error('Usage: npm run cleanup:expired -- [--dry-run | --apply]');
  // Require explicit mutation: a bare command is a preview.
  const dryRun = !args.includes('--apply');
  await connectDB();
  const models = require('../modules/database');
  await Promise.all(Object.values(models).map(model => model.init()));
  const report = await require('../modules/usage/cleanup.service').cleanupExpired({ dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (report.failed) process.exitCode = 1;
};
main().catch(() => { console.error('Cleanup failed. Check service availability and configuration.'); process.exitCode = 1; }).finally(() => mongoose.disconnect());
