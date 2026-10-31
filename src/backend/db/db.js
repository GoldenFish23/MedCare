const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');


// Initialize database connection as null
/**
 * Database instance initailised null on purpose so in `server.js` we could return null if no database instance is found.
 */
let db = null;



// Initialize database connection
/**
 * Creates the Database and the Directory for it.
 * @param {*} dbPath 'Active Process Path'
 * @returns object ('Database') | null 
 */
function initDb(dbPath = process.env.DB_PATH || './data_test/medical_store.db') {
    // Create the parent directory for the database file if it doesn't exist.
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(dbPath) && fs.statSync(dbPath).isDirectory()) {
        console.warn(`DB path is a directory, removing it and recreating as a file: ${dbPath}`);
        fs.rmSync(dbPath, { recursive: true, force: true });
    }

    db = new Database(dbPath);
    
    // Enable WAL mode, foreign keys, and synchronous settings
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    
    // Execute schema if database is new
    const db_schema_check = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
    if(!db_schema_check){
        // console.log(`ececute scema check`);
        executeSchema();
    }
    else{
        console.log(`DB already exists`);
    }
    
    return db;
}



/**
 * Running schema.sql file
 */
function executeSchema() {
    // read schema file path and create tables and all
    console.log(`execution path: ${__dirname}`);
    const schema = fs.readFileSync(`${__dirname}/schema.sql`, 'utf8');
    db.exec(schema);
}



module.exports = {
    db: db,
    initDb
};
