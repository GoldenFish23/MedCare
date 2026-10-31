const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

<<<<<<< HEAD

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
=======
let db = null;

// Initialize database connection
function initDb(dbPath = process.env.DB_PATH || './data_test/medical_store.db') {
    // Create data directory if it doesn't exist
    const dataDir = dbPath.startsWith('./') ? './data_test' : dbPath;
    if (!require('fs').existsSync(dataDir)) {
        require('fs').mkdirSync(dataDir, { recursive: true });
>>>>>>> 43b5d7b3695019edf9d5cee36a64aee4978fe7bb
    }

    db = new Database(dbPath);
    
    // Enable WAL mode, foreign keys, and synchronous settings
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    
    // Execute schema if database is new
    const db_schema_check = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
    if(!db_schema_check){
<<<<<<< HEAD
        // console.log(`ececute scema check`);
        executeSchema();
=======
        executeSchema()
>>>>>>> 43b5d7b3695019edf9d5cee36a64aee4978fe7bb
    }
    else{
        console.log(`DB already exists`);
    }
<<<<<<< HEAD
=======

    // if (!db.get('EXISTS', 'SELECT COUNT(*) FROM sqlite_master WHERE type=\"table\" AND name=\"settings\"')) {
    //     await executeSchema();
    // }
    
    // Seed default admin account if not exists
    // const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();


    // if (!adminExists) {
    //     const salt = bcrypt.genSalt(10);
    //     const hashedPassword = bcrypt.hashSync('admin123', salt);
    //     db.prepare("INSERT INTO users (username, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, ?)")
    //         .bind('admin', hashedPassword, 'Admin User', 1, 1)
    //         .run();
    // }
    
    // db.p
    // console.log(`admin exists: ${adminExists}`);
>>>>>>> 43b5d7b3695019edf9d5cee36a64aee4978fe7bb
    
    return db;
}

<<<<<<< HEAD


/**
 * Running schema.sql file
 */
function executeSchema() {
    // read schema file path and create tables and all
    console.log(`execution path: ${__dirname}`);
    const schema = fs.readFileSync(`${__dirname}/schema.sql`, 'utf8');
    db.exec(schema);
}



=======
// const schemaPath = path.join(__dirname, 'schema.sql');

function executeSchema() {
    // read schema file path and create tables and all
    const schema = fs.readFileSync('/workspaces/MediCal/src/backend/db/schema.sql', 'utf8');
    db.exec(schema);
}

>>>>>>> 43b5d7b3695019edf9d5cee36a64aee4978fe7bb
module.exports = {
    db: db,
    initDb
};
