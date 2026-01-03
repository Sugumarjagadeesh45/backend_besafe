require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const morgan = require("morgan");
const jwt = require("jsonwebtoken");

// ✅ INITIALIZE APP
const app = express();

// Make sure this is correctly configured
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ FIXED CORS CONFIGURATION
console.log("🔧 Setting up CORS...");
app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001", "*"],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  exposedHeaders: ["Content-Length", "Content-Type", "Authorization"]
}));





// ✅ MIDDLEWARE
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ UPLOADS DIRECTORY & STATIC SERVING
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log("Created uploads directory:", uploadsDir);
}

app.use("/uploads", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  express.static(uploadsDir)(req, res, next);
});

console.log("📂 Static files served from /uploads");

// ✅ FIXED DRIVER NOTIFICATION BASED ON VEHICLE TYPE
// This is the CRITICAL FIX - Always filter drivers by vehicle type when sending ride notifications

// ✅ ADD THESE CRITICAL ADMIN ENDPOINTS - PUT THIS AT THE TOP AFTER CORS
console.log("🔧 Setting up admin endpoints...");

// ✅ ADD THESE DIRECT ADMIN ENDPOINTS BEFORE OTHER ROUTES
app.get('/api/admin/drivers', async (req, res) => {
  try {
    console.log('🚗 DIRECT ADMIN: Fetching all drivers');
    
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ 
        success: false, 
        error: "No token provided" 
      });
    }
    
    const token = authHeader.split(" ")[1];
    try {
      jwt.verify(token, process.env.JWT_SECRET || "secret");
    } catch (err) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid token" 
      });
    }
    
    const Driver = require('./models/driver/driver');
    const drivers = await Driver.find({})
      .select('-passwordHash -__v')
      .sort({ createdAt: -1 });
    
    console.log(`✅ DIRECT ADMIN: Found ${drivers.length} drivers`);
    
    res.json({
      success: true,
      data: drivers,
      message: `Found ${drivers.length} drivers`
    });
    
  } catch (error) {
    console.error('❌ DIRECT ADMIN drivers endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch drivers',
      details: error.message
    });
  }
});




// In app.js - Add this debug endpoint
app.get('/api/debug/ride/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params;
    console.log(`🔍 DEBUG: Checking ride ${rideId}`);
    
    const Ride = require('./models/ride');
    const ride = await Ride.findOne({ RAID_ID: rideId });
    
    if (!ride) {
      return res.json({
        exists: false,
        message: 'Ride not found'
      });
    }
    
    res.json({
      exists: true,
      RAID_ID: ride.RAID_ID,
      status: ride.status,
      driverId: ride.driverId,
      driverName: ride.driverName,
      driver: ride.driver,
      user: ride.user,
      userId: ride.userId,
      allFields: Object.keys(ride._doc)
    });
    
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});


// Simple ride completion endpoint
app.post('/api/rides/simple-complete', async (req, res) => {
  try {
    const { rideId, driverId, distance, fare } = req.body;
    
    console.log('🎉 SIMPLE: Ride completion request:', { rideId, driverId });
    
    const ride = await Ride.findOne({ RAID_ID: rideId });
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }
    
    // ✅ STRICT FARE CALCULATION
    const vehicleType = (ride.rideType || ride.vehicleType || 'taxi').toLowerCase();
    const distanceKm = parseFloat(distance) || 0;
    let finalFare = fare; // Default to provided fare if calculation fails

    try {
        const ridePriceController = require("./controllers/ridePriceController");
        const currentPrices = ridePriceController.getCurrentPrices();
        console.log(`💰 Admin Prices (Simple Complete):`, currentPrices);
        let pricePerKm = currentPrices[vehicleType] || 0;
        
        if (!pricePerKm) {
             pricePerKm = vehicleType === 'bike' ? 15 :
                          vehicleType === 'taxi' ? 40 : 75;
        }
        
        finalFare = Math.round(distanceKm * pricePerKm);
        console.log(`💰 SIMPLE CALCULATION: ${distanceKm}km * ₹${pricePerKm} = ₹${finalFare}`);
    } catch (e) {
        console.error("Error calculating fare in simple-complete:", e);
    }

    // Update ride
    ride.status = 'completed';
    ride.completedAt = new Date();
    ride.actualDistance = distance;
    ride.actualFare = finalFare;
    await ride.save();
    
    // Update driver status
    await Driver.findOneAndUpdate(
      { driverId: driverId },
      { 
          status: 'Live', 
          lastUpdate: new Date(),
          $inc: { wallet: parseFloat(finalFare) || 0 }
      }
    );
    
    // Notify user via socket
    const io = req.app.get('io');
    const userId = ride.user?.toString();
    
    if (userId && io) {
      // 1. Emit billAlert (CRITICAL - First)
      io.to(userId).emit("billAlert", {
        type: "bill",
        rideId: rideId,
        distance: `${distance} km`,
        fare: finalFare,
        driverName: ride.driverName || "Driver",
        vehicleType: ride.rideType || "bike",
        timestamp: new Date().toISOString(),
        message: "Ride completed! Here's your bill.",
        showBill: true
      });

      // 2. Emit rideCompleted (Second - No Status)
      io.to(userId).emit('rideCompleted', {
        rideId,
        distance: `${distance} km`,
        charge: finalFare,
        fare: finalFare,
        driverName: ride.driverName || 'Driver',
        vehicleType: ride.rideType || 'bike',
        timestamp: new Date().toISOString()
        // status: 'completed' // Removed to prevent premature navigation
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Ride completed successfully',
      rideId,
      fare: finalFare,
      distance 
    });
    
  } catch (error) {
    console.error('❌ SIMPLE completion error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});




// ✅ Direct driver wallet update endpoint
app.put('/api/admin/direct-wallet/:driverId', async (req, res) => {
  try {
    console.log(`💰 DIRECT WALLET: Updating wallet for driver: ${req.params.driverId}, amount: ${req.body.amount}`);
    
    const { driverId } = req.params;
    const { amount } = req.body;
    
    if (!amount || isNaN(amount) || amount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid positive amount is required'
      });
    }
    
    const Driver = require('./models/driver/driver');
    const addAmount = Number(amount);
    
    // Find driver by driverId
    const driver = await Driver.findOne({ driverId });
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    // Update wallet
    const currentWallet = driver.wallet || 0;
    const newWallet = currentWallet + addAmount;
    
    driver.wallet = newWallet;
    driver.lastUpdate = new Date();
    await driver.save();
    
    console.log(`✅ DIRECT WALLET: Updated ${driverId} from ${currentWallet} to ${newWallet}`);
    
    res.json({
      success: true,
      message: 'Wallet updated successfully',
      data: {
        driverId: driver.driverId,
        name: driver.name,
        addedAmount: addAmount,
        previousWallet: currentWallet,
        wallet: newWallet,
        updatedAt: new Date()
      }
    });
    
  } catch (error) {
    console.error('❌ DIRECT wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update wallet',
      error: error.message
    });
  }
});

// ✅ Direct toggle driver status endpoint
app.put('/api/admin/driver/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔄 DIRECT TOGGLE: Toggling driver status for: ${id}`);
    
    const Driver = require('./models/driver/driver');
    
    // Try to find by driverId first
    let driver = await Driver.findOne({ driverId: id });
    
    // If not found by driverId, try by _id
    if (!driver) {
      if (id.match(/^[0-9a-fA-F]{24}$/)) {
        driver = await Driver.findById(id);
      }
    }
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        error: 'Driver not found' 
      });
    }

    driver.status = driver.status === 'Live' ? 'Offline' : 'Live';
    await driver.save();

    console.log(`✅ DIRECT TOGGLE: Driver ${driver.driverId} status updated to ${driver.status}`);
    
    res.json({ 
      success: true, 
      message: `Driver status updated to ${driver.status}`,
      data: {
        driverId: driver.driverId,
        name: driver.name,
        status: driver.status
      }
    });
  } catch (error) {
    console.error('❌ DIRECT toggle error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update status',
      details: error.message 
    });
  }
});

