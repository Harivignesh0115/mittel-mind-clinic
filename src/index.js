import { MongoClient } from 'mongodb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

// Environment variables
let MONGODB_URI = process.env.MONGODB_URI || '';
let JWT_SECRET = process.env.JWT_SECRET || '';
let MONGODB_USER = process.env.MONGODB_USER || '';
let MONGODB_PASSWORD = process.env.MONGODB_PASSWORD || '';
let MONGODB_HOST = process.env.MONGODB_HOST || '';
let MONGODB_REPLICA_SET = process.env.MONGODB_REPLICA_SET || '';
let MONGODB_DB = process.env.MONGODB_DB || 'mittel_mind_clinic';

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };
}

function getMongoUri() {
  if (MONGODB_URI) return MONGODB_URI;
  if (MONGODB_USER && MONGODB_PASSWORD && MONGODB_HOST) {
    if (MONGODB_HOST.includes(',')) {
      const replicaSetParam = MONGODB_REPLICA_SET ? `&replicaSet=${encodeURIComponent(MONGODB_REPLICA_SET)}` : '';
      return `mongodb://${encodeURIComponent(MONGODB_USER)}:${encodeURIComponent(MONGODB_PASSWORD)}@${MONGODB_HOST}/${MONGODB_DB}?retryWrites=true&w=majority&authSource=admin${replicaSetParam}&tls=true`;
    }
    return `mongodb+srv://${encodeURIComponent(MONGODB_USER)}:${encodeURIComponent(MONGODB_PASSWORD)}@${MONGODB_HOST}/${MONGODB_DB}?retryWrites=true&w=majority&authSource=admin`;
  }
  return '';
}

// MongoDB connection
let mongoClient = null;

function isMongoConnected(client) {
  if (!client) return false;
  // Node MongoDB driver exposes topology state information.
  const topology = client.topology;
  if (!topology) return false;
  return topology.isConnected?.() || topology.s?.state === 'connected';
}

async function getMongoClient() {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MongoDB URI is not configured. Set MONGODB_URI or MONGODB_USER/MONGODB_PASSWORD/MONGODB_HOST.');
  }

  if (mongoClient && isMongoConnected(mongoClient)) {
    return mongoClient;
  }

  if (mongoClient) {
    try {
      await mongoClient.close();
    } catch (closeError) {
      console.error('Error closing stale MongoDB client:', closeError);
    }
    mongoClient = null;
  }

  mongoClient = new MongoClient(uri);
  try {
    await mongoClient.connect();
  } catch (connectError) {
    console.error('MongoDB connection error:', connectError);
    mongoClient = null;
    throw connectError;
  }

  return mongoClient;
}

// Helper functions
function createResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers
    }
  });
}

