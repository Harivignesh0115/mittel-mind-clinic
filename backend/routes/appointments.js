const express = require('express');
const router = express.Router();
const Appointment = require('../models/Appointment');
const { authenticateAdmin, authenticateReception, authenticateAny } = require('../middleware/auth');
const { sendAppointmentConfirmation } = require('../services/emailService');

// Helper: parse date and time to Date object
const parseAppointmentDateTime = (date, time) => {
  try {
    const [year, month, day] = date.split('-').map(Number);
    const timeMatch = time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!timeMatch) throw new Error('Invalid time format');
    
    let hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const meridiem = timeMatch[3];

    if (meridiem) {
      if (meridiem.toUpperCase() === 'PM' && hours !== 12) hours += 12;
      if (meridiem.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }

    return new Date(year, month - 1, day, hours, minutes, 0);
  } catch (e) {
    // Try simple parsing as fallback
    return new Date(`${date} ${time}`);
  }
};

// Helper: CSV escaping
const escapeCsv = (val) => {
  const str = (val ?? '').toString();
  const needsQuotes = /[",\n]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
};

// Helper: keep values as text in Excel (avoid scientific notation)
const excelText = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str === '') return '';
  return `="${str.replace(/"/g, '""')}"`;
};

// Helper: build day range from YYYY-MM-DD
const buildDayRange = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, day] = parts;
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { start, end };
};

const applyDateYearFilters = (filter, query) => {
  const { date, year } = query;
  if (date) filter.date = date;
  if (year) {
    const y = parseInt(year, 10);
    if (!Number.isNaN(y)) {
      filter.appointmentDateTime = {
        $gte: new Date(y, 0, 1),
        $lt: new Date(y + 1, 0, 1)
      };
    }
  }
  return filter;
};

const getTodayISO = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ─────────────────────────────────────────────
// PUBLIC ROUTE: POST /api/book-appointment
// ─────────────────────────────────────────────
router.post('/book-appointment', async (req, res) => {
  try {
    const { name, phone, email, date, time, concern } = req.body;

    // Validate required fields
    if (!name || !phone || !email || !date || !time) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, email, date, and time are required.'
      });
    }

    // Parse appointment datetime
    const appointmentDateTime = parseAppointmentDateTime(date, time);
    
    if (isNaN(appointmentDateTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date or time format.'
      });
    }

    // Check if appointment time is in the future
    if (appointmentDateTime <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Appointment date and time must be in the future.'
      });
    }

    // Create appointment
    const appointment = await Appointment.create({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      date,
      time,
      concern: concern?.trim() || 'General consultation',
      status: 'booked',
      appointmentDateTime
    });

    // Send confirmation email
    const emailResult = await sendAppointmentConfirmation({ name, phone, email, date, time, concern });
    if (emailResult && emailResult.success) {
      console.log(`📧 Email sent for appointment ${appointment._id}`);
    } else {
      console.warn(`⚠️ Email not sent for appointment ${appointment._id}: ${emailResult?.message || 'unknown error'}`);
    }

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully!',
      emailSent: Boolean(emailResult && emailResult.success),
      emailMessage: emailResult && emailResult.message ? emailResult.message : 'Email not sent',
      appointment: {
        id: appointment._id,
        name: appointment.name,
        date: appointment.date,
        time: appointment.time,
        status: appointment.status
      }
    });

  } catch (error) {
    console.error('Booking error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(', ') });
    }
    res.status(500).json({ success: false, message: 'Server error while booking appointment.' });
  }
});

// ─────────────────────────────────────────────
// PROTECTED ROUTES (Admin only)
// ─────────────────────────────────────────────

