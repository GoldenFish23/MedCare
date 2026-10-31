const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db_i = require('./db/db');
const keya = require('./key');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const env = require('dotenv');
const { register } = require('module');



env.config();



// Fixed Constants
const PORT = process.env.PORT || 5000;
const DB_PATH = path.join(__dirname, '../../data_test/medical_store.db');
const ARCHIVE_DIR = path.join(__dirname, '../../data_test/archive');
const DB_DIR = path.dirname(DB_PATH);
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);



// -----------------------------------------------------------------------------
// GLOBAL STATE / SESSION CONTROL
// -----------------------------------------------------------------------------
// These variables keep the database connection and the currently logged-in user.
// The app uses a simple in-memory session object instead of a persistent auth token.
let db_instance = null;
let admin_existence = null;
let lock_status = null;
global.session = null; /* Use Session for login and keeping activity trace */

function get_session_user() {
    // Checking value of session global values.
    if (!global.session || typeof global.session !== 'object') {
        return null;
    }
    return global.session;
}

function is_admin_session() {
    // Return Session - Role_id === 1 (True / False)
    const sessionUser = get_session_user();
    return !!(sessionUser && Number(sessionUser.role_id) === 1);
}

function is_valid_role(role_id) {
    // Returns True / False for roles
    return [1, 2].includes(Number(role_id));
}

function resolve_medicine_id(medicineInput) {
    if (medicineInput === null || medicineInput === undefined || medicineInput === '') {
        return null;
    }

    const trimmed = String(medicineInput).trim();
    if (!trimmed) {
        return null;
    }

    const parsedId = Number(trimmed);
    if (Number.isFinite(parsedId) && parsedId > 0) {
        const existing = db_instance.prepare(`SELECT id FROM medicines WHERE id = ?`).get(parsedId);
        if (existing) {
            return parsedId;
        }
    }

    const medicine = db_instance.prepare(`
        SELECT id
        FROM medicines
        WHERE lower(name) = lower(?)
        LIMIT 1
    `).get(trimmed);

    if (!medicine) {
        throw new Error(`Medicine "${trimmed}" not found.`);
    }

    return Number(medicine.id);
}

function resolve_sale_batch_allocations(item, requestedQuantity) {
    const medicineInput = item.medicine_name ?? item.medicine ?? item.name ?? item.medicine_id;
    const medicineId = resolve_medicine_id(medicineInput);
    const quantity = Number(requestedQuantity || item.quantity || 0);

    if (!medicineId || !quantity) {
        throw new Error('Each sale item requires medicine name or medicine_id and quantity.');
    }

    const batches = db_instance.prepare(`
        SELECT *
        FROM medicine_batches
        WHERE medicine_id = ? AND current_stock > 0
        ORDER BY expiry_date ASC, id ASC
    `).all(medicineId);

    if (batches.length === 0) {
        throw new Error(`No available stock found for medicine "${String(medicineInput).trim()}".`);
    }

    let remaining = quantity;
    const allocations = [];

    for (const batch of batches) {
        if (remaining <= 0) {
            break;
        }

        const available = Number(batch.current_stock || 0);
        const takeQuantity = Math.min(available, remaining);
        if (takeQuantity <= 0) {
            continue;
        }

        const unitPrice = Number(item.unit_price || batch.selling_price || batch.mrp || 0);
        const mrp = Number(item.mrp || batch.mrp || batch.selling_price || unitPrice);
        const total = Number((unitPrice * takeQuantity).toFixed(2));

        allocations.push({
            batchId: batch.id,
            medicineId,
            quantity: takeQuantity,
            unitPrice,
            mrp,
            gstPercent: Number(item.gst_percent || 0),
            itemTotal: total
        });

        remaining -= takeQuantity;
    }

    if (remaining > 0) {
        throw new Error(`Insufficient stock for medicine "${String(medicineInput).trim()}". Needed ${quantity} units.`);
    }

    return allocations;
}

// If a sale includes customer details, this helper makes sure the customer exists.
// If not, it creates the customer automatically and returns the new customer id.
function ensure_customer_for_sale(payload = {}) {
    if (payload.customer_id !== undefined && payload.customer_id !== null && payload.customer_id !== '') {
        // customer_id in payload
        const customerId = Number(payload.customer_id);
        const customer = db_instance.prepare(`SELECT * FROM customers WHERE id = ?`).get(customerId);
        if (!customer) {
            throw new Error(`Customer #${customerId} not found.`);
        }
        return customerId;
    }

    // get detail from payload
    const customerName = payload.customer_name ?? payload.name ?? null;
    const customerPhone = payload.customer_phone ?? payload.phone ?? null;
    const customerAddress = payload.customer_address ?? payload.address ?? null;

    if (customerName === null && customerPhone === null && customerAddress === null) {
        // No information is present.
        return null;
    }

    const trimmedName = customerName !== null ? String(customerName).trim() : '';
    if (!trimmedName) {
        // Customer name necessary
        throw new Error('Customer name is required when customer details are provided during a sale.');
    }

    const normalizedPhone = customerPhone !== null && customerPhone !== undefined ? String(customerPhone).trim() : null;
    const normalizedAddress = customerAddress !== null && customerAddress !== undefined ? String(customerAddress).trim() : null;

    // Getting existent customer information.
    const existingCustomer = db_instance.prepare(`
        SELECT * FROM customers
        WHERE lower(name) = lower(?) OR phone = ?
        LIMIT 1
    `).get(trimmedName, normalizedPhone || '');
    
    // Update the existent data of customer
    if (existingCustomer) {
        const updates = [];
        const values = [];

        if (normalizedPhone && (!existingCustomer.phone || existingCustomer.phone !== normalizedPhone)) {
            updates.push('phone = ?');
            values.push(normalizedPhone);
        }
        if (normalizedAddress && (!existingCustomer.address || existingCustomer.address !== normalizedAddress)) {
            updates.push('address = ?');
            values.push(normalizedAddress);
        }
        // Add into db
        if (updates.length > 0) {
            values.push(existingCustomer.id);
            db_instance.prepare(`
                UPDATE customers
                SET ${updates.join(', ')}
                WHERE id = ?
            `).run(...values);
        }

        return Number(existingCustomer.id);
    }

    // If not returned till now means information is missing so create a new one.
    const insertResult = db_instance.prepare(`
        INSERT INTO customers (name, phone, address)
        VALUES (?, ?, ?)
    `).run(trimmedName, normalizedPhone, normalizedAddress);

    return Number(insertResult.lastInsertRowid);
}



// Checks and Initalization of DB and Passcode file for Step 1
/**
 * Checks if Database exists not and create a new one if not.
 */
function ensure_database_directory() {
    // Ensures DB presence or create one
    try {
        fs.mkdirSync(DB_DIR, { recursive: true });
        return true;
    }
    catch (err) {
        console.error('Database directory creation failed:', err.message);
        return false;
    }
}

function ensure_archive_directory() {
    // Ensures Archive Dirctory presence or create one
    try {
        fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
        return true;
    }
    catch (err) {
        console.error('Archive directory creation failed:', err.message);
        return false;
    }
}

function get_archive_month_tag(date = new Date()) {
    // Getting Month tag for archive
    return new Date(date).toISOString().slice(0, 7);
}

function zip_files(filePaths, outputZipPath) {
    // Zipping file
    const validFiles = filePaths.filter((file) => file && fs.existsSync(file));
    if (validFiles.length === 0) {
        // Invalid file
        return false;
    }

    try {
        // compress file
        if (process.platform === 'win32') {
            const fileList = validFiles.map((file) => `"${file.replace(/"/g, '""')}"`).join(', ');
            execSync(`powershell -NoProfile -Command "Compress-Archive -Path ${fileList} -DestinationPath \"${outputZipPath}\" -Force"`, { stdio: 'pipe' });
            return fs.existsSync(outputZipPath);
        }

        const escapedFiles = validFiles.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(' ');
        execSync(`zip -j "${outputZipPath}" ${escapedFiles}`, { stdio: 'pipe' });
        return fs.existsSync(outputZipPath);
    }
    catch (err) {
        console.error('Zip creation failed:', err.message);
        return false;
    }
}

function build_archive_summary(archivePath, reason, monthTag) {
    // building archive summary
    if (!db_instance || !fs.existsSync(DB_PATH)) {
        return null;
    }

    const summary = {
        month: monthTag,
        reason,
        created_at: new Date().toISOString(),
        archive_path: archivePath,
        stats: {
            total_sales: Number(db_instance.prepare(`SELECT COALESCE(SUM(grand_total), 0) FROM sales`).get()['COALESCE(SUM(grand_total), 0)'] || 0),
            total_purchase: Number(db_instance.prepare(`SELECT COALESCE(SUM(total_amount), 0) FROM purchases`).get()['COALESCE(SUM(total_amount), 0)'] || 0),
            sales_count: Number(db_instance.prepare(`SELECT COUNT(*) AS count FROM sales`).get().count || 0),
            purchase_count: Number(db_instance.prepare(`SELECT COUNT(*) AS count FROM purchases`).get().count || 0),
            recent_activity: db_instance.prepare(`
                SELECT al.*, u.username, u.full_name
                FROM activity_logs al
                LEFT JOIN users u ON u.id = al.user_id
                ORDER BY al.created_at DESC
                LIMIT 10
            `).all(),
            top_suppliers: db_instance.prepare(`
                SELECT s.name,
                       ROUND(COALESCE(SUM(p.total_amount), 0), 2) AS total_purchase
                FROM purchases p
                LEFT JOIN suppliers s ON s.id = p.supplier_id
                GROUP BY s.id, s.name
                ORDER BY total_purchase DESC
                LIMIT 5
            `).all()
        }
    };

    return summary;
}