function authenticateToken(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  try {
    const token = authHeader.substring(7);
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function parseTimeTo24Hour(timeString) {
  const normalized = timeString.trim().toUpperCase();
  const timeRegex = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/;
  const match = normalized.match(timeRegex);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3];

  if (period) {
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function parseAppointmentDateTime(dateString, timeString) {
  const time24 = parseTimeTo24Hour(timeString || '18:00');
  const candidate = `${dateString}T${time24 || '18:00'}:00`;
  const dateTime = new Date(candidate);
  return Number.isNaN(dateTime.getTime()) ? new Date(`${dateString}T18:00:00`) : dateTime;
}

// Email service
async function sendAppointmentConfirmation(appointmentData) {
  try {
    const transporter = nodemailer.createTransport(getSmtpConfig());

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: appointmentData.email,
      subject: 'Appointment Confirmation - Mittel Mind Clinic',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0ea5e9;">Appointment Confirmed!</h2>
          <p>Dear ${appointmentData.name},</p>
          <p>Your appointment at Mittel Mind Clinic has been successfully booked.</p>
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Appointment Details:</h3>
            <p><strong>Name:</strong> ${appointmentData.name}</p>
            <p><strong>Phone:</strong> ${appointmentData.phone}</p>
            <p><strong>Email:</strong> ${appointmentData.email}</p>
            <p><strong>Date:</strong> ${appointmentData.date}</p>
            <p><strong>Time:</strong> ${appointmentData.time}</p>
          </div>
          <p>Please arrive 10 minutes early for your appointment.</p>
          <p>For any changes, please call us at +91 8110835188.</p>
          <p>Best regards,<br>Mittel Mind Clinic Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, message: error.message };
  }
}

// API Routes
async function handleAuthLogin(request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return createResponse({ success: false, message: 'Email and password are required.' }, 400);
    }

    const client = await getMongoClient();
    const db = client.db('mittelMindClinic');
    const admins = db.collection('admins');

    let admin = await admins.findOne({ email: email.toLowerCase().trim() });

    // Create default admin if none exists
    if (!admin) {
      if (email.toLowerCase().trim() === process.env.ADMIN_EMAIL) {
        const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        admin = {
          email: process.env.ADMIN_EMAIL,
          password: hashedPassword,
          name: 'Dr.E.Lloyds',
          createdAt: new Date()
        };
        await admins.insertOne(admin);
      } else {
        return createResponse({ success: false, message: 'Invalid credentials.' }, 401);
      }
    }

    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      return createResponse({ success: false, message: 'Invalid credentials.' }, 401);
    }

    const token = jwt.sign(
      { id: admin._id, email: admin.email, name: admin.name, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return createResponse({
      success: true,
      message: 'Login successful',
      token,
      admin: { name: admin.name, email: admin.email, role: 'admin' }
    });

  } catch (error) {
    console.error('Login error:', error);
    return createResponse({ success: false, message: 'Server error during authentication.' }, 500);
  }
}

async function handleAuthReceptionLogin(request) {
  try {
    const { email, password } = await request.json();

    if (email !== process.env.RECEPTION_EMAIL || password !== process.env.RECEPTION_PASSWORD) {
      return createResponse({ success: false, message: 'Invalid credentials.' }, 401);
    }

    const token = jwt.sign(
      { id: 'reception', email: process.env.RECEPTION_EMAIL, name: 'Reception', role: 'reception' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return createResponse({
      success: true,
      message: 'Login successful',
      token,
      reception: { name: 'Reception', email: process.env.RECEPTION_EMAIL, role: 'reception' }
    });

  } catch (error) {
    return createResponse({ success: false, message: 'Server error during authentication.' }, 500);
  }
}

async function handleBookAppointment(request) {
  try {
    const { name, phone, email, date, time } = await request.json();

    if (!name || !phone || !email || !date || !time) {
      return createResponse({ success: false, message: 'Name, phone, email, date, and time are required.' }, 400);
    }

    const client = await getMongoClient();
    const db = client.db('mittelMindClinic');
    const appointments = db.collection('appointments');

    // Create appointment
    const appointmentDateTime = parseAppointmentDateTime(date, time);
    const appointment = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      date,
      time,
      status: 'booked',
      appointmentDateTime,
      createdAt: new Date()
    };

    const result = await appointments.insertOne(appointment);

    // Send confirmation email
    const emailResult = await sendAppointmentConfirmation(appointment);

    return createResponse({
      success: true,
      message: 'Appointment booked successfully!',
      emailSent: emailResult.success,
      appointment: {
        id: result.insertedId,
        name: appointment.name,
        date: appointment.date,
        time: appointment.time,
        status: appointment.status
      }
    }, 201);

  } catch (error) {
    console.error('Booking error:', error);
    return createResponse({
      success: false,
      message: 'Server error while booking appointment.',
      error: error.message
    }, 500);
  }
}

async function handleGetAppointments(request, user) {
  try {
    const client = await getMongoClient();
    const db = client.db('mittelMindClinic');
    const appointments = db.collection('appointments');

    const filter = { status: { $in: ['booked', 'confirmed'] } };
    const appointmentList = await appointments.find(filter).sort({ appointmentDateTime: 1 }).toArray();

    return createResponse({
      success: true,
      count: appointmentList.length,
      appointments: appointmentList
    });

  } catch (error) {
    return createResponse({ success: false, message: 'Error fetching appointments.' }, 500);
  }
}

// Main request handler
export default {
  async fetch(request, env, ctx) {
    // Set environment variables from worker bindings
    MONGODB_URI = env.MONGODB_URI || MONGODB_URI;
    JWT_SECRET = env.JWT_SECRET || JWT_SECRET;
    MONGODB_USER = env.MONGODB_USER || MONGODB_USER;
    MONGODB_PASSWORD = env.MONGODB_PASSWORD || MONGODB_PASSWORD;
    MONGODB_HOST = env.MONGODB_HOST || MONGODB_HOST;
    MONGODB_REPLICA_SET = env.MONGODB_REPLICA_SET || MONGODB_REPLICA_SET;
    MONGODB_DB = env.MONGODB_DB || MONGODB_DB;

    process.env.MONGODB_URI = MONGODB_URI;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ADMIN_EMAIL = env.ADMIN_EMAIL;
    process.env.ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    process.env.RECEPTION_EMAIL = env.RECEPTION_EMAIL;
    process.env.RECEPTION_PASSWORD = env.RECEPTION_PASSWORD;
    process.env.SMTP_HOST = env.SMTP_HOST;
    process.env.SMTP_PORT = env.SMTP_PORT;
    process.env.SMTP_USER = env.SMTP_USER;
    process.env.SMTP_PASS = env.SMTP_PASS;

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return createResponse({ success: true });
    }

    // Root health/info route
    if (path === '/' && method === 'GET') {
      return createResponse({
        success: true,
        message: 'Mittel Mind Clinic Worker is running. Use /api/health to verify the API.',
        api: '/api/health'
      });
    }

    // Health check
    if (path === '/api/health' && method === 'GET') {
      return createResponse({
        success: true,
        message: 'Mittel Mind Clinic API is running',
        timestamp: new Date().toISOString()
      });
    }

    // Debug route to inspect MongoDB host and secret availability
    if (path === '/api/debug' && method === 'GET') {
      const currentMongo = MONGODB_URI || process.env.MONGODB_URI || env.MONGODB_URI || null;
      const mongoHost = currentMongo ? currentMongo.split('@')[1]?.split('/')[0] : null;
      return createResponse({
        success: true,
        currentMongo: currentMongo ? 'set' : 'missing',
        mongoHost: mongoHost || 'unknown',
        hasMongoUser: Boolean(MONGODB_USER),
        hasMongoPassword: Boolean(MONGODB_PASSWORD),
        hasMongoHost: Boolean(MONGODB_HOST),
        mongoDb: MONGODB_DB || 'mittel_mind_clinic'
      });
    }

    // Auth routes
    if (path === '/api/auth/login' && method === 'POST') {
      return await handleAuthLogin(request);
    }

    if (path === '/api/auth/reception-login' && method === 'POST') {
      return await handleAuthReceptionLogin(request);
    }

    // Public appointment route
    if (path === '/api/book-appointment' && method === 'POST') {
      return await handleBookAppointment(request);
    }

    // Protected routes - check authentication
    const user = authenticateToken(request);
    if (!user) {
      return createResponse({ success: false, message: 'Authentication required.' }, 401);
    }

    if (path === '/api/appointments' && method === 'GET') {
      return await handleGetAppointments(request, user);
    }

    // 404
    return createResponse({ success: false, message: 'Route not found' }, 404);
  }
};