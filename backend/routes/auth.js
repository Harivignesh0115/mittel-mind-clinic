const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const Admin = require('../models/Admin');
const { authenticateAdmin, authenticateReception } = require('../middleware/auth');

// Rate limiter for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 attempts per window
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.'
      });
    }

    // Find admin by email
    let admin = await Admin.findOne({ email: email.toLowerCase().trim() });

    // If no admin exists yet, create default admin
    if (!admin) {
      const defaultEmail = process.env.ADMIN_EMAIL || 'admin@mittelmind.com';
      const defaultPassword = process.env.ADMIN_PASSWORD || 'MittelAdmin@2024';
      
      if (email.toLowerCase().trim() === defaultEmail) {
        admin = await Admin.create({
          email: defaultEmail,
          password: defaultPassword,
          name: 'Dr.E.Lloyds'
        });
        console.log('✅ Default admin account created');
      } else {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials.'
        });
      }
    }

    // Verify password
    const isPasswordValid = await admin.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate JWT
    const token = jwt.sign(
      { 
        id: admin._id, 
        email: admin.email, 
        name: admin.name,
        role: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      admin: {
        name: admin.name,
        email: admin.email,
        lastLogin: admin.lastLogin,
        role: 'admin'
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authentication.'
    });
  }
});

// POST /api/auth/reception-login
router.post('/reception-login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.'
      });
    }

    const allowedEmail = process.env.RECEPTION_EMAIL || 'reception@mittelmind.com';
    const allowedPassword = process.env.RECEPTION_PASSWORD || 'Reception@2024';

    if (email.toLowerCase().trim() !== allowedEmail.toLowerCase().trim() || password !== allowedPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials.'
      });
    }

    const token = jwt.sign(
      { 
        id: 'reception',
        email: allowedEmail,
        name: 'Reception',
        role: 'reception'
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      reception: { name: 'Reception', email: allowedEmail, role: 'reception' }
    });
  } catch (error) {
    console.error('Reception login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authentication.'
    });
  }
});

// GET /api/auth/verify - Verify token validity
router.get('/verify', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    admin: req.user
  });
});

// GET /api/auth/reception-verify - Verify reception token validity
router.get('/reception-verify', authenticateReception, (req, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    reception: req.user
  });
});

// POST /api/auth/logout
router.post('/logout', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;
