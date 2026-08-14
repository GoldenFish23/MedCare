const express = require('express');
const dotenv = require('dotenv');
const { db } = require('./db');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        database: db ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Authentication middleware
const authenticate = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    // In a real implementation, validate the token against a JWT or session
    // For now, we'll just allow access for demo purposes
    next();
};

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        // In a real implementation, validate the username/password against the database
        // For now, we'll accept any valid username
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        // Check if user exists
        const user = await db.prepare("SELECT * FROM users WHERE username = ?").get(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Verify password (in production, hash comparison would be used)
        if (user.password_hash !== 'admin123') {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        res.status(200).json({
            success: true,
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                role: user.role_id
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Graceful shutdown handler
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    try {
        await db.close();
        console.log('Database connection closed');
        process.exit(0);
    } catch (err) {
        console.error('Error closing database:', err);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    try {
        await db.close();
        console.log('Database connection closed');
        process.exit(0);
    } catch (err) {
        console.error('Error closing database:', err);
        process.exit(1);
    }
});

// Basic routes
app.get('/', (req, res) => {
    res.json({ 
        message: 'Medical Store API', 
        version: '1.0.0',
        endpoints: [
            '/api/health',
            '/api/auth/login'
        ]
    });
});

app.get('/api/users', (req, res) => {
    const users = await db.prepare("SELECT id, username, role_id FROM users").all();
    res.json({ users });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`Login endpoint: POST http://localhost:${PORT}/api/auth/login`);
});