// ✅ ADMIN ORDER ROUTES
console.log("📦 Loading order routes...");

// ✅ FIXED ENHANCED RIDE BOOKING ENDPOINT WITH VEHICLE TYPE FILTERING
app.post('/api/rides/book-ride-enhanced', async (req, res) => {
  try {
    const {
      userId,
      pickupLocation,
      dropoffLocation,
      pickupAddress,
      dropoffAddress,
      vehicleType, // PORT, TAXI, BIKE
      paymentMethod,
      estimatedFare,
      customerPhone,
      customerName
    } = req.body;

    console.log(`🚗 ENHANCED: Booking ride for ${customerName}, Vehicle Type: ${vehicleType}`);

    if (!vehicleType) {
      return res.status(400).json({
        success: false,
        error: 'Vehicle type is required (PORT, TAXI, or BIKE)'
      });
    }

    const Ride = require('./models/ride');
    const Driver = require('./models/driver/driver');
    
    // Generate ride ID
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    const rideId = `RIDE${timestamp}${random}`;

    // Create ride document
    const ride = new Ride({
      RAID_ID: rideId,
      user: userId,
      userPhone: customerPhone,
      userName: customerName,
      pickupLocation: {
        type: 'Point',
        coordinates: [pickupLocation.lng, pickupLocation.lat]
      },
      dropoffLocation: {
        type: 'Point',
        coordinates: [dropoffLocation.lng, dropoffLocation.lat]
      },
      pickupAddress,
      dropoffAddress,
      vehicleType: vehicleType.toLowerCase(), // ✅ Enforce lowercase
      paymentMethod,
      estimatedFare,
      status: 'searching'
    });

    await ride.save();

    console.log(`✅ Ride ${rideId} created for ${vehicleType}`);

    // ✅ CRITICAL FIX: Find drivers with EXACT vehicle type match (lowercase)
    console.log(`🔍 Looking for drivers with vehicle type: ${vehicleType}`);

    const matchingDrivers = await Driver.find({
      status: 'Live',
      vehicleType: vehicleType.toLowerCase(), // ✅ Exact match, lowercase only
      'location.coordinates.0': { $exists: true },
      'location.coordinates.1': { $exists: true }
    })
    .select('driverId name phone vehicleType vehicleNumber fcmToken location')
    .limit(50);

    console.log(`✅ Found ${matchingDrivers.length} drivers with vehicle type ${vehicleType}`);

    // ✅ REMOVED FALLBACK LOGIC - Only send to exact vehicle type matches
    if (matchingDrivers.length === 0) {
      console.log(`⚠️ No ${vehicleType} drivers available. Ride will remain in 'searching' status.`);
    }

    // Get FCM tokens for matching drivers
    const fcmTokens = matchingDrivers
      .filter(driver => driver.fcmToken && driver.fcmToken.length > 10)
      .map(driver => driver.fcmToken);

    console.log(`📱 Found ${fcmTokens.length} drivers with valid FCM tokens for ${vehicleType}`);

    // Prepare ride data for notification
    const rideData = {
      rideId: ride.RAID_ID,
      userId: ride.user,
      customerName: ride.userName,
      customerPhone: ride.userPhone,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      vehicleType: ride.vehicleType,
      estimatedFare: ride.estimatedFare,
      pickupLocation: {
        lat: ride.pickupLocation.coordinates[1],
        lng: ride.pickupLocation.coordinates[0]
      },
      timestamp: new Date().toISOString(),
      _vehicleTypeFiltered: true // Mark as filtered by vehicle type
    };

    // Send notifications to matching drivers
    if (fcmTokens.length > 0) {
      const admin = require('firebase-admin');
      
      // Initialize Firebase if not already done
      if (!admin.apps.length) {
        try {
          const serviceAccount = require('./firebase-service-account.json');
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          });
          console.log('✅ Firebase initialized for notifications');
        } catch (error) {
          console.error('❌ Firebase initialization error:', error);
        }
      }

      // Prepare notification message
      const message = {
        notification: {
          title: `New ${vehicleType} Ride Request`,
          body: `From ${pickupAddress.substring(0, 30)}...`
        },
        data: {
          type: 'new_ride',
          rideId: ride.RAID_ID,
          vehicleType: vehicleType,
          pickupAddress: pickupAddress.substring(0, 100),
          estimatedFare: estimatedFare.toString(),
          timestamp: new Date().toISOString()
        },
        tokens: fcmTokens,
        android: {
          priority: 'high'
        },
        apns: {
          headers: {
            'apns-priority': '10'
          },
          payload: {
            aps: {
              contentAvailable: true,
              sound: 'default'
            }
          }
        }
      };

      // Send notification
      try {
        const response = await admin.messaging().sendMulticast(message);
        console.log(`📤 Sent ${response.successCount}/${fcmTokens.length} notifications for ${vehicleType} ride`);
        
        if (response.failureCount > 0) {
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              console.error(`❌ Failed to send to token ${idx}:`, resp.error);
            }
          });
        }
      } catch (fcmError) {
        console.error('❌ FCM send error:', fcmError);
      }
    }

    // Emit socket event to matching drivers only
    const io = req.app.get('io');
    if (io) {
      // ✅ CRITICAL FIX: Send ONLY to matching drivers, not all drivers
      matchingDrivers.forEach(driver => {
        if (driver.driverId) {
          // Emit to individual driver rooms
          io.to(`driver_${driver.driverId}`).emit('newRideAvailable', {
            ...rideData,
            targetVehicleType: vehicleType,
            driverCount: matchingDrivers.length
          });
        }
      });
      
      console.log(`📡 Socket event emitted for ${vehicleType} ride to ${matchingDrivers.length} drivers ONLY`);
    }

    res.json({
      success: true,
      message: `Ride booked successfully! Searching for ${vehicleType} drivers...`,
      data: {
        rideId: ride.RAID_ID,
        vehicleType,
        matchingDrivers: matchingDrivers.length,
        estimatedFare,
        status: 'searching'
      }
    });

  } catch (error) {
    console.error('❌ Enhanced ride booking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to book ride',
      details: error.message
    });
  }
});







