CREATE TABLE IF NOT EXISTS messages (
  message_sid TEXT PRIMARY KEY,
  conversation_sid TEXT NOT NULL,
  author TEXT,
  body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages (conversation_sid, created_at);
CREATE TABLE IF NOT EXISTS replies (
  message_sid TEXT PRIMARY KEY,
  conversation_sid TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS opt_outs (
  conversation_sid TEXT NOT NULL,
  author TEXT NOT NULL,
  PRIMARY KEY (conversation_sid, author)
);