function archive_database({ reason = 'manual' } = {}) {
    // Archiving database
    if (!db_instance) {
        return { success: false, message: 'No active database connection.' };
    }

    ensure_archive_directory();
    const monthTag = get_archive_month_tag();
    const baseName = `medical_store_${reason}_${monthTag}`;
    const archivePath = path.join(ARCHIVE_DIR, `${baseName}.zip`);
    const summaryPath = path.join(ARCHIVE_DIR, `${baseName}_summary.json`);
    const tempDbPath = path.join(ARCHIVE_DIR, `${baseName}.db`);
    const walSource = `${DB_PATH}-wal`;
    const shmSource = `${DB_PATH}-shm`;
    const tempWalPath = `${tempDbPath}-wal`;
    const tempShmPath = `${tempDbPath}-shm`;
    const filesToArchive = [tempDbPath];

    const previousDbInstance = db_instance;
    const summary = build_archive_summary(archivePath, reason, monthTag);

    try {
        previousDbInstance.close();
        db_instance = null;

        // Create a stable snapshot while the app is not holding the live SQLite files open.
        fs.copyFileSync(DB_PATH, tempDbPath);
        if (fs.existsSync(walSource)) {
            fs.copyFileSync(walSource, tempWalPath);
            filesToArchive.push(tempWalPath);
        }
        if (fs.existsSync(shmSource)) {
            fs.copyFileSync(shmSource, tempShmPath);
            filesToArchive.push(tempShmPath);
        }

        if (!zip_files(filesToArchive, archivePath)) {
            throw new Error('ZIP archive creation failed.');
        }

        if (summary) {
            fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        }

        db_instance = Database(DB_PATH);
        return {
            success: true,
            archive_path: archivePath,
            summary_path: summaryPath,
            reason,
            month: monthTag
        };
    }
    catch (err) {
        try {
            if (!db_instance && fs.existsSync(DB_PATH)) {
                db_instance = Database(DB_PATH);
            }
        }
        catch (reopenErr) {
            console.error('Database reopen after archive failed:', reopenErr.message);
        }
        return { success: false, message: err.message };
    }
    finally {
        for (const tempFile of [tempDbPath, tempWalPath, tempShmPath]) {
            if (fs.existsSync(tempFile)) {
                try {
                    fs.unlinkSync(tempFile);
                }
                catch (cleanupErr) {
                    console.warn('Archive temp cleanup failed:', cleanupErr.message);
                }
            }
        }
    }
}

function list_archived_files() {
    // Returns files inside Archive Dir
    if (!fs.existsSync(ARCHIVE_DIR)) {
        // If Archive Dir has no files
        return [];
    }

    return fs.readdirSync(ARCHIVE_DIR)
        .filter((file) => file.endsWith('.zip') || file.endsWith('_summary.json'))
        .sort()
        .reverse()
        .map((file) => ({
            name: file,
            path: path.join(ARCHIVE_DIR, file),
            size: fs.existsSync(path.join(ARCHIVE_DIR, file)) ? fs.statSync(path.join(ARCHIVE_DIR, file)).size : 0
        }));
}

function search_archived_tracking({ month = null, query = '' } = {}) {
    // Tracking from old archived data for tracking.
    if (!fs.existsSync(ARCHIVE_DIR)) {
        return { success: true, archives: [], tracking: [] };
    }
    // Getting summaries from archive summary when tracking.
    const summaries = fs.readdirSync(ARCHIVE_DIR)
        .filter((file) => file.endsWith('_summary.json'))
        .map((file) => {
            const filePath = path.join(ARCHIVE_DIR, file);
            try {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
            catch (err) {
                return null;
            }
        })
        .filter(Boolean);

    const normalizedQuery = String(query || '').trim().toLowerCase();
    const filtered = summaries.filter((summary) => {
        if (month && String(summary.month) !== String(month)) {
            return false;
        }

        if (!normalizedQuery) {
            return true;
        }

        const haystack = JSON.stringify(summary).toLowerCase();
        return haystack.includes(normalizedQuery);
    });

    return {
        success: true,
        archives: filtered,
        tracking: filtered.map((summary) => ({
            month: summary.month,
            reason: summary.reason,
            created_at: summary.created_at,
            archive_path: summary.archive_path,
            stats: summary.stats
        }))
    };
}

function restore_latest_archive_if_available() {
    // Restoring latest archive if availabe
    if (fs.existsSync(DB_PATH)) {
        return true;
    }

    if (!ensure_archive_directory()) {
        return false;
    }

    const archives = fs.readdirSync(ARCHIVE_DIR)
        .filter((file) => file.endsWith('.db'))
        .sort()
        .reverse();

    if (archives.length === 0) {
        return false;
    }

    const newestArchive = path.join(ARCHIVE_DIR, archives[0]);
    try {
        // Restore with latest archive data
        fs.copyFileSync(newestArchive, DB_PATH);

        const latestWal = `${newestArchive}-wal`;
        const latestShm = `${newestArchive}-shm`;

        if (fs.existsSync(latestWal)) {
            fs.copyFileSync(latestWal, `${DB_PATH}-wal`);
        }
        if (fs.existsSync(latestShm)) {
            fs.copyFileSync(latestShm, `${DB_PATH}-shm`);
        }

        console.log(`Restored database backup from ${newestArchive}`);
        return true;
    }
    catch (err) {
        console.error('Database restore failed:', err.message);
        return false;
    }
}

function db_existence() {
    ensure_database_directory();

    if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).isDirectory()) {
        console.warn(`DB path points to a directory, cleaning it up before reopening: ${DB_PATH}`);
        fs.rmSync(DB_PATH, { recursive: true, force: true });
    }

    if (fs.existsSync(DB_PATH)){
        // Database already intialized
        db_instance = Database(DB_PATH);
        console.log(`DB exists`);
    }
    else if (restore_latest_archive_if_available()){
        db_instance = Database(DB_PATH);
        console.log(`DB restored from archive`);
    }
    else{
        // Creates fresh sqlite db
        db_instance = db_i.initDb(DB_PATH);
        if(db_instance){
            // console.log(`Created New DB ${db_instance}`);
            console.log(`Created New DB`);
        }
        // Generates only at time of initialization
        const key = keya.create_activation_file();
        // Set settings with activation key and lock status 
        db_instance.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('activation_key', key);
        db_instance.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('lock_status', 'LOCKED');
        console.log(`Generated key: ${key}`);
        // .prepare
    }
    console.log(db_instance ? 'DB connected' : 'DB disconnected');
};


db_existence();
start_monthly_archive_scheduler();


// -----------------------------------------------------------------------------
// TRACKING TABLES & EVENT LOGGING
// -----------------------------------------------------------------------------
// These tables are used for app-level activity tracking and user notifications.
// They are created automatically when the database is initialized.
// function ensure_tracking_tables() {
//     if (!db_instance) {
//         return;
//     }



// ensure_tracking_tables();

function maybe_archive_monthly_data() {
    // Check & update the latest archive month detail.
    if (!db_instance) {
        return;
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    const lastArchive = db_instance.prepare(`
        SELECT value
        FROM settings
        WHERE key = 'last_monthly_archive'
    `).get();

    if (lastArchive && lastArchive.value === currentMonth) {
        return;
    }

    const archiveResult = archive_database({ reason: 'monthly' });
    if (archiveResult.success) {
        db_instance.prepare(`
            INSERT OR REPLACE INTO settings (key, value)
            VALUES ('last_monthly_archive', ?)
        `).run(currentMonth);
    }
}

function start_monthly_archive_scheduler() {
    if (global.__monthly_archive_scheduler) {
        return;
    }

    global.__monthly_archive_scheduler = setInterval(() => {
        try {
            if (!db_instance) {
                return;
            }
            maybe_archive_monthly_data();
        }
        catch (err) {
            console.error('Monthly archive scheduler failed:', err.message);
        }
    }, 6 * 60 * 60 * 1000);

    maybe_archive_monthly_data();
}

// Adds a record to the notifications table for a specific user.
function add_notification({ user_id = null, title = 'System Notification', message = '', type = 'INFO' } = {}) {
    // Add notifications
    if (!db_instance) {
        return null;
    }
    // notification added by user_id activity
    const targetUser = user_id ?? (get_session_user() ? get_session_user().id : null);
    if (targetUser === null || targetUser === undefined) {
        return null;
    }

    const stmt = db_instance.prepare(`
        INSERT INTO notifications (user_id, title, message, type, is_read)
        VALUES (?, ?, ?, ?, 0)
    `);
    return stmt.run(Number(targetUser), String(title), String(message), String(type).toUpperCase());
}

// Stores an activity record for auditing and dashboard/tracking screens.
function add_activity_log({ user_id = null, action = 'ACTION', entity_type = null, entity_id = null, details = null } = {}) {
    // Add a activity trace log by users
    if (!db_instance) {
        return null;
    }

    const activeUser = user_id ?? (get_session_user() ? get_session_user().id : null);
    const stmt = db_instance.prepare(`
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details)
        VALUES (?, ?, ?, ?, ?)
    `);

    return stmt.run(
        activeUser !== null && activeUser !== undefined ? Number(activeUser) : null,
        String(action),
        entity_type ? String(entity_type) : null,
        entity_id !== null && entity_id !== undefined ? Number(entity_id) : null,
        details ? String(details) : null
    );
}



// Web hosting starts from here
const app = express();

app.use(express.json());

const PUBLIC_PATHS = new Set([
    '/',
    '/api/status',
    '/login',
    '/register',
    '/forgot-password'
]);

app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = FRONTEND_ORIGINS;

    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    try {
        if (!db_instance || !fs.existsSync(DB_PATH)) {
            return res.status(503).json({
                success: false,
                message: 'Database unavailable. Please restore the database or restart the backend service.'
            });
        }
    }
    catch (err) {
        console.error('Database continuity check failed:', err.message);
        return res.status(503).json({ success: false, message: 'Database check failed.' });
    }

    const requestPath = req.path || '/';
    if (PUBLIC_PATHS.has(requestPath)) {
        return next();
    }

    if (!get_session_user()) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required. Please log in to access this API.'
        });
    }

    return next();
});

function graceful_shutdown(signal = 'SIGTERM') {
    console.log(`Shutting down backend because ${signal} was received.`);

    try {
        archive_database({ reason: `shutdown_${signal.toLowerCase()}` });
    }
    catch (err) {
        console.error('Archive during shutdown failed:', err.message);
    }

    if (db_instance) {
        try {
            db_instance.close();
        }
        catch (err) {
            console.error('Database close failed:', err.message);
        }
        db_instance = null;
    }

    if (httpServer && typeof httpServer.close === 'function') {
        httpServer.close(() => process.exit(0));
        return;
    }

    process.exit(0);
}

