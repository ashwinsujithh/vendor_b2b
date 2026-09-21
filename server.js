require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok' } }));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api', require('./src/routes/users'));
app.use('/api/subscriptions', require('./src/routes/subscriptions'));
app.use('/api/categories', require('./src/routes/categories'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/clients', require('./src/routes/clients'));
app.use('/api/cart', require('./src/routes/cart'));
app.use('/api/checkout', require('./src/routes/checkout'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/dashboard', require('./src/routes/dashboard'));

// Unknown API route
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

// Global error handler (keeps auth middleware errors uniform)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({ success: false, message: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3002;
app.listen(PORT, () => {
  console.log(`StorePanel running at http://localhost:${PORT}`);
  console.log(`Login page: http://localhost:${PORT}/`);
});
