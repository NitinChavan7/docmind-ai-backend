const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lockKey: { type: String, default: null },
  lockUntil: { type: Date, default: null },
  requestTimes: { type: [Date], default: [] },
}, { timestamps: true });
module.exports = mongoose.model('UsageAccount', schema, 'usage_accounts');