process.on('SIGINT', () => graceful_shutdown('SIGINT'));
process.on('SIGTERM', () => graceful_shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
    console.error('Unhandled exception:', err.message);
    try {
        archive_database({ reason: 'uncaught_exception' });
    }
    catch (archiveErr) {
        console.error('Backup during failure failed:', archiveErr.message);
    }
    graceful_shutdown('uncaughtException');
});


// Check route links at main page
app.get('/',(req, res)=>{
    res.status(200).json({
        'API Health': '/api/status',
        'Session Status' : `${global.session}`,
        Register: '/register',
        Login: '/login',
        Logout: '/logout',
        Change_Password: '/change-password',
        Forgot_Password: '/forgot-password',
        Users: '/user',
        Customer: '/customer',
        Supplier: '/supplier',
        Medicine_Category : '/medicine_Catg',
        Medicine: '/medicine',
        Backup: '/backup',
        Medicine_Batch: '/buy_Med_Supply',
        Purchase: '/buy',
        Purchase_return: '/purchase_return',
        Sale: '/sell',
        Sale_return: '/sale_return',
        Stock: '/stock',
        Archives: '/archives',
        Specific_Archive: '/archive/search',
        Notification: '/notifications',
        Activities: '/activity',
        Tracking: '/tracking',
        Invoice: '/invoice',
        Search_by: '/search_by'
    })
});

// Connection checks // Delete
app.get('/api/status', (req, res) => {
    // console.log(`Hi`);
    res.status(200).json({
        database: db_i ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    })
});


function get_lock_status(){
    // Get lock status
    let status = db_instance.prepare(
        `
        SELECT value
        FROM settings
        WHERE key = 'lock_status'
        `
    ).get();
    status = status.value || null;
    console.log(`status: ${status}`)
    return status;
};

function normalize_password_value(password) {
    if (password === null || password === undefined) {
        return '';
    }
    return String(password).trim();
}

function hash_password_value(password) {
    const normalized = normalize_password_value(password);
    if (!normalized) {
        return '';
    }
    return bcrypt.hashSync(normalized, 10);
}

function verify_password_value(storedValue, suppliedPassword) {
    const normalizedSupplied = normalize_password_value(suppliedPassword);
    if (!storedValue || !normalizedSupplied) {
        return false;
    }
    if (typeof storedValue === 'string' && storedValue.startsWith('$2')) {
        return bcrypt.compareSync(normalizedSupplied, storedValue);
    }
    return storedValue === normalizedSupplied;
}

app.route('/backup')
    .post((req, res) => {
        // create backup
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to archive the database.' });
        }

        const result = archive_database({ reason: 'manual' });
        if (!result.success) {
            return res.status(500).json({ success: false, error: result.message });
        }

        return res.status(200).json({
            success: true,
            backup: result,
            message: 'Database archive created successfully.'
        });
    });

