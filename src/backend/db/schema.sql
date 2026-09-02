PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- 1. USERS & ROLES
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL CHECK (name IN ('ADMIN', 'CASHIER')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role_id INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles (id)
);

-- Seed Default Roles
INSERT OR IGNORE INTO roles (id, name) VALUES (1, 'ADMIN'), (2, 'CASHIER');

-- 2. CATEGORIES & MEDICINES
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    hsn_code TEXT NOT NULL,
    gst_percent REAL NOT NULL CHECK (gst_percent >= 0),
    rack_number TEXT,
    min_stock_alert INTEGER DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT
);

-- 3. SUPPLIERS & CUSTOMERS
CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    gstin TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. BATCH-WISE INVENTORY
CREATE TABLE IF NOT EXISTS medicine_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL,
    batch_number TEXT NOT NULL,
    expiry_date DATE NOT NULL,
    purchase_price REAL NOT NULL CHECK (purchase_price >= 0),
    selling_price REAL NOT NULL CHECK (selling_price >= 0),
    mrp REAL NOT NULL CHECK (mrp >= 0),
    current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (medicine_id) REFERENCES medicines (id),
    UNIQUE (medicine_id, batch_number)
);

-- 5. PURCHASES & PURCHASE ITEMS
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    invoice_number TEXT NOT NULL,
    invoice_date DATE NOT NULL,
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    gst_amount REAL NOT NULL CHECK (gst_amount >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    purchase_price REAL NOT NULL,
    gst_percent REAL NOT NULL,
    amount REAL NOT NULL,
    FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES medicine_batches (id)
);

-- 6. PURCHASE RETURNS
CREATE TABLE IF NOT EXISTS purchase_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    return_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_refund_amount REAL NOT NULL CHECK (total_refund_amount >= 0),
    FOREIGN KEY (purchase_id) REFERENCES purchases (id)
);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_return_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    refund_amount REAL NOT NULL,
    FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns (id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES medicine_batches (id)
);

-- 7. SALES & SALE ITEMS
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    user_id INTEGER NOT NULL,
    subtotal REAL NOT NULL,
    discount REAL DEFAULT 0,
    cgst REAL NOT NULL DEFAULT 0,
    sgst REAL NOT NULL DEFAULT 0,
    round_off REAL DEFAULT 0,
    grand_total REAL NOT NULL,
    payment_mode TEXT CHECK (payment_mode IN ('CASH', 'UPI', 'CARD', 'CREDIT')) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL,
    mrp REAL NOT NULL,
    gst_percent REAL NOT NULL,
    total_amount REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES medicine_batches (id)
);

-- 8. SALES RETURNS
CREATE TABLE IF NOT EXISTS sales_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    total_refund_amount REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS sales_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sales_return_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    refund_amount REAL NOT NULL,
    FOREIGN KEY (sales_return_id) REFERENCES sales_returns (id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES medicine_batches (id)
);

-- 9. AUDIT TRAIL: STOCK MOVEMENTS
CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    type TEXT CHECK (type IN ('PURCHASE', 'SALE', 'PURCHASE_RETURN', 'SALE_RETURN', 'ADJUSTMENT')) NOT NULL,
    quantity_change INTEGER NOT NULL,
    reference_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES medicine_batches (id)
);

-- 10. PAYMENTS (Credit / Udhaar Ledger)
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    supplier_id INTEGER,
    sale_id INTEGER,
    purchase_id INTEGER,
    amount REAL NOT NULL,
    payment_mode TEXT CHECK (payment_mode IN ('CASH', 'UPI', 'CARD')) NOT NULL,
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers (id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
    FOREIGN KEY (sale_id) REFERENCES sales (id),
    FOREIGN KEY (purchase_id) REFERENCES purchases (id)
);

-- 11. SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ========================================================
-- INDEXES (FOR INSTANT SEARCH & REPORTING SPEED)
-- ========================================================
CREATE INDEX IF NOT EXISTS idx_medicines_name ON medicines(name);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON medicine_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_stock ON medicine_batches(current_stock);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_number);
CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON stock_movements(batch_id);

-- ========================================================
-- TRIGGERS (AUTOMATIC STOCK REDUCTION & MOVEMENTS AUDIT)
-- ========================================================

-- Trigger: Automatically deduct stock and log stock_movement when a sale occurs
CREATE TRIGGER IF NOT EXISTS trg_after_sale_item_insert
AFTER INSERT ON sale_items
BEGIN
    -- Deduct stock from the batch
    UPDATE medicine_batches 
    SET current_stock = current_stock - NEW.quantity 
    WHERE id = NEW.batch_id;

    -- Insert audit log entry
    INSERT INTO stock_movements (batch_id, type, quantity_change, reference_id)
    VALUES (NEW.batch_id, 'SALE', -NEW.quantity, NEW.sale_id);
END;