// GET /api/appointments/export - Download filtered appointments as CSV (Excel compatible)
router.get('/appointments/export', authenticateAny, async (req, res) => {
  try {
    const { date, time, year, status } = req.query;
    const filter = {};

    if (date) filter.date = date;
    if (time) filter.time = time;
    if (year) applyDateYearFilters(filter, { year });
    if (status) {
      const statuses = String(status)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (statuses.length > 1) filter.status = { $in: statuses };
      else filter.status = statuses[0];
    }

    const appointments = await Appointment.find(filter).sort({ appointmentDateTime: 1 });

    const header = [
      'Name', 'Phone', 'Email', 'Date', 'Time', 'Concern', 'Status', 'Created At'
    ];

    const rows = appointments.map(a => ([
      a.name,
      excelText(a.phone),
      a.email,
      a.date,
      a.time,
      a.concern || 'General consultation',
      a.status,
      a.createdAt ? new Date(a.createdAt).toISOString() : ''
    ]));

    const csvBody = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
    // Add UTF-8 BOM so Excel shows text correctly
    const csv = '\ufeff' + csvBody;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `appointments-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Error exporting appointments.' });
  }
});

// GET /api/appointments - Get all booked appointments
router.get('/appointments', authenticateAny, async (req, res) => {
  try {
    const filter = {
      $or: [{ status: 'booked' }, { status: { $exists: false } }]
    };

    const dateQuery = req.query.date;
    const allowAll = String(req.query.all || '').toLowerCase() === 'true';
    const timeQuery = req.query.time;
    const yearQuery = req.query.year;

    if (!allowAll) {
      const dateStr = dateQuery || getTodayISO();
      filter.date = dateStr;
    } else if (dateQuery) {
      filter.date = dateQuery;
    }

    if (timeQuery) filter.time = timeQuery;

    if (yearQuery) applyDateYearFilters(filter, { year: yearQuery });

    const appointments = await Appointment.find(filter).sort({ appointmentDateTime: 1 });
    
    res.json({
      success: true,
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching appointments.' });
  }
});

// GET /api/appointments/confirmed - Get confirmed appointments
router.get('/appointments/confirmed', authenticateAny, async (req, res) => {
  try {
    const filter = { status: 'confirmed' };
    const dateQuery = req.query.date;
    const allowAll = String(req.query.all || '').toLowerCase() === 'true';
    if (dateQuery) {
      filter.date = dateQuery;
    } else if (!allowAll) {
      filter.date = getTodayISO();
    }
    applyDateYearFilters(filter, req.query);

    const appointments = await Appointment.find(filter).sort({ appointmentDateTime: 1 });

    res.json({
      success: true,
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching confirmed appointments.' });
  }
});

// GET /api/appointments/all - Get all appointments with status filter
router.get('/appointments/all', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let filter = {};
    if (status) {
      const statuses = String(status)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      filter = statuses.length > 1 ? { status: { $in: statuses } } : { status: statuses[0] };
    }
    
    const appointments = await Appointment.find(filter)
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching appointments.' });
  }
});

// GET /api/appointments/viewed - Get viewed appointments
router.get('/appointments/viewed', authenticateAny, async (req, res) => {
  try {
    const filter = { status: 'viewed' };
    applyDateYearFilters(filter, req.query);
    const appointments = await Appointment.find(filter)
      .sort({ updatedAt: -1 });
    
    res.json({
      success: true,
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching viewed appointments.' });
  }
});

// GET /api/appointments/not-visited - Get missed appointments
router.get('/appointments/not-visited', authenticateReception, async (req, res) => {
  try {
    const filter = { status: 'not_visited' };
    applyDateYearFilters(filter, req.query);
    const appointments = await Appointment.find(filter)
      .sort({ appointmentDateTime: -1 });
    
    res.json({
      success: true,
      count: appointments.length,
      appointments
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching missed appointments.' });
  }
});

// GET /api/appointments/stats - Dashboard statistics
router.get('/appointments/stats', authenticateAdmin, async (req, res) => {
  try {
    const [booked, confirmed, viewed, notVisited, total] = await Promise.all([
      Appointment.countDocuments({ status: 'booked' }),
      Appointment.countDocuments({ status: 'confirmed' }),
      Appointment.countDocuments({ status: 'viewed' }),
      Appointment.countDocuments({ status: 'not_visited' }),
      Appointment.countDocuments()
    ]);

    // Today's appointments
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));
    
    const todayCount = await Appointment.countDocuments({
      appointmentDateTime: { $gte: startOfDay, $lte: endOfDay }
    });

    res.json({
      success: true,
      stats: { booked, confirmed, viewed, notVisited, total, today: todayCount }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching stats.' });
  }
});

// GET /api/appointments/changes - Lightweight change polling
router.get('/appointments/changes', authenticateAny, async (req, res) => {
  try {
    const sinceRaw = req.query.since;
    let sinceDate = null;
    if (sinceRaw) {
      const parsed = new Date(sinceRaw);
      if (!isNaN(parsed.getTime())) sinceDate = parsed;
    }

    const filter = sinceDate ? { updatedAt: { $gt: sinceDate } } : {};

    const [count, latest] = await Promise.all([
      Appointment.countDocuments(filter),
      Appointment.findOne()
        .sort({ updatedAt: -1 })
        .select('name status updatedAt createdAt')
        .lean()
    ]);

    let action = null;
    if (latest && latest.createdAt && latest.updatedAt) {
      const delta = Math.abs(new Date(latest.updatedAt) - new Date(latest.createdAt));
      action = delta < 3000 ? 'created' : 'updated';
    }

    res.json({
      success: true,
      count,
      latestAt: latest && latest.updatedAt ? new Date(latest.updatedAt).toISOString() : null,
      latest: latest ? { name: latest.name, status: latest.status, action } : null,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error checking changes.' });
  }
});

// PUT /api/appointments/:id/confirm - Confirm appointment + send WhatsApp
router.put('/appointments/:id/confirm', authenticateReception, async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status: 'confirmed', updatedAt: new Date() },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    res.json({
      success: true,
      message: 'Appointment confirmed.',
      whatsappPhone: (req.body && req.body.whatsappPhone) ? String(req.body.whatsappPhone) : appointment.phone,
      appointment
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error confirming appointment.' });
  }
});

// PUT /api/appointments/:id/viewed - Mark appointment as viewed
router.put('/appointments/:id/viewed', authenticateReception, async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'viewed',
        updatedAt: new Date(),
        notes: req.body.notes || ''
      },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    res.json({
      success: true,
      message: 'Appointment marked as viewed.',
      appointment
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating appointment.' });
  }
});

// PUT /api/appointments/:id/completed - Admin marks appointment as completed (viewed)
router.put('/appointments/:id/completed', authenticateAdmin, async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { 
        status: 'viewed',
        updatedAt: new Date(),
        notes: req.body && req.body.notes ? String(req.body.notes) : ''
      },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    res.json({
      success: true,
      message: 'Appointment marked as completed.',
      appointment
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating appointment.' });
  }
});

// PUT /api/appointments/:id/not-visited - Manually mark as not visited
router.put('/appointments/:id/not-visited', authenticateReception, async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status: 'not_visited', updatedAt: new Date() },
      { new: true }
    );

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    res.json({ success: true, message: 'Appointment marked as not visited.', appointment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating appointment.' });
  }
});

// DELETE /api/appointments/:id - Delete appointment
router.delete('/appointments/:id', authenticateReception, async (req, res) => {
  try {
    const appointment = await Appointment.findByIdAndDelete(req.params.id);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    res.json({ success: true, message: 'Appointment deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting appointment.' });
  }
});

module.exports = router;