app.get('/archives', (req, res) => {
    if (!get_session_user()) {
        return res.status(401).json({ message: 'Inactive Session! Please login to view archive details.' });
    }

    try {
        const archives = list_archived_files();
        return res.status(200).json({ success: true, archives });
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

app.get('/archive/search', (req, res) => {
    if (!get_session_user()) {
        return res.status(401).json({ message: 'Inactive Session! Please login to search archived data.' });
    }

    try {
        const month = req.query.month || req.query.archive_month || null;
        const query = req.query.query || req.query.keyword || req.query.search || '';
        const result = search_archived_tracking({ month, query });
        return res.status(200).json(result);
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});




// -----------------------------------------------------------------------------
// AUTHENTICATION ROUTES
// -----------------------------------------------------------------------------
// First-time setup flow: register the super admin using the activation key.
app.route('/register')
    .get((req, res) => {
        // No session is alloted so no session check is needed in this url
        lock_status = get_lock_status();
        console.log(`${lock_status}`);
        // Once superadmin is registered hits the most time.
        if (lock_status === 'UNLOCKED'){
            console.log(`App's been already registered -_-`)
            // Safely redirect to /login
            return res.redirect('/login');
        }
        // Only once till the SuperAdmin is not registered
        else if(lock_status === 'LOCKED'){
            // Only if the lock_status is locked
            // Shows nothing to the /register url
            console.log(`Register the Super Admin for the App!`);
            return res.status(200).json({
                message: 'Register the Super Admin for the App!'
            });
        }
        else{
            // invalid LOCK_STATUS value
            console.log(`Invalid LOCK_STATUS value`);
            return res.status(422).json({
                message: 'Invalid LOCK_STATUS value'
            })
        }
    })
    .post((req, res) => {
        /*API structure
        curl -X POST http://localhost:5000/users \
        - H "Content-Type: application/json" \
        - d '{
            "username": "rahul",
            "password_hash": "hashedPass", // Encrypted password
            "activation_key": "ACTIVATION_KEY",
            "full_name": "full_name"
        }'
        */
        // Try Transactions 
        // Check DB presence
        if (!db_instance){
            console.log(`Missing Database`);
            return res.status().json({message: 'Missing Database'})
        }

        try{
            // Extract username, password and name of the user to register super admin.
            let {username, password, password_hash, full_name, activation_key} = req.body;
            let role_id = 1 // DEFAULT admin role (might need a special role than admin)
            let is_active = 1

            const rawPassword = normalize_password_value(password ?? password_hash);
            if (!username || !rawPassword || !full_name || !activation_key) {
                return res.status(400).json({
                    success: false,
                    message: 'username, password, full_name and activation_key are required.'
                });
            }

            const hashedPassword = hash_password_value(rawPassword);

            // Getting Activation key
            let ACTIVATION_KEY = db_instance.prepare(`
                SELECT value
                FROM settings
                WHERE key = 'activation_key'
            `).get();

            // console.log(`${ACTIVATION_KEY.value}`)
            
            // Key matching
            if (activation_key === ACTIVATION_KEY.value){
                // Create Super Admin
                let superAdmin = db_instance.prepare(`
                    INSERT INTO users (username, password_hash, full_name, role_id, is_active)
                    VALUES (?, ?, ?, ?, ?)
                `).run(username, hashedPassword, full_name, role_id, is_active ?? 1);

                // Update lock status
                let lock_status = db_instance.prepare(`
                    UPDATE settings
                    SET value = 'UNLOCKED'
                    WHERE key = 'lock_status'
                `).run();

                if(superAdmin.changes > 0 && lock_status.changes > 0){
                    console.log(`Super Admin created successfully -_-`);
                    return res.status(200).json({
                        success: true,
                        message: 'User created successfully',
                        redirect: '/login'
                    });
                }

                console.log(`Super Admin created successfully -_-`);
                // Super Admin Created successfully.
                return res.status(400).json({
                    success: false,
                    message: 'Process changed Abrubtly! Register again',
                    redirect: '/login'
                });
            }
            else{
                // Invalid or Incorrect Activation Key.
                console.log(`Invalid or Incorrect Activation Key. Inserted Key : ${activation_key}, DB Key : ${ACTIVATION_KEY.value}`)
                return res.status(422).json({
                    message: 'Invalid or Incorrect Activation Key.'
                })
            }
        }
        // Super Admin Creation failed.
        catch(err){
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });


        
// Login route: checks username + password, then creates a session object.
app.route('/login')
    .get((req, res) =>{
        // Empty session
        if(!global.session){
            return res.status(200).json({
                message: 'Login with user details ->',
                format: {
                    username: 'Username',
                    password: 'Password'
                }
            });
        }
        // Already logged in Session
        else{
            const sessionUser = get_session_user();
            return res.status(200).json({
                message: 'User is already Logged In. Ready to Route',
                session: sessionUser
            });
        } 
    })
    .post((req,res) =>{
        /**API structure
        curl -X POST http://localhost:5000/users \
        - H "Content-Type: application/json" \
        - d '{
            "username": "rahul",
            "password_hash": "hashedPass", // Encrypted password
            "role_id": 1 || 2
        }'
        */
        // Try Logging In.
        try{
            // Extract username, password and role_id to match login.
            let {username, password, role_id} = req.body;

            //-------------------------> Password Validation Check Missing
            // DB check
            if(!db_instance){
                return res.status(400).json({
                    message: 'Missing Database file !'
                });
            }
            // Get all users to check among with following role_id and active id.
            let user = db_instance.prepare(`
                SELECT * 
                FROM users u
                WHERE u.username = ? AND u.role_id = ? AND u.is_active = 1
            `).get(username, role_id);
            
            // No user found.
            if(!user){
                return res.status(422).json({
                    message: 'No Users found. Create a user first.'
                });
            }
            else{
                // User found, so update with logged in session
                if (verify_password_value(user.password_hash, password)){
                    const sessionUser = {
                        id: user.id,
                        username: user.username,
                        full_name: user.full_name,
                        role_id: user.role_id
                    };
                    global.session = sessionUser;
                    add_activity_log({
                        user_id: user.id,
                        action: 'LOGIN',
                        entity_type: 'user',
                        entity_id: user.id,
                        details: `${user.username} signed in`
                    });
                    add_notification({
                        user_id: user.id,
                        title: 'Login successful',
                        message: `Welcome back, ${user.full_name}.`,
                        type: 'INFO'
                    });
                    console.log(`${user.username} logged in -_-`);
                    return res.status(200).json({
                        message: 'Login Successful -_-',
                        session: sessionUser
                    });
                }
                else{
                    return res.status(401).json({
                        message: 'Invalid Password!'
                    });
                }
            }
        }
        // Login failed with Error
        catch(err){
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });


// Logout API
app.route('/logout')
    .get((req,res) => {
        // Although No need of Get is required cause its just about a click
        // Already logged in Session
        if(global.session){
            return res.status(200).json({
                message: 'Active session can be Logged Out!'
            });
        }
        // Empty session logout failure
        else{
            return res.status(200).json({
                message: 'No Active Session to Log Out !'
            });
        }
    })
    .post((req, res) => {
        // *Only POST method should be kept for logout button.
        // Already logged in Session
        console.log(`${JSON.stringify(global.session)} logging out -_-`);

        if(global.session){
            // if session is present, set session to Null (Flush Session).
            let prev_session = get_session_user();
            add_activity_log({
                user_id: prev_session ? prev_session.id : null,
                action: 'LOGOUT',
                entity_type: 'user',
                entity_id: prev_session ? prev_session.id : null,
                details: prev_session ? `${prev_session.username} signed out` : 'Anonymous session ended'
            });
            global.session = null;
            return res.status(200).json({
                message: 'Session Logged Out Successfully -_-',
                session: prev_session
            });
        }
        // Empty session logout failure
        else{
            return res.status(400).json({
                message: 'No Active Session to Log Out !'
            });
        }
    });

app.route('/change-password')
    .post((req, res) => {
        if (!db_instance) {
            return res.status(400).json({ success: false, message: 'Missing Database file !' });
        }

        const sessionUser = get_session_user();
        if (!sessionUser) {
            return res.status(401).json({ success: false, message: 'Inactive Session! Please login to change your password.' });
        }

        const { current_password, new_password, confirm_password } = req.body || {};
        const candidateCurrent = normalize_password_value(current_password);
        const candidateNew = normalize_password_value(new_password);
        const candidateConfirm = normalize_password_value(confirm_password);

        if (!candidateCurrent || !candidateNew || !candidateConfirm) {
            return res.status(400).json({ success: false, message: 'current_password, new_password and confirm_password are required.' });
        }

        if (candidateNew.length < 6) {
            return res.status(400).json({ success: false, message: 'new_password must be at least 6 characters long.' });
        }

        if (candidateNew !== candidateConfirm) {
            return res.status(400).json({ success: false, message: 'new_password and confirm_password do not match.' });
        }

        const user = db_instance.prepare(`
            SELECT *
            FROM users
            WHERE id = ? AND is_active = 1
        `).get(sessionUser.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found or inactive.' });
        }

        if (!verify_password_value(user.password_hash, candidateCurrent)) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
        }

        if (verify_password_value(user.password_hash, candidateNew)) {
            return res.status(400).json({ success: false, message: 'new_password must be different from the current password.' });
        }

        const hashedPassword = hash_password_value(candidateNew);
        db_instance.prepare(`
            UPDATE users
            SET password_hash = ?
            WHERE id = ?
        `).run(hashedPassword, user.id);

        add_activity_log({
            user_id: user.id,
            action: 'CHANGE_PASSWORD',
            entity_type: 'user',
            entity_id: user.id,
            details: `${user.username} updated their password.`
        });

        return res.status(200).json({
            success: true,
            message: 'Password changed successfully.'
        });
    });

app.route('/forgot-password')
    .post((req, res) => {
        if (!db_instance) {
            return res.status(400).json({ success: false, message: 'Missing Database file !' });
        }

        const { username, full_name, new_password, confirm_password } = req.body || {};
        const normalizedUsername = String(username || '').trim();
        const normalizedName = String(full_name || '').trim();
        const candidateNew = normalize_password_value(new_password);
        const candidateConfirm = normalize_password_value(confirm_password);

        if (!normalizedUsername || !normalizedName || !candidateNew || !candidateConfirm) {
            return res.status(400).json({ success: false, message: 'username, full_name, new_password and confirm_password are required.' });
        }

        if (candidateNew.length < 6) {
            return res.status(400).json({ success: false, message: 'new_password must be at least 6 characters long.' });
        }

        if (candidateNew !== candidateConfirm) {
            return res.status(400).json({ success: false, message: 'new_password and confirm_password do not match.' });
        }

        const user = db_instance.prepare(`
            SELECT *
            FROM users
            WHERE lower(username) = lower(?) AND lower(full_name) = lower(?) AND is_active = 1
        `).get(normalizedUsername, normalizedName);

        if (!user) {
            return res.status(404).json({ success: false, message: 'No active user matched the provided username and full name.' });
        }

        const hashedPassword = hash_password_value(candidateNew);
        db_instance.prepare(`
            UPDATE users
            SET password_hash = ?
            WHERE id = ?
        `).run(hashedPassword, user.id);

        add_activity_log({
            user_id: user.id,
            action: 'RESET_PASSWORD',
            entity_type: 'user',
            entity_id: user.id,
            details: `${user.username} reset their password via forgot-password.`
        });

        return res.status(200).json({
            success: true,
            message: 'Password reset successfully. Please login again with the new password.'
        });
    });


// Manage Store Users API
app.route('/user')
    .get((req, res) => {
        // Session check
        if(!global.session){
            // No session available ...
            return res.status(401).json({message: 'Inactive Session! Please login to see users'})
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        try{
            let user = null;
            // Getting all users from database without exposing password material.
            user = db_instance.prepare(`
                SELECT 
                    u.id as user_id, 
                    u.username,
                    u.full_name,
                    CASE
                        WHEN u.is_active = 1 THEN 'Active'
                        ELSE 'Inactive'
                    END as status,
                    u.created_at AS user_created_at,
                    r.id AS role_id,
                    r.name AS role_name,
                    r.created_at AS role_created_at
                FROM users u
                JOIN roles r ON u.role_id = r.id
                `).all();

            if (user.length === 0) {
                // No users found
                return res.status(404).json({ message: 'No users found' });
            } else {
                // show all available users
                return res.status(200).json(user);
            }
        }
        // Failure in Getting all users
        catch(err){
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    })
    .post((req, res) => {
        /*API structure
        curl -X POST http://localhost:5000/users \
        - H "Content-Type: application/json" \
        - d '{
            "username": "rahul",
            "password_hash": "hashedPass", // Encrypted password
            "full_name": "Rahul Singh",
            "role": 1,
            "is_active": 1
        }'
        */
        // Session check
        if(!get_session_user()){
            return res.status(200).json({
                message: 'No Active Session to create User. Kindly Login!'
            })
        }

        if (!is_admin_session()) {
            return res.status(403).json({
                message: 'Only ADMIN users can create other users.'
            });
        }

        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        // Create user
        try{
            // Extract username, password and role_id to match login.
            let {username, password, password_hash, full_name, role_id} = req.body;
            let is_active = 1 // DEFAULT activating new users with is_active = 1

            const rawPassword = normalize_password_value(password ?? password_hash);

            if (!username || !rawPassword || !full_name || !role_id) {
                return res.status(400).json({
                    message: 'username, password, full_name and role_id are required.'
                });
            }

            if (!is_valid_role(role_id)) {
                return res.status(400).json({
                    message: 'User role must be ADMIN (1) or CASHIER (2).'
                });
            }

            if (Number(role_id) === 1) {
                const adminCount = db_instance.prepare(`
                    SELECT COUNT(*) AS total
                    FROM users
                    WHERE role_id = 1 AND is_active = 1
                `).get().total;

                if (adminCount > 0) {
                    return res.status(409).json({
                        message: 'An active ADMIN already exists. Only one admin is allowed.'
                    });
                }
            }

            // Get all users to check among with following role_id and active id.
            let existing_user = db_instance.prepare(`
                SELECT * 
                FROM users u
                WHERE u.username = ?
            `).get(username);
            
            // Duplicate user found. (Or create a search live username api)
            if(existing_user){
                return res.status(409).json({
                    message: 'User with the same username already exists'
                })
            }

            // User found, so update with logged in session
            const hashedPassword = hash_password_value(rawPassword);
            // Create user in DB
            let user = db_instance.prepare(`
                INSERT INTO users (username, password_hash, full_name, role_id, is_active)
                VALUES (?, ?, ?, ?, ?)
            `).run(username, hashedPassword, full_name, role_id, is_active);
            // Created successfully.
            console.log(`User created successfully -_-`)

            return res.status(201).json({
                message: 'User created successfully!',
                user: { username, full_name, role_id, is_active }
            });
        }
        // Login failed with Error
        catch(err){
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    })
    .delete((req, res) => {
        // Session check
        if(!get_session_user()){
            return res.status(200).json({
                message: 'No Active Session to create User. Kindly Login!'
            })
        }

        if (!is_admin_session()) {
            return res.status(403).json({
                message: 'Only ADMIN users can delete other users.'
            });
        }
        // Delete user
        try{
            // Extract username, password and role_id to match login.
            let {username} = req.body;
            let is_active = 0 // DEFAULT 0 for deactivating users with is_active = 0

            //-------------------------> Password Validation Check Missing

            // DB check
            if(!db_instance){
                return res.status(400).json({
                    message: 'Missing Database file !'
                })
            }
            // Get all users to check among with following role_id and active id.
            let existing_user = db_instance.prepare(`
                SELECT * 
                FROM users u
                WHERE u.username = ?
            `).get(username);
            
            // Found User (Or create a search live username api)
            if(existing_user){
                // User active status already inactive 
                if (existing_user.is_active === 0){
                    return res.status(409).json({
                        message: 'User Already Deactive.'
                    })
                }
                // return res.status(409).json({
                //     message: 'User with the same username already exists'
                // })
            }
            // Not an Existent user found
            else if(!existing_user){
                return res.status(409).json({
                    message: 'No existent active user found.'
                })
            }
            
            // User found, so update with logged in session
            // Create user in DB
            let user = db_instance.prepare(`
                UPDATE users
                SET is_active = 0
                WHERE username = ?
            `).run(username);
            // Deleted User successfully.
            console.log(`User deleted successfully -_-`)

            return res.status(201).json({
                message: 'User Deleted successfully!',
                user: { 
                    username, 
                    'is_active': 0
                }
            });
        }
        // Login failed with Error
        catch(err){
            res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });
    
// Updation USERS IS STILL MISSING. OR User details CAN'T be UPDATED

// -----------------------------------------------------------------------------
// CUSTOMER MANAGEMENT
// -----------------------------------------------------------------------------
// Customer records are tracked for sales history and customer lookup.
// During a sale, customer data can be auto-created or updated if it is supplied.
app.route('/customer')
    .get((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to view customers.' });
        }

        try {
            // Shows all Customers data
            const customers = db_instance.prepare(`
                SELECT *
                FROM customers
                ORDER BY id DESC
            `).all();

            return res.status(200).json({ success: true, customers: customers || [] });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    })
    .patch((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to access customer records.' });
        }

        return res.status(405).json({
            success: false,
            message: 'Customer data is not updatable from /customer. Customer details are created and updated while recording a sale.'
        });
    })
    .delete((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to delete customer.' });
        }

        try {
            const { id } = req.body;
            if (!id) {
                return res.status(400).json({ success: false, message: 'Customer id is required.' });
            }

            const result = db_instance.prepare(`DELETE FROM customers WHERE id = ?`).run(Number(id));
            if (result.changes === 0) {
                return res.status(404).json({ success: false, message: 'Customer not found.' });
            }

            return res.status(200).json({ success: true, message: 'Customer deleted successfully.' });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    });


// Manage suppliers (2)
app.route('/supplier')
    .get((req, res) => {
        // Session check
        if(!global.session){
            // No session available ...
            return res.status(401).json({message: 'Inactive Session! Please login to see Supplier Details'})
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        try{
            let suppliers = null;
            // Getting all suppliers from database
            suppliers = db_instance.prepare(`
                SELECT * 
                FROM suppliers
            `).all();
            // // let result = suppliers;
            // res.status(200).json(suppliers);

            if (suppliers.length === 0) {
                // No users found
                return res.status(404).json({ message: 'No Suppliers Found !' });
            } 
            else {
                // show all available users
                return res.status(200).json(suppliers);
            }
        }
        // Failure in Getting all Suppliers
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    })
    .post((req, res) => {
        /* API structure
        curl -X POST http://localhost:5000/supplier \
        - H "Content-Type: application/json" \
        - d '{
            "name": "rahul",
            "phone": "7507855915", 
            "gstin": "UPGHIJR8593K5Z0",
            "address": "full adress, any format",
        }'
        */
        // Session check
        if(!global.session){
            // No session available ...
            return res.status(401).json({message: 'Inactive Session! Please login to see Supplier Details'})
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        let {name, phone, gstin, address} = req.body;
        
        // Empty Body check
        if(!(name && phone && gstin)){
            return res.status(400).json({
                message: 'Parameters Missing !'
            }) 
        }

        // Handling with unknown address
        address = address || null;
        try{

            // ---------------> Check for Existing Supplier once before creating a duplicate

            let createSupplier = db_instance.prepare(`
                INSERT INTO suppliers (name, phone, gstin, address)
                VALUES (?, ?, ?, ?)
            `).run(name, phone, gstin, address);

            console.log(`Supplier created successfully -_-`);
            add_activity_log({
                user_id: get_session_user() ? get_session_user().id : null,
                action: 'CREATE_SUPPLIER',
                entity_type: 'supplier',
                entity_id: null,
                details: `Supplier ${name} added`
            });
            add_notification({
                user_id: get_session_user() ? get_session_user().id : null,
                title: 'Supplier created',
                message: `Supplier ${name} has been added.`,
                type: 'INFO'
            });

            return res.status(200).json({
                success: true,
                message: 'Supplier created successfully.'
            });
        }
        // Failed with Error
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    })
    .patch((req, res) => {
        // Update the Supplier Details
        // Session check
        if(!global.session){
            // No session available ...
            return res.status(401).json({message: 'Inactive Session! Please login to see Supplier Details'})
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        let {name, phone, gstin, address} = req.body;
        
        // Empty Body check
        // if(!(name && phone && gstin)){
        //     return res.status(400).json({
        //         message: 'Parameters Missing !'
        //     }) 
        // }
        // Collect fields to update
        const updates = [];
        const values = [];

        // Checks presence of update params
        if (phone !== undefined) {
            updates.push("phone = ?");
            values.push(phone);
        }
        if (gstin !== undefined) {
            updates.push("gstin = ?");
            values.push(gstin);
        }
        if (address !== undefined) {
            updates.push("address = ?");
            values.push(address);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No fields provided to update"
            });
        }

        // Add the WHERE clause
        values.push(name);

        try {
            const stmt = db_instance.prepare(`
                UPDATE suppliers
                SET ${updates.join(", ")}
                WHERE name = ?
            `);

            const result = stmt.run(...values);

            if (result.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Supplier not found"
                });
            }

            return res.status(200).json({
                success: true,
                message: `Supplier "${name}" updated successfully -_-`
            });
        // Failed with Error
        } catch (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
    })
    .delete((req, res) => {
        // Session check
        if(!global.session){
            // No session available ...
            return res.status(401).json({
                message: 'Inactive Session! Please login to see Supplier Details'
            })
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        // try Deleting Supplier

        try {

            let {name} = req.body;

            let deletion = db_instance.prepare(`
                DELETE
                FROM suppliers s
                WHERE s.name = ?
            `).run(name);
            
            // more than 0 rows are deleted (but our name is unique so only 1)
            if(deletion.changes > 0){
                console.log(`User: ${name}, Deleted Successfully`);
                return res.status(200).json({
                    success: true,
                    message: 'Supplier Deleted Successfully.',
                    user: `${name}`
                });
            }

            return res.status(404).json({
                success: false,
                message: `Supplier not Found !`
            });
        
        } 
        // Failed with Error
        catch (err) {
            res.status(500).json({
                success: false,
                error: err.message
            });
        }
    });


// Managing medicine categories (3)
app.route('/medicine_Catg')
    .get((req,res) => {
        // Session check
        if(!get_session_user()){
            return res.status(401).json({
                message: 'Inactive Session! Please login to see medicine categories'
            });
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            });
        }

        try{
            let medCatg = db_instance.prepare(`
                SELECT *
                FROM categories
                ORDER BY id
            `).all();
            if(medCatg.length > 0){
                console.log(`Medicine Category found -_-`);
                return res.status(200).json({
                    message: 'Medicine Category found !',
                    categories: medCatg
                }); 
            }
            return res.status(404).json({
                message: 'No Medicine Category found !'
            });
        }
        catch (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }
    })
    .post((req, res) => {
        // Session check
        if(!get_session_user()){
            return res.status(401).json({message: 'Inactive Session! Please login to add a medicine category'})
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }
        
        try{
            // Adding medicine category
            let {name, description} = req.body;

            if (!name || !String(name).trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Category name is required.'
                });
            }

            const existingCategory = db_instance.prepare(`
                SELECT id FROM categories WHERE lower(name) = lower(?)
            `).get(String(name).trim());

            if (existingCategory) {
                return res.status(409).json({
                    success: false,
                    message: 'Medicine category already exists.'
                });
            }

            db_instance.prepare(`
                INSERT INTO categories (name, description)
                VALUES (?, ?)
            `).run(String(name).trim(), description || null);

            return res.status(200).json({
                success: true,
                message: 'Medicine category created successfully. -_-'
            });
        }
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            })
        }
    })
    .delete((req, res) => {
        // Delete medicine category
        if(!get_session_user()){
            return res.status(401).json({message: 'Inactive Session! Please login to see medicine categories'})
        }
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        try{
            let {id} = req.body;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message: 'Category id is required.'
                });
            }

            const deleteCategory = db_instance.prepare(`
                DELETE FROM categories
                WHERE id = ?
            `).run(Number(id));

            if (deleteCategory.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Medicine category not found.'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Medicine category deleted successfully.'
            });
        }
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            })
        }
    });