// Add this debug endpoint to app.js
app.get('/api/debug/drivers-by-vehicle', async (req, res) => {
  try {
    const Driver = require('./models/driver/driver');
    
    const drivers = await Driver.find({})
      .select('driverId name phone vehicleType fcmToken status')
      .lean();
    
    const byVehicleType = {};
    drivers.forEach(driver => {
      const type = driver.vehicleType || 'UNKNOWN';
      if (!byVehicleType[type]) {
        byVehicleType[type] = [];
      }
      byVehicleType[type].push({
        driverId: driver.driverId,
        name: driver.name,
        hasFCM: !!driver.fcmToken,
        status: driver.status
      });
    });
    
    res.json({
      success: true,
      totalDrivers: drivers.length,
      byVehicleType,
      drivers: drivers.map(d => ({
        driverId: d.driverId,
        name: d.name,
        vehicleType: d.vehicleType,
        fcmToken: d.fcmToken ? 'YES' : 'NO',
        status: d.status
      }))
    });
  } catch (error) {
    console.error('Driver debug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// Add this endpoint
app.post('/api/rides/complete', async (req, res) => {
  try {
    const { rideId, driverId, distance, fare } = req.body;
    
    const ride = await Ride.findOne({ RAID_ID: rideId });
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }
    
    ride.status = 'completed';
    ride.completedAt = new Date();
    ride.actualDistance = distance;
    ride.actualFare = fare;
    await ride.save();
    
    const io = req.app.get('io');
    const userId = ride.user?.toString();
    
    if (userId && io) {
      io.to(userId).emit('rideCompleted', {
        rideId,
        distance: `${distance} km`,
        charge: fare,
        driverName: ride.driverName || 'Driver',
        vehicleType: ride.rideType || 'bike'
      });
    }
    
    res.json({ success: true, message: 'Ride completed successfully' });
  } catch (error) {
    console.error('Error completing ride:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ UPDATE RIDE BOOKING ENDPOINT WITH STRICT VEHICLE TYPE FILTER
app.post('/api/rides/book-ride-strict', async (req, res) => {
  try {
    const {
      userId,
      vehicleType, // CRITICAL: This must match driver's vehicleType exactly
      pickupLocation,
      dropoffLocation,
      pickupAddress,
      dropoffAddress,
      paymentMethod,
      estimatedFare,
      customerPhone,
      customerName
    } = req.body;

    console.log(`🚗 STRICT BOOKING: User selected ${vehicleType} vehicle`);

    // Validate vehicle type
    const validVehicleTypes = ['PORT', 'TAXI', 'BIKE'];
    if (!validVehicleTypes.includes(vehicleType.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid vehicle type. Must be one of: ${validVehicleTypes.join(', ')}`
      });
    }

    const Ride = require('./models/ride');
    const Driver = require('./models/driver/driver');

    // Generate ride ID
    const rideId = `RIDE${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Create ride
    const ride = new Ride({
      RAID_ID: rideId,
      user: userId,
      userPhone: customerPhone,
      userName: customerName,
      pickupLocation: {
        type: 'Point',
        coordinates: [pickupLocation.lng, pickupLocation.lat]
      },
      dropoffLocation: {
        type: 'Point',
        coordinates: [dropoffLocation.lng, dropoffLocation.lat]
      },
      pickupAddress,
      dropoffAddress,
      vehicleType: vehicleType.toUpperCase(), // Store as uppercase
      paymentMethod,
      estimatedFare,
      status: 'searching',
      createdAt: new Date()
    });

    await ride.save();
    console.log(`✅ STRICT: Ride ${rideId} created for ${vehicleType}`);

    // ✅ CRITICAL: Find ONLY drivers with matching vehicle type
    const matchingDrivers = await Driver.find({
      status: 'Live',
      vehicleType: vehicleType.toUpperCase(), // Exact match
      fcmToken: { $exists: true, $ne: '' },
      notificationEnabled: true
    })
    .select('driverId name phone vehicleType vehicleNumber fcmToken location')
    .lean();

    console.log(`🔍 STRICT: Found ${matchingDrivers.length} drivers with exact vehicle type match: ${vehicleType}`);

    // Log driver details for debugging
    matchingDrivers.forEach(driver => {
      console.log(`   🚗 ${driver.driverId}: ${driver.name} - ${driver.vehicleType} - ${driver.vehicleNumber}`);
    });

    // Prepare notification payload
    const rideNotification = {
      rideId: rideId,
      type: 'NEW_RIDE',
      vehicleType: vehicleType,
      pickupAddress: pickupAddress.substring(0, 50),
      dropoffAddress: dropoffAddress.substring(0, 50),
      estimatedFare: estimatedFare,
      customerName: customerName,
      timestamp: new Date().toISOString(),
      strictVehicleMatch: true
    };

    // Send push notifications
    const fcmTokens = matchingDrivers.map(d => d.fcmToken).filter(t => t && t.length > 10);
    
    if (fcmTokens.length > 0) {
      console.log(`📱 Sending notifications to ${fcmTokens.length} ${vehicleType} drivers`);
      
      try {
        const admin = require('firebase-admin');
        
        if (admin.apps.length === 0) {
          try {
            const serviceAccount = require('./firebase-service-account.json');
            admin.initializeApp({
              credential: admin.credential.cert(serviceAccount)
            });
          } catch (error) {
            console.error('Firebase init error:', error);
          }
        }

        const message = {
          notification: {
            title: `New ${vehicleType} Ride Available`,
            body: `${pickupAddress.substring(0, 30)} → ${dropoffAddress.substring(0, 30)}`
          },
          data: {
            ...rideNotification,
            action: 'accept_ride'
          },
          tokens: fcmTokens,
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'ride_requests'
            }
          },
          apns: {
            payload: {
              aps: {
                alert: {
                  title: `New ${vehicleType} Ride`,
                  body: `Fare: ₹${estimatedFare}`
                },
                sound: 'default',
                badge: 1
              }
            }
          }
        };

        const response = await admin.messaging().sendMulticast(message);
        console.log(`📤 Notifications sent: ${response.successCount} successful, ${response.failureCount} failed`);
        
      } catch (fcmError) {
        console.error('FCM error:', fcmError);
      }
    } else {
      console.log(`⚠️ No FCM tokens found for ${vehicleType} drivers`);
    }

    // ✅ FIXED: Socket.io broadcast to matching drivers ONLY
    const io = req.app.get('io');
    if (io) {
      // Send to each matching driver individually
      matchingDrivers.forEach(driver => {
        io.to(`driver_${driver.driverId}`).emit('newRideRequest', {
          ...rideNotification,
          targetAudience: vehicleType,
          driverCount: matchingDrivers.length
        });
      });
      
      console.log(`📡 Socket notifications sent to ${matchingDrivers.length} ${vehicleType} drivers ONLY`);
    }

    res.json({
      success: true,
      message: `Ride request sent to ${matchingDrivers.length} ${vehicleType} drivers`,
      data: {
        rideId,
        vehicleType,
        driverCount: matchingDrivers.length,
        estimatedFare,
        status: 'searching',
        strictFilter: true
      }
    });

  } catch (error) {
    console.error('❌ Strict ride booking error:', error);
    res.status(500).json({
      success: false,
      error: 'Ride booking failed',
      details: error.message
    });
  }
});

// ✅ ORDER ROUTES
console.log("📦 Loading order routes...");

// ✅ In app.js - Add this endpoint to update driver status without changing vehicle type
app.post('/api/drivers/update-status', async (req, res) => {
  try {
    const { driverId, status, vehicleType, location } = req.body;
    
    console.log(`🔄 Updating driver status: ${driverId} - Status: ${status} - Vehicle: ${vehicleType}`);
    
    const Driver = require('./models/driver/driver');
    
    const updateData = {
      status: status,
      lastUpdate: new Date()
    };

    // ❌ REMOVED: vehicleType should NEVER be updated after admin registration
    // Vehicle type is immutable and set only during admin driver creation
    // if (vehicleType && vehicleType !== "taxi") {
    //   updateData.vehicleType = vehicleType;
    // }
    
    // Update location if provided
    if (location && location.latitude && location.longitude) {
      updateData.location = {
        type: "Point",
        coordinates: [location.longitude, location.latitude]
      };
    }
    
    const driver = await Driver.findOneAndUpdate(
      { driverId: driverId },
      updateData,
      { new: true }
    );
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found"
      });
    }
    
    console.log(`✅ Driver ${driverId} updated: Status=${status}, Vehicle=${driver.vehicleType}`);
    
    res.json({
      success: true,
      message: "Driver status updated",
      driver: {
        driverId: driver.driverId,
        name: driver.name,
        status: driver.status,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber
      }
    });
    
  } catch (error) {
    console.error('❌ Error updating driver status:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update driver status",
      error: error.message
    });
  }
});

// ✅ GET DRIVER STATUS BY DRIVER ID
app.get('/api/drivers/status/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;

    console.log(`🔍 Getting status for driver: ${driverId}`);

    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ driverId })
      .select('driverId name status vehicleType vehicleNumber location fcmToken timerActive remainingWorkingSeconds workingHoursLimit')
      .lean();

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found"
      });
    }

    console.log(`✅ Driver ${driverId} status: ${driver.status}, vehicleType: ${driver.vehicleType}`);

    res.json({
      success: true,
      driver: {
        driverId: driver.driverId,
        name: driver.name,
        status: driver.status || "Offline",
        vehicleType: driver.vehicleType || "taxi",
        vehicleNumber: driver.vehicleNumber,
        location: driver.location,
        fcmToken: driver.fcmToken,
        timerActive: driver.timerActive || false,
        remainingWorkingSeconds: driver.remainingWorkingSeconds || 0,
        workingHoursLimit: driver.workingHoursLimit || 12
      }
    });

  } catch (error) {
    console.error('❌ Error getting driver status:', error);
    res.status(500).json({
      success: false,
      message: "Failed to get driver status",
      error: error.message
    });
  }
});

