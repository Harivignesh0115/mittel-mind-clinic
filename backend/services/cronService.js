const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const mongoose = require('mongoose');
const { sendSmsReminder } = require('./smsService');

const startCronJobs = () => {
  // Run every 5 minutes to auto-update expired appointments
  cron.schedule('*/5 * * * *', async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return;
      }
      const now = new Date();
      
      // Find all booked appointments where appointment time has passed
      const result = await Appointment.updateMany(
        {
          status: 'booked',
          appointmentDateTime: { $lt: now }
        },
        {
          $set: {
            status: 'not_visited',
            updatedAt: now
          }
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`⏰ [CRON] Auto-updated ${result.modifiedCount} appointment(s) to "not_visited" at ${now.toISOString()}`);
      }
    } catch (error) {
      console.error('❌ [CRON] Error updating appointment statuses:', error.message);
    }
  });

  console.log('✅ Cron job started: Auto-updating missed appointments every 5 minutes');

  // Run every minute to send SMS reminders 3 hours before appointment
  cron.schedule('* * * * *', async () => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return;
      }

      const now = new Date();
      const targetStart = new Date(now.getTime() + (3 * 60 * 60 * 1000));
      const targetEnd = new Date(targetStart.getTime() + (5 * 60 * 1000));

      const upcoming = await Appointment.find({
        status: { $in: ['booked', 'confirmed'] },
        reminderSentAt: { $in: [null, undefined] },
        appointmentDateTime: { $gte: targetStart, $lt: targetEnd }
      });

      for (const appt of upcoming) {
        const result = await sendSmsReminder(appt);
        if (result.success) {
          appt.reminderSentAt = now;
          await appt.save();
          console.log(`📲 [CRON] SMS reminder sent for appointment ${appt._id}`);
        } else {
          console.warn(`⚠️  [CRON] SMS reminder failed for ${appt._id}: ${result.message}`);
        }
      }
    } catch (error) {
      console.error('❌ [CRON] Error sending SMS reminders:', error.message);
    }
  });

  console.log('✅ Cron job started: SMS reminders every minute (3 hours before appointment)');
};

module.exports = { startCronJobs };