// Managing medicine (4)
app.route('/medicine')
    .get((req, res) => {
        //Session check
        if(!get_session_user()){
            return res.status(401).json({
                message: 'Inactive Session! Please login to see medicine details'
            });
        }
        // DB check
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            });
        }

        try{
            let medicines = db_instance.prepare(`
                SELECT *
                FROM medicines
                ORDER BY id
            `).all();

            if(medicines.length !== 0){
                console.log(`Medicines: ${medicines}`)
                return res.status(200).json(medicines);
            }
            
            return res.status(404).json({
                message: 'No Medicine Found !'
            });
        }
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            })
        }
    })
    .post((req, res) => {
        if(!get_session_user()){
            return res.status(401).json({message: 'Inactive Session! Please login to add medicine'})
        }

        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            });
        }

        try{
            let {name, company, category_id, hsn_code, rack_number, gst_percent, min_stock_alert} = req.body;

            if (!name || !company || !category_id || !hsn_code || !gst_percent) {
                return res.status(400).json({
                    success: false,
                    message: 'name, company, category_id, hsn_code and gst_percent are required.'
                });
            }

            const categoryExists = db_instance.prepare(`
                SELECT id FROM categories WHERE id = ?
            `).get(Number(category_id));

            if (!categoryExists) {
                return res.status(404).json({
                    success: false,
                    message: 'Medicine category not found.'
                });
            }

            db_instance.prepare(`
                INSERT INTO medicines (name, company, category_id, hsn_code, rack_number, gst_percent, min_stock_alert)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(name, company, Number(category_id), hsn_code, rack_number || null, Number(gst_percent), Number(min_stock_alert || 10));

            return res.status(200).json({
                success: true,
                message: 'Medicine created successfully.'
            });
        }
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    })
    .delete((req, res) => {
        if(!get_session_user()){
            return res.status(401).json({message: 'Inactive Session! Please login to delete medicine'})
        }
        if(!db_instance){
            return res.status(400).json({
                message: 'Missing Database file !'
            })
        }

        try{
            let {id} = req.body;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message: 'Medicine id is required.'
                });
            }

            const deleteMedicine = db_instance.prepare(`
                DELETE FROM medicines
                WHERE id = ?
            `).run(Number(id));

            if (deleteMedicine.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Medicine not found.'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Medicine deleted successfully.'
            });
        }
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            })
        }
    });


// -----------------------------------------------------------------------------
// BATCH / PURCHASE ENTRY
// -----------------------------------------------------------------------------
// Medicine batches are the actual stock records. A purchase item points to one
// batch, so the batch must exist before purchase_items can be inserted.
app.route('/buy_Med_Supply')
    .post((req, res) => {
        if(!get_session_user()){
            return res.status(401).json({message: 'Inactive Session! Please login to add medicine batch'})
        }

        try{
            // Buy a medicine
            let {medicine_id, batch_number, expiry_date, purchase_price, selling_price, mrp, current_stock} = req.body;

            if (!medicine_id || !batch_number || !expiry_date || !purchase_price || !selling_price || !mrp) {
                return res.status(400).json({
                    success: false,
                    message: 'medicine_id, batch_number, expiry_date, purchase_price, selling_price and mrp are required.'
                });
            }

            db_instance.prepare(`
                INSERT INTO medicine_batches (medicine_id, batch_number, expiry_date, purchase_price, selling_price, mrp, current_stock)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(Number(medicine_id), String(batch_number), expiry_date, Number(purchase_price), Number(selling_price), Number(mrp), Number(current_stock || 0));

            console.log(`${medicine_id} created successfully.`);

            return res.status(200).json({
                success: true,
                message: 'Medicine batch created successfully.'
            });
        }
        catch(err){
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });


