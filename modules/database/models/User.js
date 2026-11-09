const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, select: false },
  googleId: { type: String, default: null },
  provider: { type: String, enum: ['local', 'google'], required: true },
  emailVerified: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ email: 1 }, { unique: true });
schema.index({ googleId: 1 }, { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } });
module.exports = mongoose.model('User', schema, 'users');
