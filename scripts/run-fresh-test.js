#!/usr/bin/env node

const { initDb } = require('../src/backend/db');
const fs = require('fs');
const path = require('path');

console.log('=== Fresh Test Runner ===');

// Step 1: Deletion Step - Remove existing test data directory
const testDataDir = path.join(__dirname, '..', 'data_test');
if (fs.existsSync(testDataDir)) {
    console.log('Removing existing test data directory...');
    fs.rmSync(testDataDir, { recursive: true, force: true });
    console.log('Test data directory removed.');
}

// Step 2: Setup Step - Create fresh test directory
console.log('Creating fresh test data directory...');
const testDataDir = path.join(__dirname, '..', 'data_test');
fs.mkdirSync(testDataDir, { recursive: true });
console.log('Fresh test data directory created.');

// Step 3: Bootup Step - Initialize database and start server
console.log('Initializing database...');
initDb(testDataDir)
    .then(() => {
        console.log('Database initialized successfully.');
        
        // Start the server in the background
        const serverPort = process.env.PORT || 3000;
        const server = require('../src/backend/server.js');
        
        // Wait a moment for the server to start
        setTimeout(() => {
            console.log('Starting server on port ' + serverPort + '...');
            server.listen(serverPort, () => {
                console.log('Server started on port ' + serverPort);
                console.log('Test run completed successfully.');
            });
        }, 1000);
    })
    .catch((error) => {
        console.error('Failed to initialize database or start server:', error);
        process.exit(1);
    });