// Purchase Med (6)
app.route('/buy')
    .get((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to view purchase records.' });
        }

        try {
            const { invoice_number } = req.query;
            let sql = `
                SELECT p.*, s.name AS supplier_name
                FROM purchases p
                LEFT JOIN suppliers s ON s.id = p.supplier_id
            `;
            const params = [];

            if (invoice_number) {
                sql += ` WHERE p.invoice_number = ?`;
                params.push(String(invoice_number));
            }

            sql += ` ORDER BY p.id DESC`;
            const purchases = db_instance.prepare(sql).all(...params);

            return res.status(200).json({
                success: true,
                purchases
            });
        }
        catch (err) {
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    })
    .post((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to create a purchase.' });
        }

        try {
            const payload = req.body;
            const items = Array.isArray(payload.items) ? payload.items : [];

            if (!payload.supplier_id || !payload.invoice_number || !payload.invoice_date || items.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'supplier_id, invoice_number, invoice_date and items are required.'
                });
            }

            const result = db_instance.transaction(() => {
                const supplierExists = db_instance.prepare(`SELECT id FROM suppliers WHERE id = ?`).get(Number(payload.supplier_id));
                if (!supplierExists) {
                    throw new Error('Supplier not found.');
                }

                const existingPurchase = db_instance.prepare(`SELECT id FROM purchases WHERE invoice_number = ?`).get(String(payload.invoice_number));
                if (existingPurchase) {
                    throw new Error('Purchase invoice already exists.');
                }

                const normalizedItems = items.map((item) => {
                    const medicineInput = item.medicine_name ?? item.medicine ?? item.name ?? item.medicine_id;
                    const medicineId = resolve_medicine_id(medicineInput);
                    const quantity = Number(item.quantity);
                    const purchasePrice = Number(item.purchase_price || 0);
                    const sellingPrice = Number(item.selling_price || 0);
                    const mrp = Number(item.mrp || sellingPrice || purchasePrice);
                    const gstPercent = Number(item.gst_percent || 0);
                    const itemAmount = Number((quantity * purchasePrice).toFixed(2));

                    if (!medicineId || !quantity || !purchasePrice) {
                        throw new Error('Each purchase item requires medicine name or medicine_id, quantity and purchase_price.');
                    }

                    return {
                        medicineId,
                        quantity,
                        purchasePrice,
                        sellingPrice,
                        mrp,
                        gstPercent,
                        itemAmount
                    };
                });

                const itemSubtotal = normalizedItems.reduce((sum, item) => sum + item.itemAmount, 0);
                const gstFromItems = normalizedItems.reduce((sum, item) => {
                    const gstValue = (item.itemAmount * item.gstPercent) / 100;
                    return Number((sum + gstValue).toFixed(2));
                }, 0);
                const totalFromItems = Number((itemSubtotal + gstFromItems).toFixed(2));

                if (payload.total_amount !== undefined && Number(payload.total_amount) !== totalFromItems) {
                    throw new Error(`Purchase total mismatch. Expected ${totalFromItems} based on items.`);
                }

                if (payload.gst_amount !== undefined && Number(payload.gst_amount) !== gstFromItems) {
                    throw new Error(`GST mismatch. Expected ${gstFromItems} based on items.`);
                }

                const purchaseResult = db_instance.prepare(`
                    INSERT INTO purchases (supplier_id, invoice_number, invoice_date, total_amount, gst_amount)
                    VALUES (?, ?, ?, ?, ?)
                `).run(Number(payload.supplier_id), String(payload.invoice_number), payload.invoice_date, totalFromItems, gstFromItems);

                const purchaseId = purchaseResult.lastInsertRowid;

                normalizedItems.forEach((item, index) => {
                    const currentItem = items[index];
                    const batchNumber = String(currentItem.batch_number || `${item.medicineId}-${Date.now()}`);
                    const expiryDate = currentItem.expiry_date || '2099-12-31';
                    const sellingPrice = Number(currentItem.selling_price || item.sellingPrice || item.purchasePrice);
                    const existingBatch = db_instance.prepare(`
                        SELECT * FROM medicine_batches WHERE medicine_id = ? AND batch_number = ?
                    `).get(item.medicineId, batchNumber);

                    let batchId;
                    if (existingBatch) {
                        batchId = existingBatch.id;
                        db_instance.prepare(`
                            UPDATE medicine_batches
                            SET purchase_price = ?, selling_price = ?, mrp = ?, expiry_date = ?, current_stock = current_stock + ?
                            WHERE id = ?
                        `).run(item.purchasePrice, sellingPrice, item.mrp, expiryDate, item.quantity, batchId);
                    } else {
                        const batchInsert = db_instance.prepare(`
                            INSERT INTO medicine_batches (medicine_id, batch_number, expiry_date, purchase_price, selling_price, mrp, current_stock)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `).run(item.medicineId, batchNumber, expiryDate, item.purchasePrice, sellingPrice, item.mrp, item.quantity);
                        batchId = batchInsert.lastInsertRowid;
                    }

                    db_instance.prepare(`
                        INSERT INTO purchase_items (purchase_id, batch_id, quantity, purchase_price, gst_percent, amount)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(purchaseId, batchId, item.quantity, item.purchasePrice, item.gstPercent, item.itemAmount);

                    db_instance.prepare(`
                        INSERT INTO stock_movements (batch_id, type, quantity_change, reference_id)
                        VALUES (?, 'PURCHASE', ?, ?)
                    `).run(batchId, item.quantity, purchaseId);
                });

                const paymentMode = ['CASH', 'UPI', 'CARD'].includes(String(payload.payment_mode || 'CASH').toUpperCase())
                    ? String(payload.payment_mode || 'CASH').toUpperCase()
                    : 'CASH';

                db_instance.prepare(`
                    INSERT INTO payments (supplier_id, purchase_id, amount, payment_mode, payment_date)
                    VALUES (?, ?, ?, ?, datetime('now'))
                `).run(Number(payload.supplier_id), purchaseId, totalFromItems, paymentMode);

                return {
                    purchaseId,
                    invoice_number: String(payload.invoice_number),
                    total_amount: totalFromItems,
                    gst_amount: gstFromItems,
                    item_count: items.length
                };
            })();

            add_activity_log({
                user_id: get_session_user() ? get_session_user().id : null,
                action: 'CREATE_PURCHASE',
                entity_type: 'purchase',
                entity_id: result.purchaseId,
                details: `Purchase ${String(payload.invoice_number)} recorded for supplier ${String(payload.supplier_id)}`
            });
            add_notification({
                user_id: get_session_user() ? get_session_user().id : null,
                title: 'Purchase recorded',
                message: `Purchase invoice ${String(payload.invoice_number)} was recorded successfully.`,
                type: 'INFO'
            });

            return res.status(200).json({
                success: true,
                message: 'Purchase recorded successfully.',
                purchase: result
            });
        }
        catch (err) {
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });

// -----------------------------------------------------------------------------
// SALES FLOW
// -----------------------------------------------------------------------------
// A sale first validates each medicine batch, checks stock, then inserts the sale
// and sale_items rows. Stock is automatically reduced by the database trigger.
app.route('/sell')
    .get((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to view sales records.' });
        }

        try {
            const sales = db_instance.prepare(`
                SELECT s.*, u.username AS cashier_name
                FROM sales s
                LEFT JOIN users u ON u.id = s.user_id
                ORDER BY s.id DESC
            `).all();

            return res.status(200).json({
                success: true,
                sales
            });
        }
        catch (err) {
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    })
    .post((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to create a sale.' });
        }

        try {
            const payload = req.body;
            const items = Array.isArray(payload.items) ? payload.items : [];

            if (!payload.invoice_number || !payload.payment_mode || items.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'invoice_number, payment_mode and items are required.'
                });
            }

            const result = db_instance.transaction(() => {
                const customerId = ensure_customer_for_sale(payload);

                const normalizedItems = items.flatMap((item) => {
                    const batchId = Number(item.batch_id);
                    const quantity = Number(item.quantity);
                    const unitPrice = Number(item.unit_price || 0);
                    const gstPercent = Number(item.gst_percent || 0);

                    if (batchId) {
                        const batch = db_instance.prepare(`SELECT * FROM medicine_batches WHERE id = ?`).get(batchId);
                        if (!batch) {
                            throw new Error(`Batch ${batchId} not found.`);
                        }
                        if (batch.current_stock < quantity) {
                            throw new Error(`Insufficient stock for batch ${batchId}. Available: ${batch.current_stock}.`);
                        }

                        return [{
                            batchId,
                            quantity,
                            unitPrice: unitPrice || Number(batch.selling_price || batch.mrp || 0),
                            gstPercent,
                            mrp: Number(item.mrp || batch.mrp || unitPrice || batch.selling_price || 0),
                            itemTotal: Number(((unitPrice || Number(batch.selling_price || batch.mrp || 0)) * quantity).toFixed(2))
                        }];
                    }

                    if (!quantity) {
                        throw new Error('Each sale item requires quantity.');
                    }

                    if (!batchId && !item.medicine_name && !item.medicine && !item.name && !item.medicine_id) {
                        throw new Error('Each sale item requires a medicine name or batch_id.');
                    }

                    const allocations = resolve_sale_batch_allocations(item, quantity);
                    return allocations.map((allocation) => ({
                        batchId: allocation.batchId,
                        quantity: allocation.quantity,
                        unitPrice: allocation.unitPrice,
                        gstPercent: allocation.gstPercent,
                        mrp: allocation.mrp,
                        itemTotal: allocation.itemTotal
                    }));
                });

                const subtotal = normalizedItems.reduce((sum, item) => sum + item.itemTotal, 0);
                const saleTax = normalizedItems.reduce((sum, item) => {
                    const gstValue = (item.itemTotal * item.gstPercent) / 100;
                    return Number((sum + gstValue).toFixed(2));
                }, 0);
                const discountValue = Number(payload.discount || 0);
                const cgstValue = Number(payload.cgst || 0);
                const sgstValue = Number(payload.sgst || 0);
                const roundOffValue = Number(payload.round_off || 0);
                const grandTotal = Number((subtotal + saleTax + cgstValue + sgstValue + roundOffValue - discountValue).toFixed(2));

                const saleInsert = db_instance.prepare(`
                    INSERT INTO sales (invoice_number, customer_id, user_id, subtotal, discount, cgst, sgst, round_off, grand_total, payment_mode)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    String(payload.invoice_number),
                    customerId,
                    get_session_user().id,
                    Number(subtotal.toFixed(2)),
                    discountValue,
                    cgstValue,
                    sgstValue,
                    roundOffValue,
                    grandTotal,
                    String(payload.payment_mode)
                );

                const saleId = saleInsert.lastInsertRowid;

                normalizedItems.forEach((item) => {
                    db_instance.prepare(`
                        INSERT INTO sale_items (sale_id, batch_id, quantity, unit_price, mrp, gst_percent, total_amount)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        saleId,
                        item.batchId,
                        item.quantity,
                        item.unitPrice,
                        item.mrp,
                        item.gstPercent,
                        item.itemTotal
                    );
                });

                return {
                    saleId,
                    subtotal: Number(subtotal.toFixed(2)),
                    discount: discountValue,
                    cgst: cgstValue,
                    sgst: sgstValue,
                    round_off: roundOffValue,
                    grand_total: grandTotal,
                    payment_mode: payload.payment_mode
                };
            })();

            add_activity_log({
                user_id: get_session_user() ? get_session_user().id : null,
                action: 'CREATE_SALE',
                entity_type: 'sale',
                entity_id: result.saleId,
                details: `Sale ${String(payload.invoice_number)} recorded with amount ${result.grand_total}`
            });
            add_notification({
                user_id: get_session_user() ? get_session_user().id : null,
                title: 'Sale recorded',
                message: `Sale invoice ${String(payload.invoice_number)} was recorded successfully.`,
                type: 'INFO'
            });

            return res.status(200).json({
                success: true,
                message: 'Sale recorded successfully.',
                sale: result
            });
        }
        catch (err) {
            return res.status(400).json({
                success: false,
                error: err.message
            });
        }
    });


// -----------------------------------------------------------------------------
// PURCHASE / SALE RETURN FLOW
// -----------------------------------------------------------------------------
// Returns reverse stock movement and create return ledger records.
app.route('/purchase_return')
    .get((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to view purchase returns.' });
        }

        try {
            const returns = db_instance.prepare(`
                SELECT pr.*, p.invoice_number, s.name AS supplier_name
                FROM purchase_returns pr
                LEFT JOIN purchases p ON p.id = pr.purchase_id
                LEFT JOIN suppliers s ON s.id = p.supplier_id
                ORDER BY pr.id DESC
            `).all();

            return res.status(200).json({ success: true, purchase_returns: returns });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    })
    .post((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to record purchase return.' });
        }

        try {
            const payload = req.body;
            const items = Array.isArray(payload.items) ? payload.items : [];
            const purchaseId = Number(payload.purchase_id || payload.id);

            if (!purchaseId || items.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'purchase_id and items are required.'
                });
            }

            const result = db_instance.transaction(() => {
                const purchaseExists = db_instance.prepare(`SELECT * FROM purchases WHERE id = ?`).get(purchaseId);
                if (!purchaseExists) {
                    throw new Error('Purchase record not found.');
                }

                const normalizedItems = items.map((item) => {
                    const batchId = Number(item.batch_id);
                    const quantity = Number(item.quantity);
                    if (!batchId || !quantity) {
                        throw new Error('Each return item requires batch_id and quantity.');
                    }

                    const purchaseItem = db_instance.prepare(`
                        SELECT * FROM purchase_items WHERE purchase_id = ? AND batch_id = ?
                    `).get(purchaseId, batchId);

                    if (!purchaseItem) {
                        throw new Error(`Batch ${batchId} was not part of purchase #${purchaseId}.`);
                    }

                    if (purchaseItem.quantity < quantity) {
                        throw new Error(`Return quantity exceeds purchased quantity for batch ${batchId}.`);
                    }

                    const batch = db_instance.prepare(`SELECT * FROM medicine_batches WHERE id = ?`).get(batchId);
                    if (!batch) {
                        throw new Error(`Batch ${batchId} not found.`);
                    }

                    return {
                        batchId,
                        quantity,
                        refundAmount: Number((quantity * Number(purchaseItem.purchase_price || 0)).toFixed(2))
                    };
                });

                const totalRefund = normalizedItems.reduce((sum, item) => sum + item.refundAmount, 0);
                const returnInsert = db_instance.prepare(`
                    INSERT INTO purchase_returns (purchase_id, return_date, total_refund_amount)
                    VALUES (?, datetime('now'), ?)
                `).run(purchaseId, Number(totalRefund.toFixed(2)));

                const returnId = returnInsert.lastInsertRowid;
                normalizedItems.forEach((item) => {
                    db_instance.prepare(`
                        INSERT INTO purchase_return_items (purchase_return_id, batch_id, quantity, refund_amount)
                        VALUES (?, ?, ?, ?)
                    `).run(returnId, item.batchId, item.quantity, item.refundAmount);

                    db_instance.prepare(`
                        UPDATE medicine_batches
                        SET current_stock = current_stock - ?
                        WHERE id = ?
                    `).run(item.quantity, item.batchId);

                    db_instance.prepare(`
                        INSERT INTO stock_movements (batch_id, type, quantity_change, reference_id)
                        VALUES (?, 'PURCHASE_RETURN', ?, ?)
                    `).run(item.batchId, -item.quantity, returnId);
                });

                return {
                    purchase_return_id: returnId,
                    purchase_id: purchaseId,
                    total_refund_amount: Number(totalRefund.toFixed(2)),
                    transaction_type: 'PURCHASE_RETURN',
                    type: 'PURCHASE_RETURN'
                };
            })();

            add_activity_log({
                user_id: get_session_user() ? get_session_user().id : null,
                action: 'PURCHASE_RETURN',
                entity_type: 'purchase_return',
                entity_id: result.purchase_return_id,
                details: `Purchase return for purchase #${purchaseId}`
            });

            return res.status(200).json({
                success: true,
                message: 'Purchase return recorded successfully.',
                return: result
            });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    });


