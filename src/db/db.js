const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 1. App Data Path Define Karein
// Electron production build ke liye appData folder, dev build ke liye root folder
const isDev = process.env.NODE_ENV === 'development';
const dbDir = isDev 
  ? path.join(__dirname) 
  : path.join(process.env.APPDATA || process.env.HOME, 'XyzMedicalShop');

// Folder exist nahi karta toh auto-create karein
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'medical_store.db');
const dbExists = fs.existsSync(dbPath);

// 2. SQLite Database File Open / Create Karein
const db = new Database(dbPath);

// 3. Performance & Integrity Pragmas Enable Karein
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// 4. Agar Database Pehle Se Nahi Tha, Toh Auto-Create Schema Execution
if (!dbExists) {
  console.log('⚡ Empty database detected. Creating tables and triggers from schema.sql...');
  
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
    console.log('✅ Base schema successfully created!');
  } else {
    console.error('❌ Error: schema.sql file not found at:', schemaPath);
  }
} else {
  console.log('✅ SQLite database connected at:', dbPath);
}

module.exports = db;