const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Patient name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    match: [/^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/, 'Please enter a valid phone number']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  date: {
    type: String,
    required: [true, 'Appointment date is required']
  },
  time: {
    type: String,
    required: [true, 'Appointment time is required']
  },
  concern: {
    type: String,
    trim: true,
    maxlength: [500, 'Concern cannot exceed 500 characters'],
    default: 'General consultation'
  },
  status: {
    type: String,
    enum: ['booked', 'confirmed', 'viewed', 'not_visited'],
    default: 'booked'
  },
  appointmentDateTime: {
    type: Date,
    required: true
  },
  reminderSentAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries
appointmentSchema.index({ status: 1, appointmentDateTime: 1 });
appointmentSchema.index({ reminderSentAt: 1, appointmentDateTime: 1 });
appointmentSchema.index({ email: 1 });
appointmentSchema.index({ phone: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
