require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const appointmentRoutes = require('./routes/appointments');
const { startCronJobs } = require('./services/cronService');

const app = express();
const PORT = process.env.PORT || 5000;

// Avoid long buffering waits when DB is down
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for serving frontend
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5500',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token'],
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────
// Block API calls when DB is disconnected (except health check)
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      message: 'Database is not connected. Please try again shortly.'
    });
  }
  return next();
});

app.use('/api/auth', authRoutes);
app.use('/api', appointmentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Mittel Mind Clinic API is running',
    timestamp: new Date().toISOString(),
    mongoStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Serve main website
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Serve admin dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dashboard/index.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dashboard/index.html'));
});

// Serve reception dashboard
app.get('/reception', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/reception/index.html'));
});

app.get('/reception/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/reception/index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─────────────────────────────────────────────
// MONGODB CONNECTION + START SERVER
// ─────────────────────────────────────────────
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB Atlas connected successfully');
    console.log(`📦 Database: ${mongoose.connection.db.databaseName}`);
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.log('⚠️  Running without database connection (some features unavailable)');
  }
};

const startServer = async () => {
  await connectDB();
  
  // Start cron jobs
  startCronJobs();
  
  app.listen(PORT, () => {
    console.log('\n🏥 ════════════════════════════════════════');
    console.log('   MITTEL MIND CLINIC - Backend Server');
    console.log('════════════════════════════════════════');
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌐 Frontend:  http://localhost:${PORT}`);
    console.log(`⚕️  Dashboard: http://localhost:${PORT}/admin`);
    console.log(`📡 API Base:  http://localhost:${PORT}/api`);
    console.log('════════════════════════════════════════\n');
  });
};

startServer();

module.exports = app;
