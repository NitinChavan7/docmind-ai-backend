const Document = require("./models/Document");

module.exports = {
  Document,
  User: require('./models/User'),
  Chat: require('./models/Chat'),
  Message: require('./models/Message'),
  AuthSession: require('./models/AuthSession'),
};