app.route('/sale_return')
    .get((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to view sale returns.' });
        }

        try {
            const returns = db_instance.prepare(`
                SELECT sr.*, s.invoice_number, c.name AS customer_name
                FROM sales_returns sr
                LEFT JOIN sales s ON s.id = sr.sale_id
                LEFT JOIN customers c ON c.id = s.customer_id
                ORDER BY sr.id DESC
            `).all();

            return res.status(200).json({ success: true, sale_returns: returns });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    })
    .post((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to record sale return.' });
        }

        try {
            const payload = req.body;
            const items = Array.isArray(payload.items) ? payload.items : [];
            const saleId = Number(payload.sale_id || payload.id);

            if (!saleId || items.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'sale_id and items are required.'
                });
            }

            const result = db_instance.transaction(() => {
                const saleExists = db_instance.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId);
                if (!saleExists) {
                    throw new Error('Sale record not found.');
                }

                const normalizedItems = items.map((item) => {
                    const batchId = Number(item.batch_id);
                    const quantity = Number(item.quantity);
                    if (!batchId || !quantity) {
                        throw new Error('Each return item requires batch_id and quantity.');
                    }

                    const saleItem = db_instance.prepare(`
                        SELECT * FROM sale_items WHERE sale_id = ? AND batch_id = ?
                    `).get(saleId, batchId);

                    if (!saleItem) {
                        throw new Error(`Batch ${batchId} was not part of sale #${saleId}.`);
                    }

                    if (saleItem.quantity < quantity) {
                        throw new Error(`Return quantity exceeds sold quantity for batch ${batchId}.`);
                    }

                    return {
                        batchId,
                        quantity,
                        refundAmount: Number((quantity * Number(saleItem.unit_price || 0)).toFixed(2))
                    };
                });

                const totalRefund = normalizedItems.reduce((sum, item) => sum + item.refundAmount, 0);
                const returnInsert = db_instance.prepare(`
                    INSERT INTO sales_returns (sale_id, user_id, total_refund_amount)
                    VALUES (?, ?, ?)
                `).run(saleId, get_session_user().id, Number(totalRefund.toFixed(2)));

                const returnId = returnInsert.lastInsertRowid;
                normalizedItems.forEach((item) => {
                    db_instance.prepare(`
                        INSERT INTO sales_return_items (sales_return_id, batch_id, quantity, refund_amount)
                        VALUES (?, ?, ?, ?)
                    `).run(returnId, item.batchId, item.quantity, item.refundAmount);

                    db_instance.prepare(`
                        UPDATE medicine_batches
                        SET current_stock = current_stock + ?
                        WHERE id = ?
                    `).run(item.quantity, item.batchId);

                    db_instance.prepare(`
                        INSERT INTO stock_movements (batch_id, type, quantity_change, reference_id)
                        VALUES (?, 'SALE_RETURN', ?, ?)
                    `).run(item.batchId, item.quantity, returnId);
                });

                return {
                    sales_return_id: returnId,
                    sale_id: saleId,
                    total_refund_amount: Number(totalRefund.toFixed(2)),
                    transaction_type: 'SALE_RETURN',
                    type: 'SALE_RETURN'
                };
            })();

            add_activity_log({
                user_id: get_session_user() ? get_session_user().id : null,
                action: 'SALE_RETURN',
                entity_type: 'sale_return',
                entity_id: result.sales_return_id,
                details: `Sale return for sale #${saleId}`
            });

            return res.status(200).json({
                success: true,
                message: 'Sale return recorded successfully.',
                return: result
            });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    });


