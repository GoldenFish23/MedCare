const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const db_i = require('./db/db');
const keya = require('./key');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
// const { log } = require('console');

// Fixed Constants
const PORT = process.env.PORT || 5000;
const DB_PATH = path.join(__dirname, '../../data_test/medical_store.db');
// const df = path.join('/workspaces/MediCal','/data_test/medical_store.db');
const file_path = path.join(process.cwd(), 'passcode.txt');

// Variables
let db_instance = null;
let lock_status = null;

// Checks and Initalization of DB and Passcode file for Step 1 
function db_existence() {
    // console.log(__dirname);
    // console.log(df);
    // console.log(fs.existsSync(df));
    // console.log(DB_PATH);
    // console.log(fs.existsSync(DB_PATH));
    if (fs.existsSync(DB_PATH)){
        // Database already intialized
        db_instance = Database(DB_PATH);
        console.log(`DB exists`);
    }
    else{
        // Creates fresh sqlite db
        db_instance = db_i.initDb();
        if(db_instance){
            console.log(`Created New DB ${db_instance}`);
        }
        // Generates only at time of initialization
        const key = keya.gen_rand_key();
        // let db = 
        db_instance.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('activation_key', key);
        db_instance.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('lock_status', 'LOCKED');
        console.log(`Generated key: ${key}`);
        // .prepare
    }
    console.log(db_instance ? 'DB connected' : 'DB disconnected');
};

db_existence();






const app = express();
app.use(express.json());

// const PORT = process.env.PORT || 5000;

// Connection checks
app.get('/api/status', (req, res) => {
    // console.log(`Hi`);
    res.status(200).json({
        database: db ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    })
});

// Check admin details via api
app.route('/user')
    .get((req, res) => {
        let user = null;
        // Checks if db module is connected and not dbinstance  ---> Potential Bug
        if(db_instance){
            // Query to process admin information
            user = db_instance.prepare(`
                SELECT 
                    u.id as user_id, 
                    u.username, 
                    u.password_hash, 
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
            // if(user.length === ){

            // }
            let result = user;
            res.status(200).json(result);
        }
        else{
            res.status(400).json({message: 'Error in computing users from DB'})
        }
    })
    .post((req, res) => {
        /* API structure
        curl -X POST http://localhost:5000/users \
        - H "Content-Type: application/json" \
        - d '{
            "username": "rahul",
            "password_hash": "hashedPass",
            "full_name": "Rahul Singh",
            "role": "CASHIER",
            "is_active": 1
        }'
        */

        let adminExistence = null;
        // Checks db existence
        if(db_instance){
            // Admin existence query
            adminExistence = db_instance.prepare(`
                SELECT * FROM users u
                JOIN roles r ON u.role_id = r.id
                WHERE r.name = 'ADMIN'
                `).get();
            let userBodyRole = req.body['role'];
            let role_id = null;


            if(userBodyRole === 'CASHIER'){
                role_id = 2;
            }
            else if(userBodyRole === 'ADMIN'){
                role_id = 1;
            }
            else{
                res.status(400).json({message: 'Invalid Role mentioned'});
            }
            // console.log(`existence: ${adminExistence}`);

            // If no Admin and wants to create cashier reject
            if(!adminExistence && userBodyRole === 'CASHIER'){
                res.status(401).json({message : 'Create admin first'});
            }
            else{
                let {username, password_hash, full_name, role, is_active} = req.body;
                try{
                    let createUser = db_instance.prepare(`
                        INSERT INTO users (username, password_hash, full_name, role_id, is_active)
                        VALUES (?, ?, ?, ?, ?)
                        `).run(username, password_hash, full_name, role_id, is_active ?? 1);
                    res.status(200).json({
                        success: true,
                        message: 'User created successfully'});
                }
                catch(err){
                    res.status(400).json({
                        success: false,
                        error: err.message
                    });
                }
                // DOES NOT TRACKS CREATED BY WHICH ADMIN --> (LATER TO BE UPDATED)
            }
        }
    });



app.listen(PORT, ()=>{
    console.log(`Server started on port: ${PORT}`);
    console.log(`Click here to redirect at http://localhost:${PORT}`);
});