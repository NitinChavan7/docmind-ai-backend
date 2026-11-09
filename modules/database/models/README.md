# MongoDB model reference

Each `.js` file defines a Mongoose schema and exports a model. Each companion README explains its fields, relationships, indexes, callers and usage.

| Model source | Documentation | Main user |
| --- | --- | --- |
| [User.js](User.js) | [User.README.md](User.README.md) | Auth controller and auth middleware |
| [AuthSession.js](AuthSession.js) | [AuthSession.README.md](AuthSession.README.md) | Token service and auth middleware |
| [Document.js](Document.js) | [Document.README.md](Document.README.md) | Document/chat repositories and document leases |
| [Chat.js](Chat.js) | [Chat.README.md](Chat.README.md) | Chat controller/repository |
| [Message.js](Message.js) | [Message.README.md](Message.README.md) | Chat history and turn persistence |

All use the `mongoose` package and `{timestamps:true}`. There are no custom schema instance methods or schema statics; business functions live in controllers, repositories and services. Standard methods such as `findOne`, `create`, `exists` and `updateOne` come from Mongoose.

Use [the central export](../index.js) to import models. See the [database overview](../README.md) for connection setup and the relationship diagram. No real user records, password hashes, session tokens or PDF contents are included in these examples.
