# MongoDB model reference

The seven models store accounts, sessions, PDF metadata, conversations and quota accounting. Each `.js` file defines a Mongoose schema; its companion README describes the current fields, indexes and how the application uses them.

| Model source | Documentation | Main user |
| --- | --- | --- |
| [User.js](User.js) | [User.README.md](User.README.md) | Auth controller and auth middleware |
| [AuthSession.js](AuthSession.js) | [AuthSession.README.md](AuthSession.README.md) | Token service and auth middleware |
| [Document.js](Document.js) | [Document.README.md](Document.README.md) | Document/chat repositories and document leases |
| [Chat.js](Chat.js) | [Chat.README.md](Chat.README.md) | Chat controller/repository |
| [Message.js](Message.js) | [Message.README.md](Message.README.md) | Chat history and turn persistence |
| [UsageAccount.js](UsageAccount.js) | [UsageAccount.README.md](UsageAccount.README.md) | Quota lock and rolling-minute request timestamps |
| [QuestionUsage.js](QuestionUsage.js) | [QuestionUsage.README.md](QuestionUsage.README.md) | Daily/per-chat accounting and distributed generation leases |

All use the `mongoose` package and `{timestamps:true}`. There are no custom schema instance methods or schema statics; business functions live in controllers, repositories and services. Standard methods such as `findOne`, `create`, `exists` and `updateOne` come from Mongoose.

Use [the central export](../index.js) to import models. See the [database overview](../README.md) for connection setup and the relationship diagram. Code examples in the model guides assume they run from this directory, inside an async function where `await` is used. IDs and other variables come from the calling code.