// ✅ GET AVAILABLE DRIVERS BY VEHICLE TYPE
app.get('/api/drivers/available/:vehicleType', async (req, res) => {
  try {
    const { vehicleType } = req.params;
    
    console.log(`🔍 Looking for available ${vehicleType} drivers`);
    
    const Driver = require('./models/driver/driver');
    
    const drivers = await Driver.find({
      status: 'Live',
      vehicleType: vehicleType.toUpperCase(),
      'location.coordinates.0': { $exists: true, $ne: null },
      'location.coordinates.1': { $exists: true, $ne: null }
    })
    .select('driverId name phone vehicleType vehicleNumber location fcmToken')
    .limit(20);
    
    console.log(`✅ Found ${drivers.length} available ${vehicleType} drivers`);
    
    res.json({
      success: true,
      vehicleType,
      count: drivers.length,
      drivers: drivers.map(d => ({
        driverId: d.driverId,
        name: d.name,
        phone: d.phone,
        vehicleType: d.vehicleType,
        vehicleNumber: d.vehicleNumber,
        hasFCM: !!d.fcmToken,
        location: d.location
      }))
    });
    
  } catch (error) {
    console.error('❌ Error fetching available drivers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================
// ✅ WORKING HOURS MANAGEMENT SYSTEM
// ============================================================
const workingHoursService = require('./services/workingHoursService');

// Start timer when driver goes ONLINE
app.post('/api/drivers/working-hours/start', async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    console.log(`⏱️ Starting working hours timer for driver: ${driverId}`);

    const result = await workingHoursService.startWorkingHoursTimer(driverId);
    res.json(result);

  } catch (error) {
    console.error('❌ Error starting working hours:', error);
    res.status(500).json({ success: false, message: 'Failed to start timer', error: error.message });
  }
});

// Stop timer when driver goes OFFLINE manually
app.post('/api/drivers/working-hours/stop', async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    console.log(`🛑 Stopping working hours timer for driver: ${driverId}`);

    workingHoursService.stopWorkingHoursTimer(driverId);

    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ driverId });
    if (driver) {
      driver.timerActive = false;
      driver.status = "Offline";  // Explicitly set to Offline when driver stops timer
      await driver.save();
    }

    res.json({ success: true, message: 'Timer stopped successfully' });

  } catch (error) {
    console.error('❌ Error stopping working hours:', error);
    res.status(500).json({ success: false, message: 'Failed to stop timer', error: error.message });
  }
});

// Purchase extended hours (₹100 deduction)
app.post('/api/drivers/working-hours/extend', async (req, res) => {
  try {
    const { driverId, additionalHours } = req.body;

    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    console.log(`💰 Processing extended hours purchase for driver: ${driverId}`);

    const result = await workingHoursService.purchaseExtendedHours(driverId, additionalHours || 12);
    res.json(result);

  } catch (error) {
    console.error('❌ Error purchasing extended hours:', error);
    res.status(500).json({ success: false, message: 'Failed to purchase extended hours', error: error.message });
  }
});

// Skip warning (continue without paying)
app.post('/api/drivers/working-hours/skip-warning', async (req, res) => {
  try {
    const { driverId, warningNumber } = req.body;

    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    console.log(`⏭️ Driver ${driverId} skipped warning ${warningNumber}`);

    // Just log the skip - timer continues until all 3 warnings are skipped
    res.json({
      success: true,
      message: 'Warning skipped',
      note: 'Timer continues. ₹100 will be deducted if all warnings are ignored.'
    });

  } catch (error) {
    console.error('❌ Error skipping warning:', error);
    res.status(500).json({ success: false, message: 'Failed to skip warning', error: error.message });
  }
});

// Get timer status
app.get('/api/drivers/working-hours/status/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;

    console.log(`📊 Getting timer status for driver: ${driverId}`);

    const result = await workingHoursService.getTimerStatus(driverId);
    res.json(result);

  } catch (error) {
    console.error('❌ Error getting timer status:', error);
    res.status(500).json({ success: false, message: 'Failed to get timer status', error: error.message });
  }
});

// Pause timer (when driver goes OFFLINE temporarily)
app.post('/api/drivers/working-hours/pause', async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    console.log(`⏸️ Pausing timer for driver: ${driverId}`);

    const result = await workingHoursService.pauseWorkingHoursTimer(driverId);
    res.json(result);

  } catch (error) {
    console.error('❌ Error pausing timer:', error);
    res.status(500).json({ success: false, message: 'Failed to pause timer', error: error.message });
  }
});

// Resume timer (when driver goes ONLINE again)
app.post('/api/drivers/working-hours/resume', async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    console.log(`▶️ Resuming timer for driver: ${driverId}`);

    const result = await workingHoursService.resumeWorkingHoursTimer(driverId);
    res.json(result);

  } catch (error) {
    console.error('❌ Error resuming timer:', error);
    res.status(500).json({ success: false, message: 'Failed to resume timer', error: error.message });
  }
});