// Stock status
app.get('/stock', (req, res) => {
    if (!get_session_user()) {
        return res.status(401).json({ message: 'Inactive Session! Please login to view stock.' });
    }

    try {
        const stock = db_instance.prepare(`
            SELECT mb.id,
                   mb.medicine_id,
                   m.name AS medicine_name,
                   mb.batch_number,
                   mb.expiry_date,
                   mb.purchase_price,
                   mb.selling_price,
                   mb.mrp,
                   mb.current_stock,
                   c.name AS category_name
            FROM medicine_batches mb
            JOIN medicines m ON m.id = mb.medicine_id
            LEFT JOIN categories c ON c.id = m.category_id
            ORDER BY mb.medicine_id, mb.expiry_date
        `).all();

        return res.status(200).json({ success: true, stock });
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

// Notification endpoint: returns the alerts generated for a user after actions such
// as login, purchase, sale, or stock updates.
app.route('/notifications')
    .get((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to view notifications.' });
        }

        try {
            const sessionUser = get_session_user();
            const targetUserId = req.query.user_id ? Number(req.query.user_id) : sessionUser.id;
            const isAdmin = Number(sessionUser.role_id) === 1;
            const rows = isAdmin && !req.query.user_id
                ? db_instance.prepare(`
                    SELECT *
                    FROM notifications
                    ORDER BY created_at DESC
                  `).all()
                : db_instance.prepare(`
                    SELECT *
                    FROM notifications
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                  `).all(targetUserId);

            return res.status(200).json({ success: true, notifications: rows });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    })
    .post((req, res) => {
        if (!get_session_user()) {
            return res.status(401).json({ message: 'Inactive Session! Please login to send notifications.' });
        }

        try {
            const { user_id, title, message, type } = req.body;
            if (!title || !message) {
                return res.status(400).json({ success: false, message: 'title and message are required.' });
            }

            const targetUserId = user_id ? Number(user_id) : get_session_user().id;
            const result = add_notification({ user_id: targetUserId, title, message, type: type || 'INFO' });

            return res.status(201).json({
                success: true,
                message: 'Notification created successfully.',
                notification: result ? { id: result.lastInsertRowid } : null
            });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    });

// -----------------------------------------------------------------------------
// ACTIVITY LOGS & TRACKING
// -----------------------------------------------------------------------------
// These endpoints expose internal audit records and business analytics such as
// sales by month, total revenue, recent activity, and supplier summaries.
app.get('/activity', (req, res) => {
    if (!get_session_user()) {
        return res.status(401).json({ message: 'Inactive Session! Please login to view activity logs.' });
    }

    try {
        const logs = db_instance.prepare(`
            SELECT al.*, u.username, u.full_name
            FROM activity_logs al
            LEFT JOIN users u ON u.id = al.user_id
            ORDER BY al.created_at DESC
            LIMIT 50
        `).all();

        return res.status(200).json({ success: true, activity: logs });
    }
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

app.get('/tracking', (req, res) => {
    if (!get_session_user()) {
        return res.status(401).json({ message: 'Inactive Session! Please login to view tracking details.' });
    }

    try {
        const archiveMonth = req.query.archive_month || req.query.archiveMonth || req.query.month || null;
        if (archiveMonth) {
            const archiveSearch = search_archived_tracking({ month: archiveMonth, query: req.query.query || req.query.keyword || req.query.search || '' });
            if (archiveSearch.archives.length > 0) {
                return res.status(200).json({
                    success: true,
                    source: 'archive',
                    archive_month: archiveMonth,
                    tracking: archiveSearch.tracking
                });
            }
            return res.status(404).json({
                success: false,
                message: `No archived tracking data found for ${archiveMonth}.`
            });
        }

        const monthlySales = db_instance.prepare(`
            SELECT strftime('%Y-%m', created_at) AS month,
                   ROUND(COALESCE(SUM(grand_total), 0), 2) AS total_sales,
                   COUNT(*) AS sales_count
            FROM sales
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month DESC
            LIMIT 12
        `).all();

        const topSupplier = db_instance.prepare(`
            SELECT s.name,
                   ROUND(COALESCE(SUM(p.total_amount), 0), 2) AS total_purchase
            FROM purchases p
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            GROUP BY s.id, s.name
            ORDER BY total_purchase DESC
            LIMIT 5
        `).all();

        const transactionSummary = db_instance.prepare(`
            SELECT 'SALE' AS transaction_type, 'SALE' AS type, COUNT(*) AS count, ROUND(COALESCE(SUM(grand_total), 0), 2) AS total
            FROM sales
            UNION ALL
            SELECT 'PURCHASE' AS transaction_type, 'PURCHASE' AS type, COUNT(*) AS count, ROUND(COALESCE(SUM(total_amount), 0), 2) AS total
            FROM purchases
            UNION ALL
            SELECT 'SALE_RETURN' AS transaction_type, 'SALE_RETURN' AS type, COUNT(*) AS count, ROUND(COALESCE(SUM(total_refund_amount), 0), 2) AS total
            FROM sales_returns
            UNION ALL
            SELECT 'PURCHASE_RETURN' AS transaction_type, 'PURCHASE_RETURN' AS type, COUNT(*) AS count, ROUND(COALESCE(SUM(total_refund_amount), 0), 2) AS total
            FROM purchase_returns
        `).all();

        const recentActivity = db_instance.prepare(`
            SELECT al.*, u.username, u.full_name
            FROM activity_logs al
            LEFT JOIN users u ON u.id = al.user_id
            ORDER BY al.created_at DESC
            LIMIT 20
        `).all();

        return res.status(200).json({
            success: true,
            source: 'live',
            tracking: {
                monthly_sales: monthlySales,
                top_supplier: topSupplier,
                transactions: transactionSummary,
                recent_activity: recentActivity
            }
        });
    }
    // Catch Error
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});

app.get('/invoice', (req, res) => {
    if (!get_session_user()) {
        return res.status(401).json({ message: 'Inactive Session! Please login to view invoice details.' });
    }

    try {
        // For searching specific Invoice
        const { invoice_number } = req.query;

        if (invoice_number) {
            // Only Queried Sale or Purchase Invoice
            const saleRecord = db_instance.prepare(`
                SELECT s.*, c.name AS customer_name, u.username AS cashier_name
                FROM sales s
                LEFT JOIN customers c ON c.id = s.customer_id
                LEFT JOIN users u ON u.id = s.user_id
                WHERE s.invoice_number = ?
            `).get(String(invoice_number));

            const purchaseRecord = db_instance.prepare(`
                SELECT p.*, s.name AS supplier_name
                FROM purchases p
                LEFT JOIN suppliers s ON s.id = p.supplier_id
                WHERE p.invoice_number = ?
            `).get(String(invoice_number));

            return res.status(200).json({
                success: true,
                invoice: {
                    sale: saleRecord || null,
                    purchase: purchaseRecord || null
                }
            });
        }
        else{
            // All Sales and purchases invoices
            const invoices = {
                sales: db_instance.prepare(`
                    SELECT s.id, s.invoice_number, s.grand_total, s.created_at, c.name AS customer_name, u.username AS cashier_name
                    FROM sales s
                    LEFT JOIN customers c ON c.id = s.customer_id
                    LEFT JOIN users u ON u.id = s.user_id
                    ORDER BY s.id DESC
                `).all(),
                purchases: db_instance.prepare(`
                    SELECT p.id, p.invoice_number, p.total_amount, p.created_at, s.name AS supplier_name
                    FROM purchases p
                    LEFT JOIN suppliers s ON s.id = p.supplier_id
                    ORDER BY p.id DESC
                `).all()
            };

            return res.status(200).json({ success: true, invoices });
        }
    }
    // Catch Error
    catch (err) {
        return res.status(400).json({ success: false, error: err.message });
    }
});



// Search by (For Quick search while typing)
app.get('/search_by', (req, res) => {
    if (!get_session_user()) {
        return res.status(401).json({ message: 'Inactive Session! Please login to Search.' });
    }

    try {
        const { table, col, value, operator = '=' } = req.query;

        const VALID_TABLES = {
            users: ['id', 'username', 'full_name', 'role_id', 'is_active', 'created_at'],
            customers: ['id', 'name', 'phone', 'address', 'created_at'],
            medicines: ['id', 'name', 'company', 'category_id', 'hsn_code', 'rack_number', 'gst_percent', 'min_stock_alert', 'created_at'],
            suppliers: ['id', 'name', 'phone', 'gstin', 'address', 'created_at'],
            purchases: ['id', 'supplier_id', 'invoice_number', 'invoice_date', 'total_amount', 'gst_amount', 'created_at'],
            medicine_batches: ['id', 'medicine_id', 'batch_number', 'expiry_date', 'purchase_price', 'selling_price', 'mrp', 'current_stock', 'created_at'],
            categories: ['id', 'name', 'description'],
            sales: ['id', 'invoice_number', 'customer_id', 'user_id', 'subtotal', 'discount', 'cgst', 'sgst', 'round_off', 'grand_total', 'payment_mode', 'created_at'],
            stock_movements: ['id', 'batch_id', 'type', 'quantity_change', 'reference_id', 'created_at']
        };

        if (!table || !col || !VALID_TABLES[table]) {
            return res.status(400).json({ success: false, error: 'Invalid table or column.' });
        }

        if (!VALID_TABLES[table].includes(String(col))) {
            return res.status(400).json({ success: false, error: 'Invalid column for the selected table.' });
        }

        const allowedOperators = ['=', 'LIKE', '>', '<', '>=', '<='];
        const normalizedOperator = String(operator).trim().toUpperCase();
        if (!allowedOperators.includes(normalizedOperator)) {
            return res.status(400).json({ success: false, error: 'Unsupported operator.' });
        }

        const sql = `SELECT ${String(col)} FROM ${String(table)} WHERE ${String(col)} ${normalizedOperator} ?`;
        const queryValue = value !== undefined ? String(value) : '';
        const result = db_instance.prepare(sql).all(normalizedOperator === 'LIKE' ? `%${queryValue}%` : queryValue);

        return res.status(200).json({ success: true, results: result });
    }
    catch (err) {
        return res.status(400).json({
            success: false,
            error: err.message
        });
    }
});
    

// Manage Purchase -- Also review the procedure for making a purchase.
// app.route()


let httpServer = null;

httpServer = app.listen(PORT, ()=>{
    maybe_archive_monthly_data();
    console.log(`Server started on port: ${PORT}`);
    console.log(`Click here to redirect at http://localhost:${PORT}`);
});