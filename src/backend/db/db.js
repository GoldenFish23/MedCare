const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

let db = null;

// Initialize database connection
async function initDb(dbPath = process.env.DB_PATH || './data_test/medical_store.db') {
    // Create data directory if it doesn't exist
    const dataDir = dbPath.startsWith('./') ? './data_test' : dbPath;
    if (!require('fs').existsSync(dataDir)) {
        require('fs').mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(dbPath);
    
    // Enable WAL mode, foreign keys, and synchronous settings
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    
    // Execute schema if database is new
    if (!db.get('EXISTS', 'SELECT COUNT(*) FROM sqlite_master WHERE type=\"table\" AND name=\"settings\"')) {
        await executeSchema();
    }
    
    // Seed default admin account if not exists
    const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
    if (!adminExists) {
        const salt = bcrypt.genSalt(10);
        const hashedPassword = bcrypt.hashSync('admin123', salt);
        db.prepare("INSERT INTO users (username, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, ?)")
            .bind('admin', hashedPassword, 'Admin User', 1, 1)
            .run();
    }
    
    return db;
}

async function executeSchema() {
    const schema = await fs.readFile('/workspaces/MediCal/src/backend/db/schema.sql', 'utf8');
    await db.exec(schema);
}

module.exports = {
    db: db,
    initDb
};
