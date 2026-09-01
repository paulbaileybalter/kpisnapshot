#!/usr/bin/env node
// Usage: node scripts/hash-password.js "YourChosenPassword"
// Prints the SHA-256 hex hash to store in KV under key: auth:password_hash
// (This must match exactly what functions/api/login.js computes.)

const crypto = require("crypto");

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "YourChosenPassword"');
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(password, "utf8").digest("hex");
console.log(hash);
