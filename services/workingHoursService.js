
const Driver = require('../models/driver/driver');
const Transaction = require('../models/driver/transaction');
const { sendNotificationToDriver } = require('./firebaseService')

// --- SERVICE STATE ---
const activeTimers = new Map();
let io = null; // To hold the socket.io instance

/**
 * ✨ Initialize the service with the socket.io instance
 * @param {object} socketIo - The initialized socket.io instance
 */
exports.init = (socketIo) => { io = socketIo; };
/**
 * ⏱️ Start working hours timer for a driver
 * @param {string} driverId - Driver ID
 */
const startWorkingHoursTimer = async (driverId) => {
  try {
    console.log(`⏱️ Starting working hours timer for driver: ${driverId}`);

    const driver = await Driver.findOne({ driverId });
    if (!driver) {
      console.error(`❌ Driver not found: ${driverId}`);
      return { success: false, message: 'Driver not found' };
    }

    // ✅ CRITICAL FIX: Check if driver is already ONLINE with active timer
    if (driver.status === 'Live' && driver.timerActive && driver.remainingWorkingSeconds > 0) {
      console.log(`⚠️ Driver ${driverId} is already ONLINE with active timer. Resuming existing session.`);

      // Resume the timer if not in memory (e.g., after server restart or driver re-login)
      if (!activeTimers.has(driverId)) {
        const intervalId = setInterval(async () => {
          await updateWorkingHoursTimer(driverId);
        }, 1000);
        activeTimers.set(driverId, intervalId);
        console.log(`✅ Resumed timer for driver ${driverId} (remaining: ${driver.remainingWorkingSeconds}s)`);
      }

      return {
        success: true,
        message: 'Existing session resumed - no wallet deduction',
        totalHours: driver.workingHoursLimit,
        remainingSeconds: driver.remainingWorkingSeconds,
        walletBalance: driver.wallet,
        amountDeducted: 0,
        alreadyOnline: true
      };
    }

    // Check if timer already running in memory
    if (activeTimers.has(driverId)) {
      console.log(`⚠️ Timer already running in memory for driver: ${driverId}`);
      return {
        success: true,
        message: 'Timer already running',
        walletBalance: driver.wallet,
        amountDeducted: 0,
        alreadyOnline: true
      };
    }

    // ✅ NEW: Immediate Wallet Deduction for Shift Start (ONLY if truly starting new session)
    const START_SHIFT_CHARGE = 100;

    if (driver.wallet < START_SHIFT_CHARGE) {
      console.log(`❌ Insufficient wallet balance for driver ${driverId}: ${driver.wallet}`);
      return { 
        success: false, 
        message: `Insufficient wallet balance. Minimum ₹${START_SHIFT_CHARGE} required to go online.` 
      };
    }

    // Deduct from wallet
    driver.wallet -= START_SHIFT_CHARGE;
    
    // Create Transaction Record
    try {
      const transaction = new Transaction({
        driver: driver._id,
        amount: START_SHIFT_CHARGE,
        type: "debit",
        method: "shift_start_fee",
        description: "Online shift start fee (auto-debit)",
        date: new Date()
      });
      await transaction.save();
      console.log(`📝 Transaction created for shift start deduction: -₹${START_SHIFT_CHARGE}`);
    } catch (txError) {
      console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
    }

    console.log(`💰 Deducted ₹${START_SHIFT_CHARGE} from driver ${driverId}. New Balance: ${driver.wallet}`);

    // Calculate total working hours in seconds
    const totalHours = driver.workingHoursLimit + (driver.additionalWorkingHours || 0);
    const totalSeconds = totalHours * 60 * 60; // Convert to seconds

    // Update driver with timer start info
    driver.onlineStartTime = new Date();
    driver.remainingWorkingSeconds = totalSeconds;
    driver.timerActive = true;
    driver.warningsIssued = 0;
    driver.autoStopScheduled = false;
    driver.extendedHoursPurchased = false;
    driver.walletDeducted = false;
    driver.status = "Live";
    await driver.save();

    console.log(`✅ Timer initialized: ${totalHours} hours (${totalSeconds} seconds) for driver ${driverId}`);

    // Start countdown timer (updates every second)
    const intervalId = setInterval(async () => {
      await updateWorkingHoursTimer(driverId);
    }, 1000); // Run every 1 second

    activeTimers.set(driverId, intervalId);

    return {
      success: true,
      message: 'Timer started successfully',
      totalHours,
      remainingSeconds: totalSeconds,
      walletBalance: driver.wallet,
      amountDeducted: START_SHIFT_CHARGE
    };

  } catch (error) {
    console.error(`❌ Error starting timer for driver ${driverId}:`, error);
    return { success: false, message: 'Failed to start timer', error: error.message };
  }
};

/**
 * 🔄 Update timer (decrement remaining time and check for warnings)
 * @param {string} driverId - Driver ID
 */