// Admin: Update driver working hours limit
app.put('/api/admin/driver/:driverId/working-hours', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { workingHoursLimit } = req.body;

    if (!workingHoursLimit || (workingHoursLimit !== 12 && workingHoursLimit !== 24)) {
      return res.status(400).json({
        success: false,
        message: 'Working hours limit must be either 12 or 24'
      });
    }

    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ driverId });

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    driver.workingHoursLimit = workingHoursLimit;
    await driver.save();

    console.log(`✅ Admin updated working hours limit to ${workingHoursLimit}h for driver ${driverId}`);

    res.json({
      success: true,
      message: 'Working hours limit updated successfully',
      workingHoursLimit
    });

  } catch (error) {
    console.error('❌ Error updating working hours limit:', error);
    res.status(500).json({ success: false, message: 'Failed to update working hours limit', error: error.message });
  }
});

// Add Extra Half Time - Based on Driver's Working Hours Configuration
app.post('/api/drivers/working-hours/add-half-time', async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ driverId });

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const workingHoursLimit = driver.workingHoursLimit || 12;
    let hours, minutes, seconds;

    if (workingHoursLimit === 12) {
      // For 12-hour shift: Add 05:59:59
      hours = 5;
      minutes = 59;
      seconds = 59;
    } else {
      // For 24-hour shift: Add 11:59:59
      hours = 11;
      minutes = 59;
      seconds = 59;
    }

    console.log(`⏱️ Adding extra half time for ${workingHoursLimit}h shift: ${hours}:${minutes}:${seconds}`);

    const deductionAmount = 50; // ₹50 for half time
    const result = await workingHoursService.addExtraTime(driverId, hours, minutes, seconds, deductionAmount, 'half');
    res.json(result);
  } catch (error) {
    console.error('❌ Error adding half time:', error);
    res.status(500).json({ success: false, message: 'Failed to add half time', error: error.message });
  }
});

// Add Extra Full Time - Based on Driver's Working Hours Configuration
app.post('/api/drivers/working-hours/add-full-time', async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ driverId });

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    const workingHoursLimit = driver.workingHoursLimit || 12;
    let hours, minutes, seconds;

    if (workingHoursLimit === 12) {
      // For 12-hour shift: Add 11:59:59
      hours = 11;
      minutes = 59;
      seconds = 59;
    } else {
      // For 24-hour shift: Add 23:59:59
      hours = 23;
      minutes = 59;
      seconds = 59;
    }

    console.log(`⏱️ Adding extra full time for ${workingHoursLimit}h shift: ${hours}:${minutes}:${seconds}`);

    const deductionAmount = 100; // ₹100 for full time
    const result = await workingHoursService.addExtraTime(driverId, hours, minutes, seconds, deductionAmount, 'full');
    res.json(result);
  } catch (error) {
    console.error('❌ Error adding full time:', error);
    res.status(500).json({ success: false, message: 'Failed to add full time', error: error.message });
  }
});

// ============================================================

// ✅ REFRESH DRIVER DATA - Get updated driver info including wallet balance
app.get('/api/drivers/refresh/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    console.log(`🔄 Refreshing driver data for: ${driverId}`);

    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ driverId })
      .select('-passwordHash -__v')
      .lean();

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    console.log(`✅ Driver data refreshed: ${driverId} - Wallet: ₹${driver.wallet}`);

    res.json({
      success: true,
      driver: {
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType || "TAXI",
        vehicleNumber: driver.vehicleNumber || "",
        wallet: driver.wallet || 0,
        status: driver.status,  // Real status from database (required field)
        location: driver.location || { type: 'Point', coordinates: [0, 0] },
        fcmToken: driver.fcmToken || "",
        workingHoursLimit: driver.workingHoursLimit || 12,
        remainingWorkingSeconds: driver.remainingWorkingSeconds || 0,
        timerActive: driver.timerActive || false,
        autoStopEnabled: driver.autoStopEnabled || false
      }
    });

  } catch (error) {
    console.error('❌ Error refreshing driver data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh driver data',
      error: error.message
    });
  }
});

// ✅ AUTO-STOP - Enable auto-stop and disable extra time buttons
app.post('/api/drivers/working-hours/enable-auto-stop', async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) {
      return res.status(400).json({ success: false, message: 'Driver ID required' });
    }

    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOneAndUpdate(
      { driverId },
      { autoStopEnabled: true },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    console.log(`🛑 Auto-stop enabled for driver: ${driverId}`);

    res.json({
      success: true,
      message: 'Auto-stop enabled. Extra time buttons are now disabled.',
      autoStopEnabled: true
    });

  } catch (error) {
    console.error('❌ Error enabling auto-stop:', error);
    res.status(500).json({ success: false, message: 'Failed to enable auto-stop', error: error.message });
  }
});

// ✅ WALLET TRANSACTION HISTORY - Paginated
app.get('/api/drivers/wallet/history/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const Driver = require('./models/driver/driver');
    const Transaction = require('./models/driver/transaction');

    // Find driver
    const driver = await Driver.findOne({ driverId });
    if (!driver) {
      return res.status(404).json({ success: false, message: 'Driver not found' });
    }

    // Get total count
    const totalCount = await Transaction.countDocuments({ driver: driver._id });

    // Get transactions with pagination
    const transactions = await Transaction.find({ driver: driver._id })
      .sort({ date: -1 }) // Latest first
      .skip(skip)
      .limit(limit)
      .lean();

    const totalPages = Math.ceil(totalCount / limit);

    console.log(`📜 Fetched ${transactions.length} transactions for driver ${driverId} (page ${page}/${totalPages})`);

    res.json({
      success: true,
      currentBalance: driver.wallet,
      transactions: transactions.map(tx => ({
        id: tx._id,
        amount: tx.amount,
        type: tx.type, // credit or debit
        method: tx.method,
        description: tx.description,
        date: tx.date,
        displayText: getTransactionDisplayText(tx)
      })),
      pagination: {
        currentPage: page,
        totalPages,
        totalTransactions: totalCount,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });

  } catch (error) {
    console.error('❌ Error fetching wallet history:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch wallet history', error: error.message });
  }
});

// Helper function to generate display text for transactions
function getTransactionDisplayText(transaction) {
  const methodDisplayNames = {
    'shift_start_fee': 'Online Charge',
    'extra_half_time': 'Extra Half Time',
    'extra_full_time': 'Extra Full Time',
    'admin_credit': 'Wallet Add (Admin)',
    'admin_debit': 'Admin Debit',
    'withdrawal': 'Wallet Withdrawal',
    'extended_hours_purchase': 'Extended Hours',
    'extended_hours_auto_debit': 'Auto Extended Hours'
  };

  return methodDisplayNames[transaction.method] || transaction.method;
}

// ============================================================

