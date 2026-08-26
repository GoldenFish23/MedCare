const express = require('express');
const app = express();
const PORT = 5000;
const fs = require('fs');
const path = require('path');
// const DB = require('./db/db.js');

// const pass_key = 'K8AK-QQOV-VEP3-EUN1-KQA7';

const users = [];
const pass_path = path.join(__dirname, '../', '../passcode.txt');
const pass = {'code': fs.readFileSync(pass_path, 'utf-8').trim()};

// Middleware to parse JSON body in POST requests
app.use(express.json());

// redirected route for passcode failure
app.get('/locked', (req, res) => {
    console.log(`Received request to /locked ${pass.code}`);

    res.status(200).json({ message: 'Invalid passcode. Try again' });
});


// // passcode validation route
app.post('/', (req, res) => {
    // ----
    // api pass must match the passcode in the passcode.txt file
    // ----
    if(req.headers['pass']=== pass.code){
        console.log(`Valid passcode attempt: ${req.headers['pass']}`);
        res.status(200).json({ message : 'System unlocked successfully' });
    }
    else{
        console.log(`Invalid passcode attempt: ${req.headers['pass']}`);
        // route to /locked if passcode is invalid
        res.redirect('/locked');
    }
});


// GET route to see all users in the dashboard
app.get('/users', (req, res) => {
    res.status(200).json({ users });
});
// POST route to add a new user
app.post('/users', (req, res) => {
    // header check for passcode and auth-type
    if(req.headers['pass'] === pass.code && (req.headers['auth-type'] === 'superuser' || req.headers['auth-type'] === 'admin')){
        // body check
        const user = req.body;
        // api body user and type
        if (user.username && user.type && (user.type === 'cashier' || user.type === 'admin')){
            console.log(`Received request: ${JSON.stringify(user)}`);
            users.push(user);
            console.log(`Updated users list: ${JSON.stringify(users)}`);
            res.status(201).json({ message: 'User added successfully', users });
        }
        else{
            console.log(`Invalid user data: ${JSON.stringify(user)}`);
            res.status(400).json({ error: 'Invalid user data. Username and type are required.' });
        }
    }
    else{
        console.log(`Unauthorized attempt to add user with pass: ${req.headers['pass']} and auth-type: ${req.headers['auth-type']}`);
        res.status(403).json({ error: 'Unauthorized. Invalid passcode or insufficient privileges.' });
    }
});  




// // In-memory list (array)
// const items = ['Apple', 'Banana'];

// // 1. GET route to see all users in the dashboard
// app.get('/users', (req, res) => {
//     res.json({ items });
// });

// // 2. POST route to add a new item
// app.post('/items', (req, res) => {
//     const item = req.body;
//     console.log('Received item:', item); // Log the received item for debugging
//     if (!item) {
//         return res.status(400).json({ error: 'Item name is required' });
//     }

//     items.push(item);
//     console.log('Updated items list:', items); // Log the updated items list for debugging
//     res.status(201).json({ message: 'Item added successfully', items });
// });

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Settings path: ${pass_path}`);
});