const updateWorkingHoursTimer = async (driverId) => {
  try {
    const driver = await Driver.findOne({ driverId });
    if (!driver || !driver.timerActive) {
      stopWorkingHoursTimer(driverId);
      return;
    }

    // Decrement remaining seconds
    driver.remainingWorkingSeconds -= 1;

    // Convert remaining seconds to hours for easier comparison
    const remainingHours = driver.remainingWorkingSeconds / 3600;
    const totalHours = driver.workingHoursLimit;

    // Log timer every minute (every 60 calls)
    if (driver.remainingWorkingSeconds % 60 === 0) {
      const hours = Math.floor(driver.remainingWorkingSeconds / 3600);
      const minutes = Math.floor((driver.remainingWorkingSeconds % 3600) / 60);
      const seconds = driver.remainingWorkingSeconds % 60;
      console.log(`⏰ Driver ${driverId} remaining time: ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }

    // ✅ WARNING 1: At 11 hours (when 1 hour remaining)
    if (
      totalHours === 12 &&
      remainingHours <= 1 &&
      remainingHours > 0.5 &&
      driver.warningsIssued === 0
    ) {
      await issueWarning(driver, 1);
    }

    // ✅ WARNING 2: At 11.5 hours (when 30 minutes remaining)
    if (
      totalHours === 12 &&
      remainingHours <= 0.5 &&
      remainingHours > 0.333 &&
      driver.warningsIssued === 1
    ) {
      await issueWarning(driver, 2);
    }

    // ✅ WARNING 3: At 11:50 hours (when 10 minutes remaining)
    if (
      totalHours === 12 &&
      remainingHours <= 0.167 &&
      remainingHours > 0 &&
      driver.warningsIssued === 2
    ) {
      await issueWarning(driver, 3);
    }

    // ✅ AUTO-STOP: When time reaches 0
    if (driver.remainingWorkingSeconds <= 0) {
      await autoStopDriver(driver);
      return;
    }

    // Save updated remaining time
    await driver.save();

  } catch (error) {
    console.error(`❌ Error updating timer for driver ${driverId}:`, error);
  }
};

/**
 * ⚠️ Issue warning notification to driver
 * @param {Object} driver - Driver document
 * @param {Number} warningNumber - 1, 2, or 3
 */
const issueWarning = async (driver, warningNumber) => {
  try {
    console.log(`⚠️ WARNING ${warningNumber} for driver: ${driver.driverId}`);

    driver.warningsIssued = warningNumber;
    driver.lastWarningTime = new Date();
    await driver.save();

    const remainingHours = Math.floor(driver.remainingWorkingSeconds / 3600);
    const remainingMinutes = Math.floor((driver.remainingWorkingSeconds % 3600) / 60);

    let warningMessage = '';
    if (warningNumber === 1) {
      warningMessage = `⚠️ Your online ride time has reached 11 hours.\nAuto-stop at 12 hours.\nTime remaining: ${remainingHours}h ${remainingMinutes}m\n\nDo you want to continue for an extra 12 hours (₹100)?`;
    } else if (warningNumber === 2) {
      warningMessage = `⚠️ WARNING: Only ${remainingMinutes} minutes remaining!\nAuto-stop approaching at 12 hours.\n\nContinue for extra 12 hours (₹100)?`;
    } else if (warningNumber === 3) {
      warningMessage = `🚨 FINAL WARNING: ${remainingMinutes} minutes left!\nYou will be automatically set OFFLINE soon.\n\nLast chance: Continue for extra 12 hours (₹100)?`;
    }

    // Send FCM notification
    if (driver.fcmToken) {
      await sendNotificationToDriver(
        driver.fcmToken,
        `⚠️ Working Hours Warning ${warningNumber}/3`,
        warningMessage,
        {
          type: 'working_hours_warning',
          warningNumber: warningNumber.toString(),
          remainingSeconds: driver.remainingWorkingSeconds.toString(),
          driverId: driver.driverId,
          sound: 'notification_old.mp3',
          priority: 'high',
          click_action: 'WORKING_HOURS_WARNING'
        }
      );
      console.log(`📱 Warning ${warningNumber} notification sent to driver ${driver.driverId}`);
    }

    // Emit socket event if socket.io is available
    if (io) {
      io.to(`driver_${driver.driverId}`).emit('workingHoursWarning', {
        warningNumber,
        remainingSeconds: driver.remainingWorkingSeconds,
        message: warningMessage,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`❌ Error issuing warning ${warningNumber}:`, error);
  }
};

/**
 * 🛑 Auto-stop driver when time expires
 * @param {Object} driver - Driver document
 */
const autoStopDriver = async (driver) => {
  try {
    console.log(`🛑 AUTO-STOP: Time expired for driver: ${driver.driverId}`);

    // Check if driver has purchased extended hours or skipped all warnings
    if (!driver.extendedHoursPurchased && driver.warningsIssued === 3 && !driver.walletDeducted) {
      // Deduct ₹100 from wallet for ignoring warnings
      const deductionAmount = driver.workingHoursDeductionAmount || 100;

      if (driver.wallet >= deductionAmount) {
        driver.wallet -= deductionAmount;
        driver.walletDeducted = true;
        console.log(`💰 Deducted ₹${deductionAmount} from driver ${driver.driverId} wallet (ignored all warnings)`);

        // Create Transaction Record for auto-deduction
        try {
          const transaction = new Transaction({
            driver: driver._id,
            amount: deductionAmount,
            type: "debit",
            method: "extended_hours_auto_debit",
            description: "Extended working hours (auto-deducted after ignoring warnings)",
            date: new Date()
          });
          await transaction.save();
          console.log(`📝 Transaction created for auto-deduction: -₹${deductionAmount}`);
        } catch (txError) {
          console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
        }

        // Add 12 more hours
        driver.remainingWorkingSeconds = 12 * 60 * 60;
        driver.warningsIssued = 0;
        driver.extendedHoursPurchased = true;

        await driver.save();

        // Send notification about deduction
        if (driver.fcmToken) {
          await sendNotificationToDriver(
            driver.fcmToken,
            '💰 Wallet Deducted',
            `₹${deductionAmount} deducted for extending working hours.\nYou now have 12 more hours to work.`,
            {
              type: 'wallet_deduction',
              amount: deductionAmount.toString(),
              newBalance: driver.wallet.toString(),
              extendedHours: '12'
            }
          );
        }

        console.log(`✅ Driver ${driver.driverId} extended for 12 more hours after wallet deduction`);
        return;
      } else {
        console.log(`⚠️ Driver ${driver.driverId} has insufficient wallet balance (₹${driver.wallet}) for deduction`);
      }
    }

    // Stop timer
    stopWorkingHoursTimer(driver.driverId);

    // Set driver OFFLINE
    driver.status = "Offline";
    driver.timerActive = false;
    driver.autoStopScheduled = true;
    driver.remainingWorkingSeconds = 0;
    await driver.save();

    console.log(`✅ Driver ${driver.driverId} automatically set to OFFLINE`);

    // Send FCM notification
    if (driver.fcmToken) {
      await sendNotificationToDriver(
        driver.fcmToken,
        '🛑 Auto-Stop: Working Hours Completed',
        'You have been automatically set to OFFLINE.\nYour 12-hour shift has ended.\nThank you for your service!',
        {
          type: 'auto_stop',
          reason: 'working_hours_completed',
          driverId: driver.driverId
        }
      );
    }

    // Emit socket event
    if (io) {
      io.to(`driver_${driver.driverId}`).emit('autoStopCompleted', {
        message: 'Working hours completed',
        status: 'Offline',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`❌ Error in auto-stop for driver ${driver.driverId}:`, error);
  }
};

/**
 * 🛑 Stop working hours timer
 * @param {string} driverId - Driver ID
 */
const stopWorkingHoursTimer = (driverId) => {
  console.log(`🛑 Stopping timer for driver: ${driverId}`);

  if (activeTimers.has(driverId)) {
    clearInterval(activeTimers.get(driverId));
    activeTimers.delete(driverId);
    console.log(`✅ Timer stopped for driver: ${driverId}`);
  }
};

/**
 * 💰 Purchase extended working hours (₹100 deduction)
 * @param {string} driverId - Driver ID
 * @param {number} additionalHours - Number of hours to add (usually 12)
 */
const purchaseExtendedHours = async (driverId, additionalHours = 12) => {
  try {
    console.log(`💰 Processing extended hours purchase for driver: ${driverId}`);

    const driver = await Driver.findOne({ driverId });
    if (!driver) {
      return { success: false, message: 'Driver not found' };
    }

    const deductionAmount = driver.workingHoursDeductionAmount || 100;

    // Check wallet balance
    if (driver.wallet < deductionAmount) {
      return {
        success: false,
        message: `Insufficient balance. Required: ₹${deductionAmount}, Available: ₹${driver.wallet}`
      };
    }

    // Deduct from wallet
    driver.wallet -= deductionAmount;
    driver.walletDeducted = true;
    driver.extendedHoursPurchased = true;

    // Create Transaction Record for manual extended hours purchase
    try {
      const transaction = new Transaction({
        driver: driver._id,
        amount: deductionAmount,
        type: "debit",
        method: "extended_hours_purchase",
        description: `Purchased ${additionalHours} hours of extended working time`,
        date: new Date()
      });
      await transaction.save();
      console.log(`📝 Transaction created for extended hours purchase: -₹${deductionAmount}`);
    } catch (txError) {
      console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
    }

    // Add additional hours
    driver.remainingWorkingSeconds += (additionalHours * 60 * 60);
    driver.warningsIssued = 0; // Reset warnings

    await driver.save();

    console.log(`✅ Extended hours purchased: ${additionalHours}h for driver ${driverId}, ₹${deductionAmount} deducted`);

    // Send confirmation notification
    if (driver.fcmToken) {
      await sendNotificationToDriver(
        driver.fcmToken,
        '✅ Extended Hours Purchased',
        `You have ${additionalHours} more hours to work!\n₹${deductionAmount} deducted from wallet.\nNew balance: ₹${driver.wallet}`,
        {
          type: 'extended_hours_purchased',
          additionalHours: additionalHours.toString(),
          amountDeducted: deductionAmount.toString(),
          newBalance: driver.wallet.toString()
        }
      );
    }

    return {
      success: true,
      message: 'Extended hours purchased successfully',
      additionalHours,
      amountDeducted: deductionAmount,
      newBalance: driver.wallet,
      remainingSeconds: driver.remainingWorkingSeconds
    };

  } catch (error) {
    console.error(`❌ Error purchasing extended hours for driver ${driverId}:`, error);
    return { success: false, message: 'Failed to purchase extended hours', error: error.message };
  }
};

/**
 * ⏸️ Pause timer (when driver goes OFFLINE during shift)
 * @param {string} driverId - Driver ID
 */
const pauseWorkingHoursTimer = async (driverId) => {
  try {
    console.log(`⏸️ Pausing timer for driver: ${driverId}`);

    const driver = await Driver.findOne({ driverId });
    if (!driver || !driver.timerActive) {
      return { success: false, message: 'No active timer to pause' };
    }

    // Stop the interval
    stopWorkingHoursTimer(driverId);

    // Update driver status but keep remaining time
    driver.timerActive = false;
    driver.status = "Offline";
    await driver.save();

    console.log(`✅ Timer paused for driver ${driverId}, remaining: ${driver.remainingWorkingSeconds}s`);

    return {
      success: true,
      message: 'Timer paused successfully',
      remainingSeconds: driver.remainingWorkingSeconds
    };

  } catch (error) {
    console.error(`❌ Error pausing timer for driver ${driverId}:`, error);
    return { success: false, message: 'Failed to pause timer', error: error.message };
  }
};

/**
 * ▶️ Resume timer (when driver goes back ONLINE)
 * @param {string} driverId - Driver ID
 */
const resumeWorkingHoursTimer = async (driverId) => {
  try {
    console.log(`▶️ Resuming timer for driver: ${driverId}`);

    const driver = await Driver.findOne({ driverId });
    if (!driver || driver.remainingWorkingSeconds <= 0) {
      return { success: false, message: 'No timer to resume or time expired' };
    }

    // Restart the interval
    driver.timerActive = true;
    driver.status = "Live";
    await driver.save();

    const intervalId = setInterval(async () => {
      await updateWorkingHoursTimer(driverId);
    }, 1000);

    activeTimers.set(driverId, intervalId);

    console.log(`✅ Timer resumed for driver ${driverId}`);

    return {
      success: true,
      message: 'Timer resumed successfully',
      remainingSeconds: driver.remainingWorkingSeconds
    };

  } catch (error) {
    console.error(`❌ Error resuming timer for driver ${driverId}:`, error);
    return { success: false, message: 'Failed to resume timer', error: error.message };
  }
};

/**
 * ⏭️ Skip Warning (Acknowledge warning without purchase)
 * @param {string} driverId - Driver ID
 * @param {number} warningNumber - Warning number skipped
 */
const skipWarning = async (driverId, warningNumber) => {
  try {
    console.log(`⏭️ Driver ${driverId} skipped warning ${warningNumber}`);
    
    // We don't need to update DB state here as issueWarning already set warningsIssued.
    // This function exists primarily to acknowledge the request from frontend.
    
    return { success: true, message: 'Warning skipped successfully' };

  } catch (error) {
    console.error(`❌ Error skipping warning for driver ${driverId}:`, error);
    return { success: false, message: 'Failed to skip warning', error: error.message };
  }
};

/**
 * 📊 Get current timer status
 * @param {string} driverId - Driver ID
 */
const getTimerStatus = async (driverId) => {
  try {
    const driver = await Driver.findOne({ driverId });
    if (!driver) {
      return { success: false, message: 'Driver not found' };
    }

    const hours = Math.floor(driver.remainingWorkingSeconds / 3600);
    const minutes = Math.floor((driver.remainingWorkingSeconds % 3600) / 60);
    const seconds = driver.remainingWorkingSeconds % 60;

    return {
      success: true,
      timerActive: driver.timerActive,
      remainingSeconds: driver.remainingWorkingSeconds,
      formattedTime: `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
      warningsIssued: driver.warningsIssued,
      extendedHoursPurchased: driver.extendedHoursPurchased,
      walletBalance: driver.wallet
    };

  } catch (error) {
    console.error(`❌ Error getting timer status for driver ${driverId}:`, error);
    return { success: false, message: 'Failed to get timer status', error: error.message };
  }
};

/**
 * 🕒 Add extra working time for a driver with wallet deduction
 * @param {string} driverId - Driver ID
 * @param {number} hours - Hours to add
 * @param {number} minutes - Minutes to add
 * @param {number} seconds - Seconds to add
 * @param {number} deductionAmount - Amount to deduct from wallet (₹50 or ₹100)
 * @param {string} type - 'half' or 'full'
 */
const addExtraTime = async (driverId, hours, minutes, seconds, deductionAmount, type = 'custom') => {
  try {
    const driver = await Driver.findOne({ driverId });
    if (!driver || !driver.timerActive) {
      return { success: false, message: 'No active timer to add time to.' };
    }

    // Check wallet balance if deduction is required
    if (deductionAmount > 0) {
      if (driver.wallet < deductionAmount) {
        return {
          success: false,
          message: `Insufficient wallet balance. Required: ₹${deductionAmount}, Available: ₹${driver.wallet}`
        };
      }

      // Deduct from wallet
      driver.wallet -= deductionAmount;
      console.log(`💰 Deducted ₹${deductionAmount} from driver ${driverId} wallet for extra ${type} time`);

      // Create Transaction Record
      try {
        const transaction = new Transaction({
          driver: driver._id,
          amount: deductionAmount,
          type: "debit",
          method: type === 'half' ? "extra_half_time" : type === 'full' ? "extra_full_time" : "extra_time",
          description: `Extra ${type} time added (${hours}h ${minutes}m ${seconds}s)`,
          date: new Date()
        });
        await transaction.save();
        console.log(`📝 Transaction created for extra ${type} time: -₹${deductionAmount}`);
      } catch (txError) {
        console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
      }
    }

    const timeToAddInSeconds = (hours * 3600) + (minutes * 60) + seconds;
    driver.remainingWorkingSeconds += timeToAddInSeconds;
    await driver.save();

    console.log(`✅ Added ${hours}h ${minutes}m ${seconds}s to driver ${driverId}. New remaining time: ${driver.remainingWorkingSeconds}s`);

    return {
      success: true,
      message: 'Extra time added successfully.',
      newRemainingSeconds: driver.remainingWorkingSeconds,
      walletBalance: driver.wallet,
      amountDeducted: deductionAmount
    };
  } catch (error) {
    console.error(`❌ Error adding extra time for driver ${driverId}:`, error);
    return { success: false, message: 'Failed to add extra time.' };
  }
};

module.exports = {
  init: exports.init,
  startWorkingHoursTimer,
  stopWorkingHoursTimer,
  pauseWorkingHoursTimer,
  resumeWorkingHoursTimer,
  purchaseExtendedHours,
  getTimerStatus,
  updateWorkingHoursTimer,
  skipWarning,
  issueWarning,
  autoStopDriver,
  addExtraTime
};


//  Now check the permissions of the new file
// ls -l services/workingHoursService_fixed.js



// // services/workingHoursService.js
// const Driver = require('../models/driver/driver');
// const Transaction = require('../models/driver/transaction');
// const { sendNotificationToDriver } = require('./firebaseService');

// // --- SERVICE STATE ---
// const activeTimers = new Map();
// let io = null; // To hold the socket.io instance

// /**
//  * ✨ Initialize the service with the socket.io instance
//  * @param {object} socketIo - The initialized socket.io instance
//  */
// exports.init = (socketIo) => { io = socketIo; };
// /**
//  * ⏱️ Start working hours timer for a driver
//  * @param {string} driverId - Driver ID
//  */
// const startWorkingHoursTimer = async (driverId) => {
//   try {
//     console.log(`⏱️ Starting working hours timer for driver: ${driverId}`);

//     const driver = await Driver.findOne({ driverId });
//     if (!driver) {
//       console.error(`❌ Driver not found: ${driverId}`);
//       return { success: false, message: 'Driver not found' };
//     }

//     // ✅ CRITICAL FIX: Check if driver is already ONLINE with active timer
//     if (driver.status === 'Live' && driver.timerActive && driver.remainingWorkingSeconds > 0) {
//       console.log(`⚠️ Driver ${driverId} is already ONLINE with active timer. Resuming existing session.`);

//       // Resume the timer if not in memory (e.g., after server restart or driver re-login)
//       if (!activeTimers.has(driverId)) {
//         const intervalId = setInterval(async () => {
//           await updateWorkingHoursTimer(driverId);
//         }, 1000);
//         activeTimers.set(driverId, intervalId);
//         console.log(`✅ Resumed timer for driver ${driverId} (remaining: ${driver.remainingWorkingSeconds}s)`);
//       }

//       return {
//         success: true,
//         message: 'Existing session resumed - no wallet deduction',
//         totalHours: driver.workingHoursLimit,
//         remainingSeconds: driver.remainingWorkingSeconds,
//         walletBalance: driver.wallet,
//         amountDeducted: 0,
//         alreadyOnline: true
//       };
//     }

//     // Check if timer already running in memory
//     if (activeTimers.has(driverId)) {
//       console.log(`⚠️ Timer already running in memory for driver: ${driverId}`);
//       return {
//         success: true,
//         message: 'Timer already running',
//         walletBalance: driver.wallet,
//         amountDeducted: 0,
//         alreadyOnline: true
//       };
//     }

//     // ✅ NEW: Immediate Wallet Deduction for Shift Start (ONLY if truly starting new session)
//     const START_SHIFT_CHARGE = 100;

//     if (driver.wallet < START_SHIFT_CHARGE) {
//       console.log(`❌ Insufficient wallet balance for driver ${driverId}: ${driver.wallet}`);
//       return { 
//         success: false, 
//         message: `Insufficient wallet balance. Minimum ₹${START_SHIFT_CHARGE} required to go online.` 
//       };
//     }

//     // Deduct from wallet
//     driver.wallet -= START_SHIFT_CHARGE;
    
//     // Create Transaction Record
//     try {
//       const transaction = new Transaction({
//         driver: driver._id,
//         amount: START_SHIFT_CHARGE,
//         type: "debit",
//         method: "shift_start_fee",
//         description: "Online shift start fee (auto-debit)",
//         date: new Date()
//       });
//       await transaction.save();
//       console.log(`📝 Transaction created for shift start deduction: -₹${START_SHIFT_CHARGE}`);
//     } catch (txError) {
//       console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
//     }

//     console.log(`💰 Deducted ₹${START_SHIFT_CHARGE} from driver ${driverId}. New Balance: ${driver.wallet}`);

//     // Calculate total working hours in seconds
//     const totalHours = driver.workingHoursLimit + (driver.additionalWorkingHours || 0);
//     const totalSeconds = totalHours * 60 * 60; // Convert to seconds

//     // Update driver with timer start info
//     driver.onlineStartTime = new Date();
//     driver.remainingWorkingSeconds = totalSeconds;
//     driver.timerActive = true;
//     driver.warningsIssued = 0;
//     driver.autoStopScheduled = false;
//     driver.extendedHoursPurchased = false;
//     driver.walletDeducted = false;
//     driver.status = "Live";
//     await driver.save();

//     console.log(`✅ Timer initialized: ${totalHours} hours (${totalSeconds} seconds) for driver ${driverId}`);

//     // Start countdown timer (updates every second)
//     const intervalId = setInterval(async () => {
//       await updateWorkingHoursTimer(driverId);
//     }, 1000); // Run every 1 second

//     activeTimers.set(driverId, intervalId);

//     return {
//       success: true,
//       message: 'Timer started successfully',
//       totalHours,
//       remainingSeconds: totalSeconds,
//       walletBalance: driver.wallet,
//       amountDeducted: START_SHIFT_CHARGE
//     };

//   } catch (error) {
//     console.error(`❌ Error starting timer for driver ${driverId}:`, error);
//     return { success: false, message: 'Failed to start timer', error: error.message };
//   }
// };

// /**
//  * 🔄 Update timer (decrement remaining time and check for warnings)
//  * @param {string} driverId - Driver ID
//  */
// const updateWorkingHoursTimer = async (driverId) => {
//   try {
//     const driver = await Driver.findOne({ driverId });
//     if (!driver || !driver.timerActive) {
//       stopWorkingHoursTimer(driverId);
//       return;
//     }

//     // Decrement remaining seconds
//     driver.remainingWorkingSeconds -= 1;

//     // Convert remaining seconds to hours for easier comparison
//     const remainingHours = driver.remainingWorkingSeconds / 3600;
//     const totalHours = driver.workingHoursLimit;

//     // Log timer every minute (every 60 calls)
//     if (driver.remainingWorkingSeconds % 60 === 0) {
//       const hours = Math.floor(driver.remainingWorkingSeconds / 3600);
//       const minutes = Math.floor((driver.remainingWorkingSeconds % 3600) / 60);
//       const seconds = driver.remainingWorkingSeconds % 60;
//       console.log(`⏰ Driver ${driverId} remaining time: ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
//     }

//     // ✅ WARNING 1: At 11 hours (when 1 hour remaining)
//     if (
//       totalHours === 12 &&
//       remainingHours <= 1 &&
//       remainingHours > 0.5 &&
//       driver.warningsIssued === 0
//     ) {
//       await issueWarning(driver, 1);
//     }

//     // ✅ WARNING 2: At 11.5 hours (when 30 minutes remaining)
//     if (
//       totalHours === 12 &&
//       remainingHours <= 0.5 &&
//       remainingHours > 0.333 &&
//       driver.warningsIssued === 1
//     ) {
//       await issueWarning(driver, 2);
//     }

//     // ✅ WARNING 3: At 11:50 hours (when 10 minutes remaining)
//     if (
//       totalHours === 12 &&
//       remainingHours <= 0.167 &&
//       remainingHours > 0 &&
//       driver.warningsIssued === 2
//     ) {
//       await issueWarning(driver, 3);
//     }

//     // ✅ AUTO-STOP: When time reaches 0
//     if (driver.remainingWorkingSeconds <= 0) {
//       await autoStopDriver(driver);
//       return;
//     }

//     // Save updated remaining time
//     await driver.save();

//   } catch (error) {
//     console.error(`❌ Error updating timer for driver ${driverId}:`, error);
//   }
// };

// /**
//  * ⚠️ Issue warning notification to driver
//  * @param {Object} driver - Driver document
//  * @param {Number} warningNumber - 1, 2, or 3
//  */
// const issueWarning = async (driver, warningNumber) => {
//   try {
//     console.log(`⚠️ WARNING ${warningNumber} for driver: ${driver.driverId}`);

//     driver.warningsIssued = warningNumber;
//     driver.lastWarningTime = new Date();
//     await driver.save();

//     const remainingHours = Math.floor(driver.remainingWorkingSeconds / 3600);
//     const remainingMinutes = Math.floor((driver.remainingWorkingSeconds % 3600) / 60);

//     let warningMessage = '';
//     if (warningNumber === 1) {
//       warningMessage = `⚠️ Your online ride time has reached 11 hours.\nAuto-stop at 12 hours.\nTime remaining: ${remainingHours}h ${remainingMinutes}m\n\nDo you want to continue for an extra 12 hours (₹100)?`;
//     } else if (warningNumber === 2) {
//       warningMessage = `⚠️ WARNING: Only ${remainingMinutes} minutes remaining!\nAuto-stop approaching at 12 hours.\n\nContinue for extra 12 hours (₹100)?`;
//     } else if (warningNumber === 3) {
//       warningMessage = `🚨 FINAL WARNING: ${remainingMinutes} minutes left!\nYou will be automatically set OFFLINE soon.\n\nLast chance: Continue for extra 12 hours (₹100)?`;
//     }

//     // Send FCM notification
//     if (driver.fcmToken) {
//       await sendNotificationToDriver(
//         driver.fcmToken,
//         `⚠️ Working Hours Warning ${warningNumber}/3`,
//         warningMessage,
//         {
//           type: 'working_hours_warning',
//           warningNumber: warningNumber.toString(),
//           remainingSeconds: driver.remainingWorkingSeconds.toString(),
//           driverId: driver.driverId,
//           sound: 'notification_old.mp3',
//           priority: 'high',
//           click_action: 'WORKING_HOURS_WARNING'
//         }
//       );
//       console.log(`📱 Warning ${warningNumber} notification sent to driver ${driver.driverId}`);
//     }

//     // Emit socket event if socket.io is available
//     if (io) {
//       io.to(`driver_${driver.driverId}`).emit('workingHoursWarning', {
//         warningNumber,
//         remainingSeconds: driver.remainingWorkingSeconds,
//         message: warningMessage,
//         timestamp: new Date().toISOString()
//       });
//     }

//   } catch (error) {
//     console.error(`❌ Error issuing warning ${warningNumber}:`, error);
//   }
// };

// /**
//  * 🛑 Auto-stop driver when time expires
//  * @param {Object} driver - Driver document
//  */
// const autoStopDriver = async (driver) => {
//   try {
//     console.log(`🛑 AUTO-STOP: Time expired for driver: ${driver.driverId}`);

//     // Check if driver has purchased extended hours or skipped all warnings
//     if (!driver.extendedHoursPurchased && driver.warningsIssued === 3 && !driver.walletDeducted) {
//       // Deduct ₹100 from wallet for ignoring warnings
//       const deductionAmount = driver.workingHoursDeductionAmount || 100;

//       if (driver.wallet >= deductionAmount) {
//         driver.wallet -= deductionAmount;
//         driver.walletDeducted = true;
//         console.log(`💰 Deducted ₹${deductionAmount} from driver ${driver.driverId} wallet (ignored all warnings)`);

//         // Create Transaction Record for auto-deduction
//         try {
//           const transaction = new Transaction({
//             driver: driver._id,
//             amount: deductionAmount,
//             type: "debit",
//             method: "extended_hours_auto_debit",
//             description: "Extended working hours (auto-deducted after ignoring warnings)",
//             date: new Date()
//           });
//           await transaction.save();
//           console.log(`📝 Transaction created for auto-deduction: -₹${deductionAmount}`);
//         } catch (txError) {
//           console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
//         }

//         // Add 12 more hours
//         driver.remainingWorkingSeconds = 12 * 60 * 60;
//         driver.warningsIssued = 0;
//         driver.extendedHoursPurchased = true;

//         await driver.save();

//         // Send notification about deduction
//         if (driver.fcmToken) {
//           await sendNotificationToDriver(
//             driver.fcmToken,
//             '💰 Wallet Deducted',
//             `₹${deductionAmount} deducted for extending working hours.\nYou now have 12 more hours to work.`,
//             {
//               type: 'wallet_deduction',
//               amount: deductionAmount.toString(),
//               newBalance: driver.wallet.toString(),
//               extendedHours: '12'
//             }
//           );
//         }

//         console.log(`✅ Driver ${driver.driverId} extended for 12 more hours after wallet deduction`);
//         return;
//       } else {
//         console.log(`⚠️ Driver ${driver.driverId} has insufficient wallet balance (₹${driver.wallet}) for deduction`);
//       }
//     }

//     // Stop timer
//     stopWorkingHoursTimer(driver.driverId);

//     // Set driver OFFLINE
//     driver.status = "Offline";
//     driver.timerActive = false;
//     driver.autoStopScheduled = true;
//     driver.remainingWorkingSeconds = 0;
//     await driver.save();

//     console.log(`✅ Driver ${driver.driverId} automatically set to OFFLINE`);

//     // Send FCM notification
//     if (driver.fcmToken) {
//       await sendNotificationToDriver(
//         driver.fcmToken,
//         '🛑 Auto-Stop: Working Hours Completed',
//         'You have been automatically set to OFFLINE.\nYour 12-hour shift has ended.\nThank you for your service!',
//         {
//           type: 'auto_stop',
//           reason: 'working_hours_completed',
//           driverId: driver.driverId
//         }
//       );
//     }

//     // Emit socket event
//     if (io) {
//       io.to(`driver_${driver.driverId}`).emit('autoStopCompleted', {
//         message: 'Working hours completed',
//         status: 'Offline',
//         timestamp: new Date().toISOString()
//       });
//     }

//   } catch (error) {
//     console.error(`❌ Error in auto-stop for driver ${driver.driverId}:`, error);
//   }
// };

// /**
//  * 🛑 Stop working hours timer
//  * @param {string} driverId - Driver ID
//  */
// const stopWorkingHoursTimer = (driverId) => {
//   console.log(`🛑 Stopping timer for driver: ${driverId}`);

//   if (activeTimers.has(driverId)) {
//     clearInterval(activeTimers.get(driverId));
//     activeTimers.delete(driverId);
//     console.log(`✅ Timer stopped for driver: ${driverId}`);
//   }
// };

// /**
//  * 💰 Purchase extended working hours (₹100 deduction)
//  * @param {string} driverId - Driver ID
//  * @param {number} additionalHours - Number of hours to add (usually 12)
//  */
// const purchaseExtendedHours = async (driverId, additionalHours = 12) => {
//   try {
//     console.log(`💰 Processing extended hours purchase for driver: ${driverId}`);

//     const driver = await Driver.findOne({ driverId });
//     if (!driver) {
//       return { success: false, message: 'Driver not found' };
//     }

//     const deductionAmount = driver.workingHoursDeductionAmount || 100;

//     // Check wallet balance
//     if (driver.wallet < deductionAmount) {
//       return {
//         success: false,
//         message: `Insufficient balance. Required: ₹${deductionAmount}, Available: ₹${driver.wallet}`
//       };
//     }

//     // Deduct from wallet
//     driver.wallet -= deductionAmount;
//     driver.walletDeducted = true;
//     driver.extendedHoursPurchased = true;

//     // Create Transaction Record for manual extended hours purchase
//     try {
//       const transaction = new Transaction({
//         driver: driver._id,
//         amount: deductionAmount,
//         type: "debit",
//         method: "extended_hours_purchase",
//         description: `Purchased ${additionalHours} hours of extended working time`,
//         date: new Date()
//       });
//       await transaction.save();
//       console.log(`📝 Transaction created for extended hours purchase: -₹${deductionAmount}`);
//     } catch (txError) {
//       console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
//     }

//     // Add additional hours
//     driver.remainingWorkingSeconds += (additionalHours * 60 * 60);
//     driver.warningsIssued = 0; // Reset warnings

//     await driver.save();

//     console.log(`✅ Extended hours purchased: ${additionalHours}h for driver ${driverId}, ₹${deductionAmount} deducted`);

//     // Send confirmation notification
//     if (driver.fcmToken) {
//       await sendNotificationToDriver(
//         driver.fcmToken,
//         '✅ Extended Hours Purchased',
//         `You have ${additionalHours} more hours to work!\n₹${deductionAmount} deducted from wallet.\nNew balance: ₹${driver.wallet}`,
//         {
//           type: 'extended_hours_purchased',
//           additionalHours: additionalHours.toString(),
//           amountDeducted: deductionAmount.toString(),
//           newBalance: driver.wallet.toString()
//         }
//       );
//     }

//     return {
//       success: true,
//       message: 'Extended hours purchased successfully',
//       additionalHours,
//       amountDeducted: deductionAmount,
//       newBalance: driver.wallet,
//       remainingSeconds: driver.remainingWorkingSeconds
//     };

//   } catch (error) {
//     console.error(`❌ Error purchasing extended hours for driver ${driverId}:`, error);
//     return { success: false, message: 'Failed to purchase extended hours', error: error.message };
//   }
// };

// /**
//  * ⏸️ Pause timer (when driver goes OFFLINE during shift)
//  * @param {string} driverId - Driver ID
//  */
// const pauseWorkingHoursTimer = async (driverId) => {
//   try {
//     console.log(`⏸️ Pausing timer for driver: ${driverId}`);

//     const driver = await Driver.findOne({ driverId });
//     if (!driver || !driver.timerActive) {
//       return { success: false, message: 'No active timer to pause' };
//     }

//     // Stop the interval
//     stopWorkingHoursTimer(driverId);

//     // Update driver status but keep remaining time
//     driver.timerActive = false;
//     driver.status = "Offline";
//     await driver.save();

//     console.log(`✅ Timer paused for driver ${driverId}, remaining: ${driver.remainingWorkingSeconds}s`);

//     return {
//       success: true,
//       message: 'Timer paused successfully',
//       remainingSeconds: driver.remainingWorkingSeconds
//     };

//   } catch (error) {
//     console.error(`❌ Error pausing timer for driver ${driverId}:`, error);
//     return { success: false, message: 'Failed to pause timer', error: error.message };
//   }
// };

// /**
//  * ▶️ Resume timer (when driver goes back ONLINE)
//  * @param {string} driverId - Driver ID
//  */
// const resumeWorkingHoursTimer = async (driverId) => {
//   try {
//     console.log(`▶️ Resuming timer for driver: ${driverId}`);

//     const driver = await Driver.findOne({ driverId });
//     if (!driver || driver.remainingWorkingSeconds <= 0) {
//       return { success: false, message: 'No timer to resume or time expired' };
//     }

//     // Restart the interval
//     driver.timerActive = true;
//     driver.status = "Live";
//     await driver.save();

//     const intervalId = setInterval(async () => {
//       await updateWorkingHoursTimer(driverId);
//     }, 1000);

//     activeTimers.set(driverId, intervalId);

//     console.log(`✅ Timer resumed for driver ${driverId}`);

//     return {
//       success: true,
//       message: 'Timer resumed successfully',
//       remainingSeconds: driver.remainingWorkingSeconds
//     };

//   } catch (error) {
//     console.error(`❌ Error resuming timer for driver ${driverId}:`, error);
//     return { success: false, message: 'Failed to resume timer', error: error.message };
//   }
// };

// /**
//  * ⏭️ Skip Warning (Acknowledge warning without purchase)
//  * @param {string} driverId - Driver ID
//  * @param {number} warningNumber - Warning number skipped
//  */
// const skipWarning = async (driverId, warningNumber) => {
//   try {
//     console.log(`⏭️ Driver ${driverId} skipped warning ${warningNumber}`);
    
//     // We don't need to update DB state here as issueWarning already set warningsIssued.
//     // This function exists primarily to acknowledge the request from frontend.
    
//     return { success: true, message: 'Warning skipped successfully' };

//   } catch (error) {
//     console.error(`❌ Error skipping warning for driver ${driverId}:`, error);
//     return { success: false, message: 'Failed to skip warning', error: error.message };
//   }
// };

// /**
//  * 📊 Get current timer status
//  * @param {string} driverId - Driver ID
//  */
// const getTimerStatus = async (driverId) => {
//   try {
//     const driver = await Driver.findOne({ driverId });
//     if (!driver) {
//       return { success: false, message: 'Driver not found' };
//     }

//     const hours = Math.floor(driver.remainingWorkingSeconds / 3600);
//     const minutes = Math.floor((driver.remainingWorkingSeconds % 3600) / 60);
//     const seconds = driver.remainingWorkingSeconds % 60;

//     return {
//       success: true,
//       timerActive: driver.timerActive,
//       remainingSeconds: driver.remainingWorkingSeconds,
//       formattedTime: `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
//       warningsIssued: driver.warningsIssued,
//       extendedHoursPurchased: driver.extendedHoursPurchased,
//       walletBalance: driver.wallet
//     };

//   } catch (error) {
//     console.error(`❌ Error getting timer status for driver ${driverId}:`, error);
//     return { success: false, message: 'Failed to get timer status', error: error.message };
//   }
// };

// /**
//  * 🕒 Add extra working time for a driver with wallet deduction
//  * @param {string} driverId - Driver ID
//  * @param {number} hours - Hours to add
//  * @param {number} minutes - Minutes to add
//  * @param {number} seconds - Seconds to add
//  * @param {number} deductionAmount - Amount to deduct from wallet (₹50 or ₹100)
//  * @param {string} type - 'half' or 'full'
//  */
// const addExtraTime = async (driverId, hours, minutes, seconds, deductionAmount, type = 'custom') => {
//   try {
//     const driver = await Driver.findOne({ driverId });
//     if (!driver || !driver.timerActive) {
//       return { success: false, message: 'No active timer to add time to.' };
//     }

//     // Check wallet balance if deduction is required
//     if (deductionAmount > 0) {
//       if (driver.wallet < deductionAmount) {
//         return {
//           success: false,
//           message: `Insufficient wallet balance. Required: ₹${deductionAmount}, Available: ₹${driver.wallet}`
//         };
//       }

//       // Deduct from wallet
//       driver.wallet -= deductionAmount;
//       console.log(`💰 Deducted ₹${deductionAmount} from driver ${driverId} wallet for extra ${type} time`);

//       // Create Transaction Record
//       try {
//         const transaction = new Transaction({
//           driver: driver._id,
//           amount: deductionAmount,
//           type: "debit",
//           method: type === 'half' ? "extra_half_time" : type === 'full' ? "extra_full_time" : "extra_time",
//           description: `Extra ${type} time added (${hours}h ${minutes}m ${seconds}s)`,
//           date: new Date()
//         });
//         await transaction.save();
//         console.log(`📝 Transaction created for extra ${type} time: -₹${deductionAmount}`);
//       } catch (txError) {
//         console.error(`⚠️ Failed to create transaction record: ${txError.message}`);
//       }
//     }

//     const timeToAddInSeconds = (hours * 3600) + (minutes * 60) + seconds;
//     driver.remainingWorkingSeconds += timeToAddInSeconds;
//     await driver.save();

//     console.log(`✅ Added ${hours}h ${minutes}m ${seconds}s to driver ${driverId}. New remaining time: ${driver.remainingWorkingSeconds}s`);

//     return {
//       success: true,
//       message: 'Extra time added successfully.',
//       newRemainingSeconds: driver.remainingWorkingSeconds,
//       walletBalance: driver.wallet,
//       amountDeducted: deductionAmount
//     };
//   } catch (error) {
//     console.error(`❌ Error adding extra time for driver ${driverId}:`, error);
//     return { success: false, message: 'Failed to add extra time.' };
//   }
// };

// module.exports = {
//   init: exports.init,
//   startWorkingHoursTimer,
//   stopWorkingHoursTimer,
//   pauseWorkingHoursTimer,
//   resumeWorkingHoursTimer,
//   purchaseExtendedHours,
//   getTimerStatus,
//   updateWorkingHoursTimer,
//   skipWarning,
//   issueWarning,
//   autoStopDriver,
//   addExtraTime
// };