// ✅ TEST DRIVERS ENDPOINT
app.get('/api/test-drivers', async (req, res) => {
  try {
    const Driver = require('./models/driver/driver');
    const drivers = await Driver.find({}).select('driverId name phone vehicleNumber vehicleType status');
    
    // Group by vehicle type
    const byVehicleType = {};
    drivers.forEach(driver => {
      const type = driver.vehicleType || 'UNKNOWN';
      if (!byVehicleType[type]) {
        byVehicleType[type] = [];
      }
      byVehicleType[type].push(driver);
    });
    
    res.json({
      success: true,
      count: drivers.length,
      byVehicleType,
      drivers: drivers
    });
  } catch (error) {
    console.error('Test drivers error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Driver OTP Request - Live Server Only
app.post('/api/auth/request-driver-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    console.log('📞 Live Server: Driver OTP request for:', phoneNumber);

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    // Clean phone number
    const cleanPhone = phoneNumber.replace('+91', '').replace(/\D/g, '');
    
    // Check if driver exists
    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ 
      $or: [
        { phone: cleanPhone },
        { phoneNumber: cleanPhone }
      ]
    });

    if (!driver) {
      console.log(`❌ Live Server: Driver not found for phone: ${cleanPhone}`);
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found. Please register first or contact admin.',
        contactEmail: 'eazygo2026@gmail.com'
      });
    }

    console.log(`✅ Live Server: Driver found: ${driver.driverId} - ${driver.name} - ${driver.vehicleType}`);
    
    res.json({
      success: true,
      driverId: driver.driverId,
      name: driver.name,
      phone: driver.phone,
      vehicleType: driver.vehicleType,
      vehicleNumber: driver.vehicleNumber,
      wallet: driver.wallet || 0,
      status: driver.status || 'Offline',
      message: 'Driver verified. Proceed with Firebase OTP.'
    });

  } catch (error) {
    console.error('❌ Live Server: Driver OTP request error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during driver verification',
      error: error.message 
    });
  }
});

// ✅ Get Complete Driver Info
app.post('/api/auth/get-complete-driver-info', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    console.log('🔍 COMPLETE: Getting complete driver info for:', phoneNumber);

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required' 
      });
    }

    const cleanPhone = phoneNumber.replace('+91', '').replace(/\D/g, '');
    
    const Driver = require('./models/driver/driver');
    const driver = await Driver.findOne({ 
      $or: [
        { phone: cleanPhone },
        { phoneNumber: cleanPhone }
      ]
    })
    .select('-passwordHash -__v')
    .lean();

    if (!driver) {
      console.log(`❌ COMPLETE: Driver not found for phone: ${cleanPhone}`);
      return res.status(404).json({ 
        success: false, 
        error: 'Driver not found',
        message: 'This driver does not exist in our database. Please register first.'
      });
    }

    console.log(`✅ COMPLETE: Driver found: ${driver.driverId} - ${driver.name} - ${driver.vehicleType}`);

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: driver._id,
        driverId: driver.driverId,
        role: 'driver' 
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '30d' }
    );

    // ✅ Calculate remaining working hours if timer is active
    let workingHoursData = {
      active: false,
      remainingSeconds: 0,
      totalHours: driver.workingHoursLimit || 12
    };

    if (driver.timerActive && driver.onlineStartTime) {
      const now = Date.now();
      const startTime = new Date(driver.onlineStartTime).getTime();
      const elapsedSeconds = Math.floor((now - startTime) / 1000);
      const remaining = Math.max(0, (driver.remainingWorkingSeconds || 0) - elapsedSeconds);

      if (remaining > 0) {
        workingHoursData = {
          active: true,
          remainingSeconds: remaining,
          totalHours: driver.workingHoursLimit || 12
        };
      }
    }

    res.json({
      success: true,
      token: token,
      driver: {
        driverId: driver.driverId,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType || "taxi",
        vehicleNumber: driver.vehicleNumber || "",
        wallet: driver.wallet || 0,
        status: driver.status || "Offline",
        location: driver.location || { type: 'Point', coordinates: [0, 0] },
        fcmToken: driver.fcmToken || "",
        timerActive: driver.timerActive || false,
        remainingWorkingSeconds: workingHoursData.remainingSeconds,
        workingHoursLimit: driver.workingHoursLimit || 12,
        autoStopEnabled: driver.autoStopEnabled || false
      },
      message: 'Complete driver info retrieved successfully'
    });

  } catch (error) {
    console.error('❌ COMPLETE: Get driver info error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get driver info',
      error: error.message 
    });
  }
});

// ✅ SIMPLE TEST ENDPOINT
app.get('/api/orders/test-connection', (req, res) => {
  console.log('🧪 Test connection endpoint hit');
  res.json({ 
    success: true, 
    message: 'Orders API is connected!',
    timestamp: new Date().toISOString()
  });
});

// ✅ ADMIN ORDER ROUTES
app.get('/api/orders/admin/orders', async (req, res) => {
  try {
    console.log('📦 Admin: Fetching all orders');
    
    const Order = require('./models/Order');
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
    if (status && status !== 'all') {
      query.status = status;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalOrders = await Order.countDocuments(query);

    const cleanOrders = orders.map(order => ({
      _id: order._id,
      orderId: order.orderId,
      customerId: order.customerId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      customerAddress: order.customerAddress,
      products: order.products.map(product => ({
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        total: product.price * product.quantity,
        category: product.category
      })),
      totalAmount: order.totalAmount,
      status: order.status,
      paymentMethod: order.paymentMethod,
      orderDate: order.orderDate,
      deliveryAddress: order.deliveryAddress,
      createdAt: order.createdAt
    }));

    console.log(`✅ Admin: Returning ${cleanOrders.length} orders`);

    res.json({
      success: true,
      data: cleanOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        hasNextPage: page < Math.ceil(totalOrders / limit),
        hasPrevPage: page > 1
      }
    });

  } catch (error) {
    console.error('❌ Admin orders error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch orders',
      details: error.message 
    });
  }
});

// ✅ ADMIN ORDER STATS
app.get('/api/orders/admin/order-stats', async (req, res) => {
  try {
    console.log('📊 Admin: Fetching order stats');
    
    const Order = require('./models/Order');
    const Registration = require('./models/user/Registration');
    
    const totalOrders = await Order.countDocuments();
    const deliveredOrders = await Order.countDocuments({ status: 'delivered' });
    const pendingOrders = await Order.countDocuments({ 
      status: { $in: ['order_confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery'] } 
    });
    
    const revenueResult = await Order.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' } } }
    ]);
    
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const customerCount = await Registration.countDocuments();

    console.log(`📊 Stats: ${totalOrders} orders, ${customerCount} customers, ₹${totalRevenue} revenue`);

    res.json({
      success: true,
      data: {
        totalOrders,
        deliveredOrders,
        pendingOrders,
        totalRevenue,
        avgOrderValue,
        customerCount
      }
    });

  } catch (error) {
    console.error('❌ Order stats error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch order statistics',
      details: error.message 
    });
  }
});





// ✅ ADMIN UPDATE ORDER BY ID (Multiple URL patterns for frontend compatibility)
app.put([
  '/api/orders/admin/orders/update/:id',
  '/api/orders/admin/order/update-by-id/:id',
  '/api/orders/admin/update/:id'
], async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log(`📝 Admin: Updating order ${id} with:`, updateData);

    const Order = require('./models/Order');

    // Find and update the order
    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      {
        ...updateData,
        updatedAt: new Date()
      },
      {
        new: true,  // Return the updated document
        runValidators: true  // Run model validators
      }
    );

    if (!updatedOrder) {
      console.error(`❌ Admin: Order ${id} not found`);
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    console.log(`✅ Admin: Order ${id} updated successfully`);

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: updatedOrder
    });

  } catch (error) {
    console.error('❌ Admin: Error updating order:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update order',
      details: error.message
    });
  }
});

