const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create a new database or open it if it already exists
const db = new sqlite3.Database(path.join(__dirname, 'portfolio.db'), (err) => {
  if (err) {
    console.error('Failed to open DB', err);
  } else {
    console.log('SQLite database connected.');
  }
});

module.exports = db;
