const express = require('express');
const app = express();
const PORT = 5000;

// Middleware to parse JSON body in POST requests
app.use(express.json());

// In-memory list (array)
const items = ['Apple', 'Banana'];

// 1. GET route to see all items
app.get('/items', (req, res) => {
    res.json({ items });
});

// 2. POST route to add a new item
app.post('/items', (req, res) => {
    const item = req.body;
    console.log('Received item:', item); // Log the received item for debugging
    if (!item) {
        return res.status(400).json({ error: 'Item name is required' });
    }

    items.push(item);
    res.status(201).json({ message: 'Item added successfully', items });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});