// ✅ DIRECT ORDER PLACEMENT (Fix for "User data not found")
app.post(['/api/orders/create', '/api/orders/place-order', '/api/orders'], async (req, res) => {
  try {
    console.log('🛍️ DIRECT ORDER: Received order placement request');
    
    // 1. Auth Check
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, error: "No token provided" });
    }
    
    const token = authHeader.split(" ")[1];
    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
      userId = decoded.id;
    } catch (err) {
      return res.status(401).json({ success: false, error: "Invalid token" });
    }

    // 2. Get User Data
    const Registration = require("./models/user/Registration");
    const user = await Registration.findById(userId);
    
    if (!user) {
      console.error(`❌ DIRECT ORDER: User not found for ID ${userId}`);
      return res.status(404).json({ success: false, error: "User data not found" });
    }

    console.log(`👤 DIRECT ORDER: User verified: ${user.name} (${user.phoneNumber})`);

    // 3. Get Order Data
    const { products, totalAmount, deliveryAddress, paymentMethod } = req.body;
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, error: "No products provided" });
    }

    // 4. Generate Order ID
    const Counter = require("./models/user/customerId");
    let counter = await Counter.findOne({ _id: "orderId" });
    if (!counter) {
        counter = new Counter({ _id: "orderId", sequence: 100000 });
        await counter.save();
    }
    
    const updatedCounter = await Counter.findOneAndUpdate(
      { _id: "orderId" },
      { $inc: { sequence: 1 } },
      { new: true }
    );
    
    const orderId = `ORD${updatedCounter.sequence}`;

    // 5. Create Order
    const Order = require('./models/Order');
    const newOrder = new Order({
      orderId,
      customerId: user.customerId || "N/A",
      customerName: user.name,
      customerPhone: user.phoneNumber,
      customerEmail: user.email,
      customerAddress: user.address,
      userId: user._id,
      products: products,
      totalAmount,
      deliveryAddress: deliveryAddress || user.address,
      paymentMethod: paymentMethod || 'COD',
      status: 'order_confirmed',
      orderDate: new Date(),
      createdAt: new Date()
    });

    await newOrder.save();
    console.log(`✅ DIRECT ORDER: Order ${orderId} created successfully`);

    // 6. Notify Admin via Socket
    const io = req.app.get('io');
    if (io) {
      io.emit('newOrder', {
        orderId,
        customerName: user.name,
        totalAmount,
        timestamp: new Date()
      });
    }

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: newOrder,
      orderId
    });

  } catch (error) {
    console.error('❌ DIRECT ORDER error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to place order',
      details: error.message
    });
  }
});

// ✅ MODELS
const Registration = require("./models/user/Registration");
const Counter = require("./models/user/customerId");
const Driver = require("./models/driver/driver");
const Ride = require("./models/ride");

// ✅ DIRECT AUTH ROUTES
app.post("/api/auth/verify-phone", async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });

    const user = await Registration.findOne({ phoneNumber });
    if (user) {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secret", { expiresIn: "30d" });
      return res.json({
        success: true,
        token,
        user: {
          name: user.name,
          phoneNumber: user.phoneNumber,
          customerId: user.customerId,
          profilePicture: user.profilePicture || ""
        }
      });
    }
    res.json({ success: true, newUser: true });
  } catch (err) {
    console.error("verify-phone error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, phoneNumber, address } = req.body;
    if (!name || !phoneNumber || !address)
      return res.status(400).json({ error: "Name, phone number, and address are required" });

    const existing = await Registration.findOne({ phoneNumber });
    if (existing) return res.status(400).json({ error: "Phone number already registered" });

    const counter = await Counter.findOneAndUpdate(
      { _id: "customerId" },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );
    const customerId = (100000 + counter.sequence).toString();

    const newUser = new Registration({ name, phoneNumber, address, customerId });
    await newUser.save();

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET || "secret", { expiresIn: "30d" });

    res.status(201).json({
      success: true,
      token,
      user: { name, phoneNumber, address, customerId }
    });
  } catch (err) {
    console.error("register error:", err);
    res.status(400).json({ error: err.message });
  }
});

// ✅ WALLET & PROFILE
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
    if (err) return res.status(401).json({ error: "Invalid token" });
    req.userId = decoded.id;
    next();
  });
};

