const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db/db');
const keya = require('./key');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
// const { log } = require('console');

// Fixed Constants
const PORT = process.env.PORT || 5000;
const DB_PATH = path.join(__dirname, './data_test/medical_store.db');
const df = path.join('/workspaces/MediCal','/data_test/medical_store.db');
const file_path = path.join(process.cwd(), 'passcode.txt');

let db_instance = null;


async function db_existence() {
    // console.log(__dirname);
    // console.log(df);
    // console.log(fs.existsSync(df));
    // console.log(DB_PATH);
    // console.log(fs.existsSync(DB_PATH));
    if (fs.existsSync(df)){
        // Database already intialized
        db_instance = new Database(df);
        console.log(`DB exists`);
    }
    else{
        // Creates fresh sqlite db
        db_instance = db.initDb();
        console.log(`Created New DB`);
        // Generates only at time of initialization
        const key = keya.gen_rand_key();
        // let db = 
        (await db_instance).prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('activation_key', key);
        (await db_instance).prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('lock_status', 'LOCKED');
        console.log(`Generated key: ${key}`);
        // .prepare
    }
    console.log(db_instance ? 'DB connected' : 'DB disconnected');
};

db_existence();




const app = express();
// app.use(express.json());

// const PORT = process.env.PORT || 5000;

// Connection checks
app.get('/api/status', (req, res) => {
    // console.log(`Hi`);
    res.status(200).json({
        database: db ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    })
});

app.listen(PORT, ()=>{
    console.log(`Server started on port: ${PORT}`);
    console.log(`Click here to redirect at http://localhost:${PORT}`);
});