app.get("/api/wallet", authenticateToken, async (req, res) => {
  try {
    const user = await Registration.findById(req.userId);
    res.json({ success: true, wallet: user?.wallet || 0, balance: user?.wallet || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/wallet/balance", authenticateToken, async (req, res) => {
  try {
    const user = await Registration.findById(req.userId);
    res.json({ success: true, wallet: user?.wallet || 0, balance: user?.wallet || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ PAY RIDE ENDPOINT (Wallet Credit - Cashback/Loyalty)
app.post("/api/wallet/pay-ride", authenticateToken, async (req, res) => {
  try {
    const { rideId, amount, paymentMethod } = req.body;
    const userId = req.userId;

    console.log(`💰 PROCESSING RIDE CREDIT: Ride ${rideId}, Amount ${amount}, User ${userId}`);

    // 1. Get User
    const user = await Registration.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const creditAmount = parseFloat(amount);
    if (isNaN(creditAmount)) {
        return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    console.log(`👤 User found: ${user.name}, Current Wallet: ${user.wallet}`);

    // 2. CREDIT User Wallet (Cashback logic: Add ride amount to wallet)
    const previousWallet = user.wallet || 0;
    user.wallet = previousWallet + creditAmount;
    await user.save();
    
    console.log(`✅ Credited ₹${creditAmount} to user ${userId} wallet. New balance: ₹${user.wallet}`);

    // 3. Update Ride Status
    let ride = await Ride.findOne({ RAID_ID: rideId });
    if (!ride && require('mongoose').Types.ObjectId.isValid(rideId)) {
        ride = await Ride.findById(rideId);
    }

    if (ride) {
        ride.paymentStatus = 'paid';
        ride.paymentMethod = paymentMethod || 'cash';
        ride.status = 'completed';
        await ride.save();
        console.log(`✅ Ride ${rideId} payment status updated to 'paid'`);
    }

    // 4. Return Success
    res.json({
      success: true,
      message: "Payment successful",
      newBalance: user.wallet || 0,
      transactionId: `TXN_${Date.now()}`
    });

  } catch (error) {
    console.error("❌ Payment Error:", error);
    res.status(500).json({ success: false, message: "Server error processing payment", error: error.message });
  }
});

// ✅ TEST ENDPOINT: ADD MONEY TO USER WALLET
app.post("/api/wallet/add-money", authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.userId;

    const user = await Registration.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.wallet = (user.wallet || 0) + parseFloat(amount);
    await user.save();

    console.log(`💰 Added ₹${amount} to user ${userId}. New Balance: ₹${user.wallet}`);

    res.json({
      success: true,
      message: "Money added successfully",
      wallet: user.wallet
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/users/profile", authenticateToken, async (req, res) => {
  try {
    console.log(`👤 PROFILE: Fetching data for ${req.userId}`);
    const user = await Registration.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    if (!user) {
      console.error(`❌ PROFILE: User not found in DB for ID ${req.userId}`);
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const backendUrl = process.env.BACKEND_URL || "http://localhost:5001";
    const profilePicture = user.profilePicture
      ? user.profilePicture.startsWith("http")
        ? user.profilePicture
        : `${backendUrl}${user.profilePicture}`
      : "";

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name || "",
        phoneNumber: user.phoneNumber || "",
        customerId: user.customerId || "",
        email: user.email || "",
        address: user.address || "",
        profilePicture,
        gender: user.gender || "",
        dob: user.dob || "",
        altMobile: user.altMobile || "",
        wallet: user.wallet || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ FCM TOKEN UPDATE - ENHANCED WITH VEHICLE TYPE VALIDATION
app.post(["/drivers/update-fcm-token", "/register-fcm-token", "/api/drivers/update-fcm-token"], async (req, res) => {
  try {
    const { driverId, fcmToken, platform = "android", vehicleType } = req.body;
    
    if (!driverId || !fcmToken) {
      return res.status(400).json({ 
        success: false, 
        error: "driverId & fcmToken required" 
      });
    }

    const Driver = require('./models/driver/driver');
    
    const updateData = {
      fcmToken,
      platform,
      lastUpdate: new Date(),
      notificationEnabled: true,
      status: "Live"
    };

    // ❌ REMOVED: vehicleType should NEVER be updated after registration
    // Vehicle type is set by admin during registration and is immutable
    // if (vehicleType && ['port', 'taxi', 'bike'].includes(vehicleType.toLowerCase())) {
    //   updateData.vehicleType = vehicleType.toLowerCase();
    // }
    
    const updated = await Driver.findOneAndUpdate(
      { driverId },
      updateData,
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ 
        success: false, 
        error: "Driver not found" 
      });
    }

    console.log(`✅ FCM updated for driver ${driverId}, Vehicle: ${updated.vehicleType || 'Not set'}`);

    res.json({
      success: true,
      message: "FCM token updated",
      driverId,
      name: updated.name,
      vehicleType: updated.vehicleType
    });
  } catch (err) {
    console.error("FCM update error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ TEST ENDPOINTS
app.get("/api/test-connection", (req, res) => res.json({ 
  success: true, 
  message: "API is live!",
  timestamp: new Date(),
  feature: "Vehicle Type Filtering Enabled"
}));

// ✅ HELPER: Safe Route Loader
function safeRequireRoute(relPath, name = "Route") {
  const fullPath = path.join(__dirname, relPath);
  console.log(`Loading ${name} route from: ${fullPath}`);

  const candidates = [
    `${fullPath}.js`,
    fullPath,
    path.join(fullPath, "index.js"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      console.log(`Found ${name} route: ${c}`);
      try {
        const module = require(c);
        if (typeof module === "function" || module instanceof express.Router) return module;
        if (module && module.router) return module.router;
        if (module && module.default) return module.default;
      } catch (err) {
        console.error(`Failed to load ${name} route:`, err.message);

        return express.Router();

        
      }
      break;
    }
  }

  console.warn(`'${name}' route not found or invalid → skipping`);
  return express.Router();
}

// ✅ LOAD & MOUNT ROUTES
console.log("Loading and mounting routes...");

const adminRoutes = safeRequireRoute("./routes/adminRoutes", "Admin");
const driverRoutes = safeRequireRoute("./routes/driverRoutes", "Driver");
const rideRoutes = safeRequireRoute("./routes/rideRoutes", "Ride");
const groceryRoutes = safeRequireRoute("./routes/groceryRoutes", "Grocery");
const authRoutes = safeRequireRoute("./routes/authRoutes", "Auth");
const userRoutes = safeRequireRoute("./routes/userRoutes", "User");
const walletRoutes = safeRequireRoute("./routes/walletRoutes", "Wallet");
const routeRoutes = safeRequireRoute("./routes/routeRoutes", "Route");
const ridePriceRoutes = safeRequireRoute("./routes/ridePriceRoutes", "Ride Price");
const driverLocationHistoryRoutes = safeRequireRoute("./routes/driverLocationHistoryRoutes", "Driver Location History");
const testRoutes = safeRequireRoute("./routes/testRoutes", "Test");
const notificationRoutes = safeRequireRoute("./routes/notificationRoutes", "Notification");
const bannerRoutes = safeRequireRoute("./routes/Banner", "Banner");

// ✅ ORDER ROUTES
const orderRoutes = safeRequireRoute("./routes/orderRoutes", "Order");
console.log('🔍 Order routes loaded:', orderRoutes ? 'Yes' : 'No');

// ✅ Mount all routes
app.use("/api/admin", adminRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/rides", rideRoutes);
app.use("/api/groceries", groceryRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/admin/ride-prices", ridePriceRoutes);
app.use("/api", driverLocationHistoryRoutes);
app.use("/api/test", testRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/banners", bannerRoutes);

// ✅ Mount order routes
app.use("/api/orders", orderRoutes);

console.log("✅ All routes mounted successfully!");

// ✅ ADDITIONAL DEBUG ENDPOINT FOR VEHICLE TYPE
app.get('/api/debug/vehicle-types', async (req, res) => {
  try {
    const Driver = require('./models/driver/driver');
    
    const stats = await Driver.aggregate([
      {
        $group: {
          _id: '$vehicleType',
          count: { $sum: 1 },
          online: {
            $sum: { $cond: [{ $eq: ['$status', 'Live'] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    const totalDrivers = await Driver.countDocuments();
    const onlineDrivers = await Driver.countDocuments({ status: 'Live' });
    
    res.json({
      success: true,
      totalDrivers,
      onlineDrivers,
      vehicleTypeStats: stats,
      message: 'Vehicle type statistics'
    });
  } catch (error) {
    console.error('Vehicle type debug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ TEST RIDE BOOKING WITH VEHICLE TYPE
app.post('/api/test/ride-vehicle-match', async (req, res) => {
  try {
    const { vehicleType } = req.body;
    
    const Driver = require('./models/driver/driver');
    
    console.log(`🧪 Testing vehicle type matching for: ${vehicleType}`);
    
    // Find drivers with exact vehicle type match
    const exactMatches = await Driver.find({
      vehicleType: vehicleType?.toUpperCase(),
      status: 'Live'
    }).countDocuments();
    
    // Find all online drivers
    const allOnline = await Driver.find({ status: 'Live' }).countDocuments();
    
    // Find drivers with FCM tokens
    const withFCM = await Driver.find({
      vehicleType: vehicleType?.toUpperCase(),
      status: 'Live',
      fcmToken: { $exists: true, $ne: '' }
    }).countDocuments();
    
    res.json({
      success: true,
      test: {
        requestedVehicleType: vehicleType,
        exactVehicleTypeMatches: exactMatches,
        allOnlineDrivers: allOnline,
        matchesWithFCM: withFCM,
        matchPercentage: allOnline > 0 ? ((exactMatches / allOnline) * 100).toFixed(2) + '%' : '0%'
      },
      conclusion: `For ${vehicleType} rides, notifications will be sent to ${exactMatches} drivers (out of ${allOnline} total online drivers)`
    });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ ROOT ENDPOINT
app.get("/", (req, res) => {
  res.json({ 
    message: "Taxi + Grocery App API Running", 
    uptime: process.uptime(), 
    timestamp: new Date().toISOString(),
    features: {
      rideBooking: "Vehicle Type Filtering ENABLED",
      endpoints: {
        adminDrivers: "/api/admin/drivers",
        rideBooking: {
          strict: "/api/rides/book-ride-strict",
          enhanced: "/api/rides/book-ride-enhanced"
        },
        driverStats: "/api/debug/vehicle-types",
        test: "/api/test/ride-vehicle-match"
      }
    }
  });
});

// ✅ ERROR HANDLER
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(err.status || 500).json({
    error: { 
      message: err.message || "Internal Server Error",
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});

// ✅ EXPORT
module.exports = app;

