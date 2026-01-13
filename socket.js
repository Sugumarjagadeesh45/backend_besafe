const { Server } = require("socket.io");
const DriverLocation = require("./models/DriverLocation");
const Driver = require("./models/driver/driver");
const Ride = require("./models/ride");
const RaidId = require("./models/user/raidId");
const UserLocation = require("./models/user/UserLocation");
const Registration = require("./models/user/Registration");
const ridePriceController = require("./controllers/ridePriceController");
const mongoose = require('mongoose');
const { sendNotificationToMultipleDrivers } = require("./services/firebaseService");

// --- GLOBAL VARIABLES ---
let io;
const rides = {};
const activeDriverSockets = new Map();
const processingRides = new Set();
const userLocationTracking = new Map();
const driverLocationIntervals = new Map(); // driverId -> intervalId

// ✅ CRITICAL FIX: Deduplication map to prevent duplicate ride emissions
const recentRideEmissions = new Map(); // rideId -> timestamp

// --- HELPER FUNCTIONS ---

async function sendFCMNotifications(rideData) {
  try {
    console.log('📢 Sending FCM notifications...');
    
    console.log(`🔍 Looking for ${rideData.vehicleType} drivers...`);

    // Get matching drivers (CRITICAL: normalize to lowercase for query)
    const normalizedVehicleType = (rideData.vehicleType || 'taxi').toLowerCase();
    const driversWithFCM = await Driver.find({
      vehicleType: normalizedVehicleType,
      status: { $in: ["Live", "online", "available"] },
      fcmToken: { $exists: true, $ne: null, $ne: '' }
    });

    console.log(`🚗 ${normalizedVehicleType} Drivers FCM: ${driversWithFCM.length}`);
    
    // Send notifications to DRIVERS
    let driverNotificationResult = {
      successCount: 0,
      failureCount: 0,
      errors: []
    };
    
    if (driversWithFCM.length > 0) {
      const driverTokens = driversWithFCM
        .filter(d => d.fcmToken && d.fcmToken.length > 10)
        .map(d => d.fcmToken);
      
      console.log(`📱 Sending to ${driverTokens.length} valid tokens`);
      
      if (driverTokens.length > 0) {
        // ✅ FIX: Remove "sound" from data object
        driverNotificationResult = await sendNotificationToMultipleDrivers(
          driverTokens,
          `🚖 New ${rideData.vehicleType} Ride Request!`,
          `Pickup: ${rideData.pickup?.address?.substring(0, 40)}... | Fare: ₹${rideData.fare}`,
          {
            type: "ride_request",
            rideId: rideData.rideId,
            pickup: JSON.stringify(rideData.pickup || {}),
            drop: JSON.stringify(rideData.drop || {}),
            fare: rideData.fare?.toString() || "0",
            distance: rideData.distance?.toString() || "0",
            vehicleType: rideData.vehicleType || "taxi",
            userName: rideData.userName || "Customer",
            userMobile: rideData.userMobile || "N/A",
            otp: rideData.otp || "0000",
            timestamp: new Date().toISOString(),
            priority: "high",
            click_action: "FLUTTER_NOTIFICATION_CLICK"
          }
        );
      } else {
        console.log('⚠️ No valid FCM tokens found');
      }
    } else {
      console.log(`⚠️ No ${rideData.vehicleType} drivers found with FCM tokens`);
    }
    
    return {
      success: driverNotificationResult.successCount > 0,
      driversNotified: driverNotificationResult.successCount,
      totalDrivers: driversWithFCM.length,
      fcmSent: driverNotificationResult.successCount > 0,
      fcmMessage: driversWithFCM.length > 0 
        ? `${driverNotificationResult.successCount}/${driversWithFCM.length} ${rideData.vehicleType} drivers notified` 
        : `No ${rideData.vehicleType} drivers available with FCM tokens`,
      details: {
        vehicleType: rideData.vehicleType,
        driversCount: driversWithFCM.length,
        fcmResult: driverNotificationResult
      }
    };
    
  } catch (error) {
    console.error('❌ ERROR IN FCM NOTIFICATION SYSTEM:', error);
    return {
      success: false,
      error: error.message,
      fcmSent: false,
      fcmMessage: `FCM error: ${error.message}`
    };
  }
}

const broadcastPricesToAllUsers = () => {
  try {
    const currentPrices = ridePriceController.getCurrentPrices();
    console.log('💰 BROADCASTING PRICES TO ALL USERS:', currentPrices);
   
    if (io) {
      io.emit('priceUpdate', currentPrices);
      io.emit('currentPrices', currentPrices);
      console.log('✅ Prices broadcasted to all connected users');
    }
  } catch (error) {
    console.error('❌ Error broadcasting prices:', error);
  }
};

const logDriverStatus = () => {
  console.log("\n📊 === CURRENT DRIVER STATUS ===");
  if (activeDriverSockets.size === 0) {
    console.log("❌ No drivers currently online");
  } else {
    console.log(`✅ ${activeDriverSockets.size} drivers currently online:`);
    activeDriverSockets.forEach((driver, driverId) => {
      const timeSinceUpdate = Math.floor((Date.now() - driver.lastUpdate) / 1000);
      console.log(` 🚗 ${driver.driverName} (${driverId})`);
      console.log(` Status: ${driver.status}`);
      console.log(` Vehicle: ${driver.vehicleType}`);
      console.log(` Location: ${driver.location.latitude.toFixed(6)}, ${driver.location.longitude.toFixed(6)}`);
      console.log(` Last update: ${timeSinceUpdate}s ago`);
      console.log(` Socket: ${driver.socketId}`);
      console.log(` Online: ${driver.isOnline ? 'Yes' : 'No'}`);
    });
  }
  console.log("================================\n");
};

const logRideStatus = () => {
  console.log("\n🚕 === CURRENT RIDE STATUS ===");
  const rideEntries = Object.entries(rides);
  if (rideEntries.length === 0) {
    console.log("❌ No active rides");
  } else {
    console.log(`✅ ${rideEntries.length} active rides:`);
    rideEntries.forEach(([rideId, ride]) => {
      console.log(` 📍 Ride ${rideId}:`);
      console.log(` Status: ${ride.status}`);
      console.log(` Driver: ${ride.driverId || 'Not assigned'}`);
      console.log(` User ID: ${ride.userId}`);
      console.log(` Customer ID: ${ride.customerId}`);
      console.log(` User Name: ${ride.userName}`);
      console.log(` User Mobile: ${ride.userMobile}`);
      console.log(` Pickup: ${ride.pickup?.address || ride.pickup?.lat + ',' + ride.pickup?.lng}`);
      console.log(` Drop: ${ride.drop?.address || ride.drop?.lat + ',' + ride.drop?.lng}`);
     
      if (userLocationTracking.has(ride.userId)) {
        const userLoc = userLocationTracking.get(ride.userId);
        console.log(` 📍 USER CURRENT/LIVE LOCATION: ${userLoc.latitude}, ${userLoc.longitude}`);
        console.log(` 📍 Last location update: ${new Date(userLoc.lastUpdate).toLocaleTimeString()}`);
      } else {
        console.log(` 📍 USER CURRENT/LIVE LOCATION: Not available`);
      }
    });
  }
  console.log("================================\n");
};

const logUserLocationUpdate = (userId, location, rideId) => {
  console.log(`\n📍 === USER LOCATION UPDATE ===`);
  console.log(`👤 User ID: ${userId}`);
  console.log(`🚕 Ride ID: ${rideId}`);
  console.log(`🗺️ Current Location: ${location.latitude}, ${location.longitude}`);
  console.log(`⏰ Update Time: ${new Date().toLocaleTimeString()}`);
  console.log("================================\n");
};

const saveUserLocationToDB = async (userId, latitude, longitude, rideId = null) => {
  try {
    const userLocation = new UserLocation({
      userId,
      latitude,
      longitude,
      rideId,
      timestamp: new Date()
    });
   
    await userLocation.save();
    console.log(`💾 Saved user location to DB: User ${userId}, Ride ${rideId}, Location: ${latitude}, ${longitude}`);
    return true;
  } catch (error) {
    console.error("❌ Error saving user location to DB:", error);
    return false;
  }
};

async function testRaidIdModel() {
  try {
    console.log('🧪 Testing RaidId model...');
    const testDoc = await RaidId.findOne({ _id: 'raidId' });
    console.log('🧪 RaidId document:', testDoc);
   
    if (!testDoc) {
      console.log('🧪 Creating initial RaidId document');
      const newDoc = new RaidId({ _id: 'raidId', sequence: 100000 });
      await newDoc.save();
      console.log('🧪 Created initial RaidId document');
    }
  } catch (error) {
    console.error('❌ Error testing RaidId model:', error);
  }
}

async function generateSequentialRaidId() {
  try {
    console.log('🔢 Starting RAID_ID generation');
   
    const raidIdDoc = await RaidId.findOneAndUpdate(
      { _id: 'raidId' },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );
   
    console.log('🔢 RAID_ID document:', raidIdDoc);
    let sequenceNumber = raidIdDoc.sequence;
    console.log('🔢 Sequence number:', sequenceNumber);
    
    if (sequenceNumber > 999999) {
      console.log('🔄 Resetting sequence to 100000');
      await RaidId.findOneAndUpdate(
        { _id: 'raidId' },
        { sequence: 100000 }
      );
      sequenceNumber = 100000;
    }
    
    const formattedSequence = sequenceNumber.toString().padStart(6, '0');
    const raidId = `RID${formattedSequence}`;
    console.log(`🔢 Generated RAID_ID: ${raidId}`);
   
    return raidId;
  } catch (error) {
    console.error('❌ Error generating sequential RAID_ID:', error);
   
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const fallbackId = `RID${timestamp}${random}`;
    console.log(`🔄 Using fallback ID: ${fallbackId}`);
   
    return fallbackId;
  }
}

async function saveDriverLocationToDB(driverId, driverName, latitude, longitude, vehicleType, status = "Live") {
  try {
    // ✅ FIX: Normalize status for DriverLocation enum (Offline -> offline)
    let finalStatus = status;
    if (status === "Offline") finalStatus = "offline";
    
    const locationDoc = new DriverLocation({
      driverId,
      driverName,
      latitude,
      longitude,
      vehicleType,
      status: finalStatus,
      timestamp: new Date()
    });
   
    await locationDoc.save();
    console.log(`💾 Saved location for driver ${driverId} (${driverName}) to database with status: ${finalStatus}`);
    return true;
  } catch (error) {
    console.error("❌ Error saving driver location to DB:", error);
    return false;
  }
}

function broadcastDriverLocationsToAllUsers() {
  const drivers = Array.from(activeDriverSockets.values())
    .filter(driver => driver.isOnline)
    .map(driver => ({
      driverId: driver.driverId,
      name: driver.driverName,
      location: {
        coordinates: [driver.location.longitude, driver.location.latitude]
      },
      vehicleType: driver.vehicleType,
      status: driver.status,
      lastUpdate: driver.lastUpdate
    }));
 
  if (drivers.length > 0) {
    io.emit("driverLocationsUpdate", { drivers });
    console.log(`📡 Broadcasting ${drivers.length} drivers to all users`);
  }
}

const broadcastDriverLocationsContinuously = () => {
  setInterval(() => {
    const now = Date.now();
    // ✅ REMOVE vehicle type filtering - broadcast ALL drivers
    const drivers = Array.from(activeDriverSockets.values())
      // ✅ FIX: Only broadcast drivers who are Online AND have updated recently (e.g. < 60s)
      .filter(driver => driver.isOnline && (now - driver.lastUpdate < 60000))
      .map(driver => ({
        driverId: driver.driverId,
        name: driver.driverName,
        location: {
          coordinates: [driver.location.longitude, driver.location.latitude]
        },
        vehicleType: driver.vehicleType,
        status: driver.status,
        lastUpdate: driver.lastUpdate
      }));
    
    if (drivers.length > 0) {
      io.emit("driverLocationsUpdate", { drivers });
      console.log(`📡 Broadcasting ${drivers.length} drivers to all users`);
    }
  }, 3000);
};

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c * 1000; // Return in meters
}

// Helper function to convert bearing to direction
function getBearingDirection(bearing) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
}

// --- INIT FUNCTION ---

const init = (server) => {
  // Create Socket.IO instance from HTTP server
  // Note: const { Server } = require("socket.io"); is already at top of file

  io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins during development
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  allowEIO3: true // Add this for compatibility
});

  console.log('✅ Socket.IO server initialized successfully');

  testRaidIdModel();

  setInterval(() => {
    console.log(`\n⏰ ${new Date().toLocaleString()} - Server Status Check`);
    logDriverStatus();
    logRideStatus();
  }, 2000);

  setTimeout(() => {
    console.log('🚀 Server started, broadcasting initial prices...');
    broadcastPricesToAllUsers();
  }, 3000);

  // Start broadcasting driver locations continuously
  broadcastDriverLocationsContinuously();

  // ✅ MAIN CONNECTION BLOCK
  io.on("connection", (socket) => {
    console.log(`\n⚡ New client connected: ${socket.id || 'unknown'}`);
    console.log(`📱 Total connected clients: ${io.engine?.clientsCount || 'unknown'}`);
   
    console.log('💰 Sending current prices to new client:', socket.id);
    try {
      const currentPrices = ridePriceController.getCurrentPrices();
      console.log('💰 Current prices from controller:', currentPrices);
      socket.emit('currentPrices', currentPrices);
      socket.emit('priceUpdate', currentPrices);
    } catch (error) {
      console.error('❌ Error sending prices to new client:', error);
    }

    // ✅ MOVED HERE: driverAcceptedRideWithData handler
    socket.on("driverAcceptedRideWithData", async (data, callback) => {
      try {
        const { rideId, driverId, userId, userData } = data;
        
        console.log(`📦 Driver sending complete user data for ride: ${rideId}`);
        
        // Update ride with user data
        const ride = await Ride.findOneAndUpdate(
          { RAID_ID: rideId },
          {
            $set: {
              status: "accepted",
              driverId: driverId,
              userData: userData, // Store complete user data
              userDataComplete: true,
              acceptedAt: new Date()
            }
          },
          { new: true }
        );

        if (!ride) {
          return callback({ success: false, message: "Ride not found" });
        }

        // CRITICAL: Send COMPLETE user data back to driver for confirmation
        callback({
          success: true,
          userData: userData,
          rideId: rideId,
          message: "User data confirmed and stored"
        });

        // Also send to user app with driver details
        if (ride.user) {
          const userRoom = ride.user.toString();
          io.to(userRoom).emit("rideAcceptedWithData", {
            success: true,
            rideId: rideId,
            driverId: driverId,
            driverName: data.driverName,
            userData: userData, // Send back for verification
            timestamp: new Date().toISOString()
          });
        }

      } catch (error) {
        console.error("❌ Error in driverAcceptedRideWithData:", error);
        callback({ success: false, message: error.message });
      }
    });

    socket.on("requestDriverLocations", ({ latitude, longitude, radius, vehicleType }) => {
      try {
        console.log(`🔍 User requested drivers near: ${latitude}, ${longitude}`);
        
        // ✅ REMOVED: Vehicle type filtering - show ALL nearby drivers
        const drivers = Array.from(activeDriverSockets.values())
          .filter(driver => {
            // Check if within radius only
            const driverLat = driver.location.latitude;
            const driverLng = driver.location.longitude;
            
            // Simple distance calculation
            const latDiff = Math.abs(driverLat - latitude) * 111;
            const lngDiff = Math.abs(driverLng - longitude) * 111 * Math.cos(latitude * Math.PI/180);
            const distance = Math.sqrt(latDiff*latDiff + lngDiff*lngDiff);
            
            return distance <= (radius / 1000);
          })
          .slice(0, 10) // Limit to 10 drivers as requested
          .map(driver => ({
            driverId: driver.driverId,
            name: driver.driverName,
            location: {
              coordinates: [driver.location.longitude, driver.location.latitude]
            },
            vehicleType: driver.vehicleType,
            status: driver.status,
            lastUpdate: driver.lastUpdate
          }));
        
        console.log(`✅ Sending ${drivers.length} drivers to user (ALL vehicle types)`);
        socket.emit("driverLocationsResponse", { drivers });
        
      } catch (error) {
        console.error("❌ Error processing driver location request:", error);
        socket.emit("driverLocationsResponse", { drivers: [] });
      }
    });

    // 2. Driver location update handler (continuous updates)
    socket.on("driverLocationUpdate", async (data) => {
      try {
        const { driverId, latitude, longitude, status } = data;
      
        if (activeDriverSockets.has(driverId)) {
          const driverData = activeDriverSockets.get(driverId);
          driverData.location = { latitude, longitude };
          driverData.lastUpdate = Date.now();
          driverData.status = status || "Live";
          driverData.isOnline = true;
          activeDriverSockets.set(driverId, driverData);
          
          // Emit live location update to all users
          io.emit("driverLiveLocationUpdate", {
            driverId: driverId,
            lat: latitude,
            lng: longitude,
            status: status || "Live",
            vehicleType: driverData.vehicleType,
            timestamp: Date.now()
          });
        }
      
        // Save to database
        const driverData = activeDriverSockets.get(driverId);
        // ✅ FIX: Check if driverData exists before accessing properties
        if (driverData) {
          await saveDriverLocationToDB(
            driverId,
            driverData.driverName || "Unknown",
            latitude,
            longitude,
            driverData.vehicleType,
            status || "Live"
          );
        }
      
      } catch (error) {
        console.error("❌ Error processing driver location update:", error);
      }
    });

    socket.on("retryFCMNotification", async (data, callback) => {
      try {
        const { rideId, retryCount } = data;

        console.log(`🔄 FCM retry attempt #${retryCount} for ride: ${rideId}`);

        const ride = await Ride.findOne({ RAID_ID: rideId });
        if (!ride) {
          return callback?.({
            success: false,
            message: "Ride not found",
          });
        }

        const driversWithFCM = await Driver.find({
          status: "Live",
          fcmToken: { $exists: true, $ne: null, $ne: "" },
        });

        if (driversWithFCM.length === 0) {
          return callback?.({
            success: false,
            message: "No drivers with FCM tokens",
          });
        }

        const tokens = driversWithFCM.map(d => d.fcmToken);

        const notificationData = {
          type: "ride_request",
          rideId,
          pickup: JSON.stringify(ride.pickup),
          drop: JSON.stringify(ride.drop),
          fare: String(ride.fare),
          distance: ride.distance,
          vehicleType: ride.rideType,
          userName: ride.name,
          userMobile: ride.userMobile,
          isRetry: true,
          retryCount,
          timestamp: new Date().toISOString(),
        };

        const result = await sendNotificationToMultipleDrivers(
          tokens,
          "🚖 Ride Request (Retry)",
          `Retry #${retryCount} | Fare ₹${ride.fare}`,
          notificationData
        );

        callback?.({
          success: result.successCount > 0,
          driversNotified: result.successCount,
          message:
            result.successCount > 0
              ? "Retry successful"
              : "Retry failed",
        });

      } catch (error) {
        console.error("❌ retryFCMNotification error:", error);
        callback?.({ success: false, message: error.message });
      }
    });

    // 3. Alternative driver live location update handler
    socket.on("driverLiveLocationUpdate", async ({ driverId, driverName, lat, lng }) => {
      try {
        if (activeDriverSockets.has(driverId)) {
          const driverData = activeDriverSockets.get(driverId);
          driverData.location = { latitude: lat, longitude: lng };
          driverData.lastUpdate = Date.now();
          driverData.isOnline = true;
          activeDriverSockets.set(driverId, driverData);
        
          await saveDriverLocationToDB(driverId, driverName, lat, lng, driverData.vehicleType);
        
          // Emit live location update to all users
          io.emit("driverLiveLocationUpdate", {
            driverId: driverId,
            lat: lat,
            lng: lng,
            status: driverData.status,
            vehicleType: driverData.vehicleType,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        console.error("❌ Error updating driver location:", error);
      }
    });

    socket.on('registerUser', ({ userId, userMobile, rideId }) => {
      if (!userId) {
        console.error('❌ No userId provided for user registration');
        return;
      }

      socket.userId = userId.toString();
      const userRoom = userId.toString();
      socket.join(userRoom);

      console.log(`\n👤 ===== USER REGISTERED =====`);
      console.log(`   User ID: ${userId}`);
      console.log(`   Mobile: ${userMobile || 'N/A'}`);
      console.log(`   Ride ID: ${rideId || 'No active ride'}`);
      console.log(`   Socket ID: ${socket.id}`);
      console.log(`   Joined Room: ${userRoom}`);
      console.log(`============================\n`);

      // Send confirmation to user
      socket.emit('userRegistered', {
        success: true,
        userId: userId,
        message: 'Connected to location tracking system',
        timestamp: Date.now()
      });
    });

    // ✅ NEW: User requests driver location for active ride
    socket.on('requestDriverLocation', async ({ rideId, userId }) => {
      try {
        // console.log(`\n🔍 ===== USER REQUESTING DRIVER LOCATION =====`);
        // console.log(`   User ID: ${userId}`);
        // console.log(`   Ride ID: ${rideId}`);

        // Find the active ride
        const ride = await Ride.findOne({
          RAID_ID: rideId,
          status: { $in: ['accepted', 'arrived', 'started', 'ongoing'] }
        });

        if (!ride) {
          // console.log(`   ⚠️  No active ride found with ID: ${rideId}`);
          socket.emit('driverLocationNotFound', {
            rideId,
            message: 'Ride not found or not active'
          });
          return;
        }

        const driverId = ride.driverId || (ride.driver ? ride.driver.toString() : null);
        console.log(`   Driver ID: ${driverId}`);

        // Get driver location from active sockets
        const driverData = activeDriverSockets.get(driverId);

        if (driverData && driverData.location) {
          console.log(`   ✅ Driver found - sending location`);
          console.log(`   Location: ${driverData.location.latitude.toFixed(6)}, ${driverData.location.longitude.toFixed(6)}`);

          // Send current driver location to user
          socket.emit('driverLocationUpdate', {
            rideId: rideId,
            driverId: driverId,
            driverName: driverData.driverName,
            lat: driverData.location.latitude,
            lng: driverData.location.longitude,
            bearing: driverData.bearing || 0,
            speed: driverData.speed || 0,
            status: driverData.status,
            vehicleType: driverData.vehicleType,
            timestamp: Date.now()
          });
          console.log(`   ✅ Location sent to user`);
        } else {
          console.log(`   ⚠️  Driver ${driverId} not in active sockets`);
          socket.emit('driverLocationNotFound', {
            rideId,
            driverId,
            message: 'Driver location not available'
          });
        }
        console.log(`=============================================\n`);

      } catch (error) {
        console.error('❌ Error fetching driver location:', error);
        socket.emit('driverLocationError', {
          rideId,
          error: error.message
        });
      }
    });

    
    socket.on("registerDriver", async ({ driverId, driverName, latitude, longitude, vehicleType }) => {
      try {
        console.log(`📝 DRIVER REGISTRATION REQUEST: ${driverName} (${driverId})`);
        console.log(`   - Frontend sent vehicleType: ${vehicleType || 'not provided'}`);

        // ✅ CRITICAL: Get ACTUAL vehicle type from database
        const driver = await Driver.findOne({ driverId });
        
        let actualVehicleType = 'taxi'; // Default fallback
        
        if (driver) {
          actualVehicleType = driver.vehicleType || 'taxi';
          console.log(`   - Database vehicleType: ${actualVehicleType}`);
        } else {
          console.log(`   - Driver not found in DB, using frontend type: ${vehicleType || 'taxi'}`);
          actualVehicleType = vehicleType || 'taxi';
        }
        
        // Normalize to lowercase
        actualVehicleType = actualVehicleType.toLowerCase();
        console.log(`   - FINAL vehicleType: ${actualVehicleType}`);

        // ✅ CRITICAL FIX: ALWAYS use DB vehicle type, never frontend type
        activeDriverSockets.set(driverId, {
          driverId,
          driverName,
          location: { latitude, longitude },
          vehicleType: actualVehicleType,  // ✅ Always use DB type
          status: 'Live',
          socketId: socket.id,
          lastUpdate: Date.now(),
          isOnline: true
        });

        // ✅ Join vehicle-specific room
        const vehicleRoom = `drivers_${actualVehicleType}`;
        socket.join(vehicleRoom);
        console.log(`🚪 Driver ${driverId} joined room: ${vehicleRoom}`);

        // Update database status
        await Driver.findOneAndUpdate(
          { driverId },
          {
            $set: {
              status: 'Live',
              location: {
                type: 'Point',
                coordinates: [longitude, latitude]
              },
              lastUpdate: new Date()
            }
            // ❌ NEVER update vehicleType here - it's set by admin only
          },
          { new: true }
        );

        console.log(`✅ Driver ${driverId} registered as ${actualVehicleType} (status: Live)`);

        // ✅ Broadcast this driver's location to ALL users immediately
        io.emit("driverLocationsUpdate", {
          drivers: [{
            driverId,
            name: driverName,
            location: {
              coordinates: [longitude, latitude]
            },
            vehicleType: actualVehicleType,
            status: 'Live',
            lastUpdate: Date.now()
          }]
        });
        
      } catch (error) {
        console.error("❌ Error registering driver:", error);
      }
    });

    socket.on("driverGoOnline", async ({ driverId, latitude, longitude, vehicleType }) => {
      try {
        console.log(`🟢 Driver ${driverId} going online`);
        
        if (activeDriverSockets.has(driverId)) {
          const driverData = activeDriverSockets.get(driverId);
          driverData.location = { latitude, longitude };
          driverData.status = 'Live';
          driverData.isOnline = true;
          activeDriverSockets.set(driverId, driverData);

          // ✅ CRITICAL FIX: Join vehicle-specific room
          const vehicleRoom = `drivers_${driverData.vehicleType}`;
          socket.join(vehicleRoom);
          console.log(`🚪 Driver ${driverId} joined room: ${vehicleRoom} (goOnline)`);

          // ✅ BROADCAST location ONLY when driver goes online
          io.emit("driverLocationsUpdate", {
            drivers: [{
              driverId,
              name: driverData.driverName,
              location: {
                coordinates: [longitude, latitude]
              },
              vehicleType: driverData.vehicleType,
              status: 'Live',
              lastUpdate: Date.now()
            }]
          });
          
          // Update database
          await saveDriverLocationToDB(
            driverId,
            driverData.driverName,
            latitude,
            longitude,
            vehicleType,
            "Live"
          );
          
          console.log(`✅ Driver ${driverId} is now online and broadcasting location`);
        }
      } catch (error) {
        console.error("❌ Error processing driver online:", error);
      }
    });

    socket.on("driverCompletedRide", async (data, callback) => {
      try {
        const { rideId, driverId, distance, fare, actualPickup, actualDrop } = data;
        
        console.log(`🏁 Processing ride completion for: ${rideId}`);
        
        // Update ride in database
        const ride = await Ride.findOne({ RAID_ID: rideId });
        if (!ride) {
          console.error(`❌ Ride ${rideId} not found`);
          return callback?.({ 
            success: false, 
            message: "Ride not found" 
          });
        }
        
        // ✅ STRICT FARE CALCULATION (Backend Verification)
        const vehicleType = (ride.rideType || ride.vehicleType || 'taxi').toLowerCase();
        const distanceKm = parseFloat(distance) || 0;
        
        let pricePerKm = 0;
        try {
            const currentPrices = ridePriceController.getCurrentPrices();
            console.log(`💰 Admin Prices for Calculation:`, currentPrices);
            pricePerKm = currentPrices[vehicleType] || 0;
        } catch (e) {
            console.error("Error getting prices for calculation:", e);
        }

        // Fallback prices if 0
        if (!pricePerKm) {
            pricePerKm = vehicleType === 'bike' ? 15 :
                         vehicleType === 'taxi' ? 40 : 75;
        }

        // Final Fare = Distance * Price (No extra charges)
        const calculatedFare = Math.round(distanceKm * pricePerKm);
        
        console.log(`💰 FARE CALCULATION: ${distanceKm}km * ₹${pricePerKm} = ₹${calculatedFare}`);
        console.log(`   (Frontend sent: ₹${fare})`);
        
        const finalFare = calculatedFare;

        // Update ride status with VERIFIED fare
        ride.status = 'completed';
        ride.completedAt = new Date();
        ride.actualDistance = distance;
        ride.actualFare = finalFare; // ✅ Use verified fare
        ride.actualPickup = actualPickup;
        ride.actualDrop = actualDrop;
        await ride.save();
        
        // ✅ Update driver status to Live AND Credit Wallet
        const updatedDriver = await Driver.findOneAndUpdate(
          { driverId: driverId },
          {
            status: 'Live',
            lastUpdate: new Date(),
            $inc: { wallet: parseFloat(finalFare) || 0 } // 💰 Credit verified fare
          },
          { new: true } // ✅ Return updated document to get new balance
        );

        
        // Get user ID from ride
        const userId = ride.user?.toString() || ride.userId;
        
        // ✅ UPDATE USER WALLET & NOTIFY
        if (userId) {
          try {
            const user = await Registration.findById(userId);
            if (user) {
              // ✅ DEDUCT FROM USER WALLET IF PAYMENT METHOD IS 'WALLET'
              if (ride.paymentMethod && ride.paymentMethod.toLowerCase() === 'wallet') {
                 const deduction = parseFloat(finalFare) || 0;
                 user.wallet = (user.wallet || 0) - deduction;
                 await user.save();
                 console.log(`💰 Deducted ₹${deduction} from User ${userId} (Payment: Wallet)`);
              }

              // Emit real-time wallet update to user so UI updates immediately
              io.to(userId).emit("walletUpdate", {
                balance: user.wallet || 0,
                wallet: user.wallet || 0
              });
            }
          } catch (walletError) {
            console.error("❌ Error syncing wallet in socket:", walletError);
          }
        }

        if (userId) {
          const userRoom = userId.toString();
          
          // 1. Emit rideCompleted (Main event)
          io.to(userRoom).emit("rideCompleted", {
            rideId: rideId,
            distance: `${distance} km`,
            charge: finalFare,
            fare: finalFare,
            driverName: ride.driverName || "Driver",
            vehicleType: ride.rideType || "bike",
            timestamp: new Date().toISOString(),
            status: "completed"
          });

          // 2. Emit billAlert (CRITICAL: Triggers Bill Modal in User App)
          io.to(userRoom).emit("billAlert", {
            type: "bill",
            rideId: rideId,
            distance: `${distance} km`,
            fare: finalFare,
            driverName: ride.driverName || "Driver",
            vehicleType: ride.rideType || "bike",
            actualPickup: actualPickup,
            actualDrop: actualDrop,
            timestamp: new Date().toISOString(),
            message: "Ride completed! Here's your bill.",
            showBill: true,
            priority: "high"
          });

          // 3. Emit rideStatusUpdate (CRITICAL: Updates App State to 'completed')
          io.to(userRoom).emit("rideStatusUpdate", {
            rideId: rideId,
            status: "completed",
            newStatus: "completed",
            fare: finalFare,
            distance: distance,
            timestamp: new Date().toISOString(),
            message: "Ride completed successfully",
            otpVerified: true,
            completed: true
          });
        }
        
        // ✅ CRITICAL: Send success response back to driver
        callback?.({ 
          success: true, 
          message: "Ride completed successfully",
          rideId: rideId,
          fare: finalFare,
          distance: distance,
          newWalletBalance: updatedDriver ? updatedDriver.wallet : 0 // ✅ SEND NEW BALANCE TO DRIVER APP
        });
        
        // ✅ CLEANUP: Remove ride from memory after completion to prevent memory leak
        if (rides[rideId]) {
          delete rides[rideId];
          console.log(`🧹 Removed ride ${rideId} from memory (completed)`);
        }
        
      } catch (error) {
        console.error("Error in driverCompletedRide:", error);
        callback?.({ 
          success: false, 
          message: error.message || "Server error" 
        });
      }
    });

    socket.on("driverOffline", async ({ driverId }) => {
      try {
        console.log(`🔴 Driver ${driverId} going offline`);
        
        if (activeDriverSockets.has(driverId)) {
          const driverData = activeDriverSockets.get(driverId);
          driverData.status = 'offline';
          driverData.isOnline = false;
          activeDriverSockets.set(driverId, driverData);
          
          // Update database
          await saveDriverLocationToDB(
            driverId,
            driverData.driverName,
            driverData.location.latitude,
            driverData.location.longitude,
            driverData.vehicleType,
            "offline"
          );
          
          console.log(`✅ Driver ${driverId} marked as offline`);
        }
      } catch (error) {
        console.error("❌ Error processing driver offline:", error);
      }
    });

    socket.on("requestNearbyDrivers", ({ latitude, longitude, radius = 5000, vehicleType }) => {
      try {
        console.log(`\n🔍 USER REQUESTED NEARBY DRIVERS: ${socket.id}`);
        console.log(`🚗 Vehicle filter: ${vehicleType || 'All vehicles'}`);
        
        const drivers = Array.from(activeDriverSockets.values())
          .filter(driver => {
            // Check if within radius only
            const driverLat = driver.location.latitude;
            const driverLng = driver.location.longitude;
            
            const latDiff = Math.abs(driverLat - latitude) * 111;
            const lngDiff = Math.abs(driverLng - longitude) * 111 * Math.cos(latitude * Math.PI/180);
            const distance = Math.sqrt(latDiff*latDiff + lngDiff*lngDiff);
            
            return distance <= (radius / 1000);
          })
          .slice(0, 10) // Limit to 10 drivers
          .map(driver => ({
            driverId: driver.driverId,
            name: driver.driverName,
            location: {
              coordinates: [driver.location.longitude, driver.location.latitude]
            },
            vehicleType: driver.vehicleType,
            status: driver.status,
            lastUpdate: driver.lastUpdate
          }));

        console.log(`📊 Available drivers: ${drivers.length} (ALL TYPES)`);
        socket.emit("nearbyDriversResponse", { drivers });
      } catch (error) {
        console.error("❌ Error fetching nearby drivers:", error);
        socket.emit("nearbyDriversResponse", { drivers: [] });
      }
    });

    socket.on("bookRide", async (data, callback) => {
      let rideId;
      try {
        console.log('🚨 ===== REAL USER RIDE BOOKING =====');
        console.log('📦 User App Data:', {
          userId: data.userId,
          customerId: data.customerId, 
          vehicleType: data.vehicleType,
          _source: data._source || 'unknown'
        });

        const { userId, customerId, userName, userMobile, pickup, drop, vehicleType, estimatedPrice, distance, travelTime, wantReturn } = data;
        console.log('📥 Received bookRide request');

        // ✅ CRITICAL FIX: Normalize vehicle type to LOWERCASE (matches database schema)
        const normalizedVehicleType = (vehicleType || 'taxi').toLowerCase();
        console.log(`🚗 Vehicle Type: ${vehicleType} -> Normalized: ${normalizedVehicleType}`);
        
        const distanceKm = parseFloat(distance);
        console.log(`📏 Backend calculating price for ${distanceKm}km ${normalizedVehicleType}`);
       
        // ✅ FIX: Make sure calculateRidePrice returns a number
        let backendCalculatedPrice;
        try {
          backendCalculatedPrice = await ridePriceController.calculateRidePrice(normalizedVehicleType, distanceKm);
          console.log(`💰 Admin Price Calculation: Type=${normalizedVehicleType}, Dist=${distanceKm}, Price=${backendCalculatedPrice}`);
          if (isNaN(backendCalculatedPrice) || backendCalculatedPrice <= 0) {
            console.warn(`⚠️ Invalid price returned: ${backendCalculatedPrice}, using fallback`);
            // Calculate fallback price (lowercase comparison)
            const pricePerKm = normalizedVehicleType === 'bike' ? 15 :
                              normalizedVehicleType === 'taxi' ? 40 : 75;
            backendCalculatedPrice = Math.round(distanceKm * pricePerKm);
          }
        } catch (priceError) {
          console.error('❌ Price calculation error:', priceError);
          // Fallback calculation (lowercase comparison)
          const pricePerKm = normalizedVehicleType === 'bike' ? 15 :
                            normalizedVehicleType === 'taxi' ? 40 : 75;
          backendCalculatedPrice = Math.round(distanceKm * pricePerKm);
        }
       
        console.log(`💰 Frontend sent price: ₹${estimatedPrice}, Backend calculated: ₹${backendCalculatedPrice}`);
       
        const finalPrice = backendCalculatedPrice;
       
        rideId = await generateSequentialRaidId();
        console.log(`🆔 Generated RAID_ID: ${rideId}`);
        console.log(`💰 USING BACKEND CALCULATED PRICE: ₹${finalPrice}`);
        
        let otp;
        if (customerId && customerId.length >= 4) {
          otp = customerId.slice(-4);
        } else {
          otp = Math.floor(1000 + Math.random() * 9000).toString();
        }
        
        if (processingRides.has(rideId)) {
          console.log(`⏭️ Ride ${rideId} is already being processed, skipping`);
          if (callback) {
            callback({
              success: false,
              message: "Ride is already being processed"
            });
          }
          return;
        }
       
        processingRides.add(rideId);
        
        if (!userId || !customerId || !userName || !pickup || !drop) {
          console.error("❌ Missing required fields");
          processingRides.delete(rideId);
          if (callback) {
            callback({
              success: false,
              message: "Missing required fields"
            });
          }
          return;
        }

        const existingRide = await Ride.findOne({ RAID_ID: rideId });
        if (existingRide) {
          console.log(`⏭️ Ride ${rideId} already exists in database, skipping`);
          processingRides.delete(rideId);
          if (callback) {
            callback({
              success: true,
              rideId: rideId,
              _id: existingRide._id.toString(),
              otp: existingRide.otp,
              message: "Ride already exists"
            });
          }
          return;
        }

        const rideData = {
          user: userId,
          customerId: customerId,
          name: userName,
          userMobile: userMobile || "N/A",
          RAID_ID: rideId,
          pickupLocation: pickup.address || "Selected Location",
          dropoffLocation: drop.address || "Selected Location",
          pickupCoordinates: {
            latitude: pickup.lat,
            longitude: pickup.lng
          },
          dropoffCoordinates: {
            latitude: drop.lat,
            longitude: drop.lng
          },
          fare: finalPrice,
          rideType: normalizedVehicleType,
          otp: otp,
          distance: distance || "0 km",
          travelTime: travelTime || "0 mins",
          isReturnTrip: wantReturn || false,
          status: "pending",
          Raid_date: new Date(),
          Raid_time: new Date().toLocaleTimeString('en-US', {
            timeZone: 'Asia/Kolkata',
            hour12: true
          }),
          pickup: {
            addr: pickup.address || "Selected Location",
            lat: pickup.lat,
            lng: pickup.lng,
          },
          drop: {
            addr: drop.address || "Selected Location",
            lat: drop.lat,
            lng: drop.lng,
          },
          price: finalPrice,
          distanceKm: distanceKm || 0
        };

        const newRide = new Ride(rideData);
        const savedRide = await newRide.save();
        console.log(`💾 Ride saved to MongoDB with ID: ${savedRide._id}`);
        console.log(`💾 BACKEND PRICE SAVED: ₹${savedRide.fare}`);

        processingRides.add(rideId);
        console.log(`🔒 Ride ${rideId} added to processing set`);

        rides[rideId] = {
          ...data,
          rideId: rideId,
          status: "pending",
          timestamp: Date.now(),
          _id: savedRide._id.toString(),
          userLocation: { latitude: pickup.lat, longitude: pickup.lng },
          fare: finalPrice,
          vehicleType: normalizedVehicleType
        };

        userLocationTracking.set(userId, {
          latitude: pickup.lat,
          longitude: pickup.lng,
          lastUpdate: Date.now(),
          rideId: rideId
        });

        await saveUserLocationToDB(userId, pickup.lat, pickup.lng, rideId);

        console.log('🚨 EMERGENCY: Sending real-time notifications');
        
        // ✅ FIX: Handle sendFCMNotifications safely
        let notificationResult = {
          success: false,
          driversNotified: 0,
          totalDrivers: 0,
          fcmSent: false,
          fcmMessage: "FCM notification not attempted"
        };
        
        try {
          notificationResult = await sendFCMNotifications({
            rideId: rideId,
            RAID_ID: rideId,
            _id: savedRide._id.toString(),
            pickup: pickup,
            drop: drop,
            fare: finalPrice,
            distance: distance || "0 km",
            vehicleType: normalizedVehicleType,
            userName: userName,
            userMobile: userMobile,
            user: userId,
            otp: otp
            
          });
          console.log('📊 REAL-TIME NOTIFICATION RESULT:', notificationResult);
        } catch (fcmError) {
          console.error('❌ FCM notification error:', fcmError);
          notificationResult = {
            success: false,
            error: fcmError.message,
            fcmSent: false,
            fcmMessage: `FCM error: ${fcmError.message}`
          };
        }

        // ✅ CRITICAL FIX: Deduplication check to prevent multiple emissions
        const now = Date.now();
        const lastEmission = recentRideEmissions.get(rideId);

        if (lastEmission && (now - lastEmission) < 5000) {  // 5 second dedup window
          console.log(`⏭️ SKIPPING duplicate emission for ride ${rideId} (last sent ${now - lastEmission}ms ago)`);
          return callback?.({
            success: true,
            message: 'Ride request already sent (deduplicated)',
            rideId,
            alreadySent: true
          });
        }

        // Mark this ride as emitted
        recentRideEmissions.set(rideId, now);
        console.log(`✅ Marked ride ${rideId} as emitted at ${now}`);

        // Clean up old entries after 1 minute to prevent memory leak
        // Cleanup handled by global interval to reduce timer overhead

        // ✅ CRITICAL FIX: Only emit to drivers with matching vehicle type
        // Use room-based filtering instead of broadcasting to everyone
        const vehicleRoom = `drivers_${normalizedVehicleType}`;
        console.log(`📡 Emitting ride request ONLY to room: ${vehicleRoom}`);

        io.to(vehicleRoom).emit("newRideRequest", {
          ...data,
          fare: finalPrice, // ✅ ADDED: Explicitly send calculated fare to driver
          vehicleType: normalizedVehicleType, // Ensure normalized type is sent
          rideId: rideId,
          _id: savedRide._id.toString(),
          emergency: true
        });

        console.log(`✅ Ride request ${rideId} emitted successfully to ${vehicleRoom}`);

        // ✅ FIX: Check if callback exists and notificationResult is defined
        if (callback) {
          const responseData = {
            success: true,
            rideId: rideId,
            _id: savedRide._id.toString(),
            otp: otp,
            fare: finalPrice,
            vehicleType: normalizedVehicleType,
            driversFound: notificationResult.totalDrivers || 0,
            message: "Ride booked successfully!",
            notificationResult: notificationResult || {},
            fcmSent: notificationResult ? notificationResult.fcmSent || false : false,
            fcmMessage: notificationResult ? notificationResult.fcmMessage || "FCM status unknown" : "FCM not attempted",
            driversNotified: notificationResult ? notificationResult.driversNotified || 0 : 0
          };
          
          console.log('📨 Sending callback response:', responseData);
          callback(responseData);
        }

      } catch (error) {
        console.error("❌ Error booking ride:", error);
        
        if (error.name === 'ValidationError') {
          const errors = Object.values(error.errors).map(err => err.message);
          console.error("❌ Validation errors:", errors);
          
          if (callback) {
            callback({
              success: false,
              message: `Validation failed: ${errors.join(', ')}`
            });
          }
        } else if (error.code === 11000 && error.keyPattern && error.keyPattern.RAID_ID) {
          console.log(`🔄 Duplicate RAID_ID detected: ${rideId}`);
          
          try {
            const existingRide = await Ride.findOne({ RAID_ID: rideId });
            if (existingRide && callback) {
              callback({
                success: true,
                rideId: rideId,
                _id: existingRide._id.toString(),
                otp: existingRide.otp,
                message: "Ride already exists (duplicate handled)"
              });
            }
          } catch (findError) {
            console.error("❌ Error finding existing ride:", findError);
            if (callback) {
              callback({
                success: false,
                message: "Failed to process ride booking (duplicate error)"
              });
            }
          }
        } else {
          console.error("❌ General error details:", error.message, error.stack);
          if (callback) {
            callback({
              success: false,
              message: `Failed to process ride booking: ${error.message}`
            });
          }
        }
      } finally {
        if (rideId) {
          processingRides.delete(rideId);
        }
      }
    });

    socket.on('joinRoom', async (data) => {
      try {
        const { userId } = data;
        if (userId) {
          socket.join(userId.toString());
          console.log(`✅ User ${userId} joined their room via joinRoom event`);
        }
      } catch (error) {
        console.error('Error in joinRoom:', error);
      }
    });

    
    socket.on("joinRideRoom", (data) => {
      const { rideId } = data;
      socket.join(rideId);
      console.log(`User ${socket.id} joined ride room: ${rideId}`);
    });

    socket.on("acceptRide", async (data, callback) => {
      try {
        const { rideId, driverId, driverName, driverLat, driverLng, vehicleType } = data;

        console.log(`\n✅ ACCEPT RIDE REQUEST: ${rideId} by driver ${driverId}`);

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          // Find ride with user populated
          const ride = await Ride.findOne({
            RAID_ID: rideId,
            status: { $in: ["pending", "searching"] }
          }).populate('user').session(session);

          if (!ride) {
            await session.abortTransaction();
            console.log(`❌ Ride ${rideId} not found or already accepted`);
            return callback({
              success: false,
              message: `Ride is no longer available. Another driver may have accepted it.`
            });
          }

          // Update ride status
          const updatedRide = await Ride.findOneAndUpdate(
            {
              RAID_ID: rideId,
              status: { $in: ["pending", "searching"] }
            },
            {
              $set: {
                status: "accepted",
                driverId: driverId,
                driverName: driverName,
                acceptedAt: new Date(),
                driverLocation: {
                  lat: driverLat,
                  lng: driverLng
                }
              }
            },
            {
              new: true,
              session: session
            }
          ).populate('user');

          await session.commitTransaction();
          console.log(`✅ Ride ${rideId} accepted successfully by ${driverId}`);

          // Get driver details from database
          const driver = await Driver.findOne({ driverId: driverId });

          let userDataComplete = null;
          let retryCount = 0;
          
          while (!userDataComplete && retryCount < 3) {
            try {
              // Get user from ride (populated earlier)
              if (updatedRide.user) {
                userDataComplete = {
                  name: updatedRide.name || "Customer",
                  mobile: updatedRide.userMobile || updatedRide.user?.phoneNumber || "",
                  userId: updatedRide.user._id || updatedRide.user,
                  // Add location for driver's map
                  location: {
                    latitude: updatedRide.pickup?.lat || 0,
                    longitude: updatedRide.pickup?.lng || 0
                  }
                };
              }
            } catch (err) {
              retryCount++;
              if (retryCount === 3) {
                console.error("Failed to get user data after 3 retries:", err);
                // Create fallback user data
                userDataComplete = {
                  name: updatedRide.name || "Customer",
                  mobile: updatedRide.userMobile || "N/A",
                  userId: updatedRide.user?._id || "unknown",
                  location: {
                    latitude: updatedRide.pickup?.lat || 0,
                    longitude: updatedRide.pickup?.lng || 0
                  }
                };
              }
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          // Prepare complete response data
          const responseData = {
            success: true,
            message: "Ride accepted successfully",
            rideId: rideId,
            status: "accepted",
            // Complete ride data
            ride: {
              RAID_ID: updatedRide.RAID_ID,
              rideId: updatedRide.RAID_ID,
              pickup: updatedRide.pickup || {},
              drop: updatedRide.drop || {},
              fare: updatedRide.fare || 0,
              distance: updatedRide.distance || 0,
              userName: updatedRide.name || "Customer",
              userMobile: updatedRide.userMobile || "",
              otp: updatedRide.otp || "0000",
              vehicleType: updatedRide.rideType || "taxi",
              status: "accepted",
              driverId: driverId,
              driverName: driverName
            },
            // User data for UI
            userData: {
              name: updatedRide.name || "Customer",
              mobile: updatedRide.userMobile || "",
              location: {
                latitude: updatedRide.pickup?.lat || 0,
                longitude: updatedRide.pickup?.lng || 0
              },
              userId: updatedRide.user?._id || null,
              rating: 4.8
            },
            // Additional info
            userId: updatedRide.user?._id,
            pickup: updatedRide.pickup,
            driverPhone: driver?.phoneNumber || "",
            driverVehicleNumber: driver?.vehicleNumber || "",
            driverRating: driver?.rating || "5.0"
          };

          console.log(`📤 Sending complete data to driver:`, {
            userName: updatedRide.name,
            userMobile: updatedRide.userMobile,
            rideId: updatedRide.RAID_ID
          });

          // ✅ CRITICAL: Send callback to driver with ALL data
          if (callback) {
            callback(responseData);
          }

          // ✅ CRITICAL: Notify user immediately via their room
          const userId = updatedRide.user?._id?.toString();
          if (userId) {
            const userRoom = userId.toString();
            console.log(`📡 Emitting to user room: ${userRoom}`);
            
            io.to(userRoom).emit("rideAccepted", {
              success: true,
              rideId: rideId,
              driverId: driverId,
              driverName: driverName,
              driverLat: driverLat,
              driverLng: driverLng,
              driverPhone: driver?.phoneNumber || "",
              driverVehicleNumber: driver?.vehicleNumber || "",
              driverRating: driver?.rating || "5.0",
              vehicleType: vehicleType || updatedRide.rideType,
              message: "Your ride has been accepted by a driver",
              timestamp: new Date().toISOString()
            });

            // Also join driver to user's room for direct communication
            socket.join(userRoom);
            console.log(`👥 Driver ${driverId} joined user room: ${userRoom}`);
          }

          // ✅ Notify other drivers that ride is taken
          const vehicleRoom = `drivers_${(updatedRide.rideType || 'taxi').toLowerCase()}`;
          socket.to(vehicleRoom).emit("rideAlreadyAccepted", {
            rideId: rideId,
            driverId: driverId,
            driverName: driverName,
            message: `Ride ${rideId} has been accepted by another driver`,
            timestamp: new Date().toISOString()
          });

          console.log(`✅ Ride ${rideId} accepted and user notified`);

        } catch (error) {
          await session.abortTransaction();
          console.error(`❌ Error accepting ride ${rideId}:`, error);
          if (callback) {
            callback({
              success: false,
              message: "Failed to accept ride",
              error: error.message
            });
          }
          throw error;
        } finally {
          session.endSession();
        }
      } catch (error) {
        console.error(`❌ ERROR ACCEPTING RIDE:`, error);
        callback({ success: false, message: error.message });
      }
    });

    socket.on("userLocationUpdate", async (data) => {
      try {
        let { userId, rideId, latitude, longitude } = data;
       
        console.log(`📍 USER LOCATION UPDATE: User ${userId} for ride ${rideId}`);

        // ✅ FIX: Resolve userId if it's a customerId (not an ObjectId)
        if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
          const user = await Registration.findOne({ customerId: userId });
          if (user) {
            console.log(`🔄 Resolved customerId ${userId} to ObjectId ${user._id}`);
            userId = user._id.toString();
          }
        }
       
        userLocationTracking.set(userId, {
          latitude,
          longitude,
          lastUpdate: Date.now(),
          rideId: rideId
        });
       
        logUserLocationUpdate(userId, { latitude, longitude }, rideId);
       
        await saveUserLocationToDB(userId, latitude, longitude, rideId);
       
        if (rides[rideId]) {
          rides[rideId].userLocation = { latitude, longitude };
          console.log(`✅ Updated user location in memory for ride ${rideId}`);
        }
       
        let driverId = null;
       
        if (rides[rideId] && rides[rideId].driverId) {
          driverId = rides[rideId].driverId;
          console.log(`✅ Found driver ID in memory: ${driverId} for ride ${rideId}`);
        } else {
          const ride = await Ride.findOne({ RAID_ID: rideId });
          if (ride && ride.driverId) {
            driverId = ride.driverId;
            console.log(`✅ Found driver ID in database: ${driverId} for ride ${rideId}`);
           
            if (!rides[rideId]) {
              rides[rideId] = {};
            }
            rides[rideId].driverId = driverId;
          } else {
            console.log(`❌ No driver assigned for ride ${rideId} in database either`);
            return;
          }
        }
       
        const driverRoom = `driver_${driverId}`;
        const locationData = {
          rideId: rideId,
          userId: userId,
          lat: latitude,
          lng: longitude,
          timestamp: Date.now()
        };
       
        console.log(`📡 Sending user location to driver ${driverId} in room ${driverRoom}`);
       
        io.to(driverRoom).emit("userLiveLocationUpdate", locationData);
       
        io.emit("userLiveLocationUpdate", locationData);
       
      } catch (error) {
        console.error("❌ Error processing user location update:", error);
      }
    });

    const updateDriverFCMToken = async (driverId, fcmToken) => {
      try {
        console.log(`📱 Updating FCM token for driver: ${driverId}`);
        
        const result = await Driver.findOneAndUpdate(
          { driverId: driverId },
          { 
            fcmToken: fcmToken,
            fcmTokenUpdatedAt: new Date(),
            platform: 'android'
          },
          { new: true, upsert: false }
        );

        if (result) {
          console.log(`✅ FCM token updated for driver: ${driverId}`);
          return true;
        } else {
          console.log(`❌ Driver not found: ${driverId}`);
          return false;
        }
      } catch (error) {
        console.error('❌ Error updating FCM token:', error);
        return false;
      }
    };

    socket.on("updateFCMToken", async (data, callback) => {
      try {
        const { driverId, fcmToken, platform } = data;
        
        if (!driverId || !fcmToken) {
          if (callback) callback({ success: false, message: 'Missing driverId or fcmToken' });
          return;
        }

        const updated = await updateDriverFCMToken(driverId, fcmToken);
        
        if (callback) {
          callback({ 
            success: updated, 
            message: updated ? 'FCM token updated' : 'Failed to update FCM token' 
          });
        }
      } catch (error) {
        console.error('❌ Error in updateFCMToken:', error);
        if (callback) callback({ success: false, message: error.message });
      }
    });

    socket.on("requestRideOTP", async (data, callback) => {
      try {
        const { rideId } = data;
        
        if (!rideId) {
          if (callback) callback({ success: false, message: "No ride ID provided" });
          return;
        }
        
        const ride = await Ride.findOne({ RAID_ID: rideId });
        
        if (!ride) {
          if (callback) callback({ success: false, message: "Ride not found" });
          return;
        }
        
        socket.emit("rideOTPUpdate", {
          rideId: rideId,
          otp: ride.otp
        });
        
        if (callback) callback({ success: true, otp: ride.otp });
      } catch (error) {
        console.error("❌ Error requesting ride OTP:", error);
        if (callback) callback({ success: false, message: "Server error" });
      }
    });

    socket.on("getUserDataForDriver", async (data) => {
      try {
        console.log('👤 Driver requested user data for ride:', data.rideId);
        
        // FIX: Use data.driverId instead of undefined driverId variable
        const driverId = data.driverId; 
        const rideId = data.rideId;
        
        if (!driverId) {
          console.error('❌ No driverId provided in getUserDataForDriver');
          return socket.emit("userDataResponse", {
            success: false,
            message: "Driver ID is required"
          });
        }
        
        // Now you can use driverId safely
        console.log(`🔍 Fetching user data for driver ${driverId}, ride ${rideId}`);
        
        const Driver = require('./models/driver/driver');
        const Ride = require('./models/ride');
        
        // Find the ride
        const ride = await Ride.findOne({ RAID_ID: rideId });
        if (!ride) {
          console.error(`❌ Ride ${rideId} not found`);
          return socket.emit("userDataResponse", {
            success: false,
            message: "Ride not found"
          });
        }
        
        // Find the user
        const Registration = require("./models/user/Registration");
        const user = await Registration.findById(ride.user);
        
        if (!user) {
          console.error(`❌ User not found for ride ${rideId}`);
          return socket.emit("userDataResponse", {
            success: false,
            message: "User not found"
          });
        }
        
        // Get driver details to include mobile number
        const driver = await Driver.findOne({ driverId: driverId });
        const driverMobile = driver ? (driver.phone || driver.phoneNumber || driver.mobile || '') : '';
        
        console.log(`✅ Sending user data to driver ${driverId}: ${user.name}, Phone: ${user.phoneNumber}`);
        
        socket.emit("userDataResponse", {
          success: true,
          userId: user._id,
          customerId: user.customerId,
          userName: user.name,
          userPhone: user.phoneNumber,
          userMobile: user.phoneNumber,
          pickupAddress: ride.pickupAddress,
          dropoffAddress: ride.dropoffAddress,
          estimatedFare: ride.estimatedFare,
          driverMobile: driverMobile // Include driver's mobile number
        });
        
      } catch (error) {
        console.error('❌ Error getting user data for driver:', error);
        socket.emit("userDataResponse", {
          success: false,
          message: "Error fetching user data",
          error: error.message
        });
      }
    });

    socket.on("otpVerified", async (data) => {
      try {
        const { rideId, driverId } = data;
        console.log(`✅ OTP Verified for ride ${rideId}, notifying user`);
        
        const ride = await Ride.findOne({ RAID_ID: rideId });
        if (!ride) {
          console.error(`❌ Ride ${rideId} not found for OTP verification`);
          return;
        }
        
        const userId = ride.user?.toString() || ride.userId;
        if (!userId) {
          console.error(`❌ No user ID found for ride ${rideId}`);
          return;
        }
        
        console.log(`📡 Notifying user ${userId} about OTP verification for ride ${rideId}`);
        
        const notificationData = {
          rideId,
          driverId,
          userId,
          status: "started",
          otpVerified: true,
          timestamp: new Date().toISOString(),
          message: "OTP verified successfully! Ride has started."
        };
        
        io.to(userId.toString()).emit("otpVerified", notificationData);
        io.to(userId.toString()).emit("rideOTPVerified", notificationData);
        io.to(userId.toString()).emit("rideStatusUpdate", {
          rideId,
          status: "started",
          otpVerified: true,
          message: "Driver has verified OTP and started the ride",
          timestamp: new Date().toISOString()
        });
        
        io.emit("otpVerifiedGlobal", {
          ...notificationData,
          targetUserId: userId
        });
        
        setTimeout(() => {
          io.to(userId.toString()).emit("otpVerified", notificationData);
          console.log(`✅ Backup OTP notification sent to user ${userId}`);
        }, 500);
        
        console.log(`✅ All OTP verification events sent to user ${userId}`);
        
      } catch (error) {
        console.error("❌ Error handling OTP verification:", error);
      }
    });

    socket.on("driverStartedRide", async (data) => {
      try {
        const { rideId, driverId } = data;
        console.log(`🚀 Driver started ride: ${rideId}`);
        
        const ride = await Ride.findOne({ RAID_ID: rideId });
        if (ride) {
          ride.status = "started";
          ride.rideStartTime = new Date();
          await ride.save();
          console.log(`✅ Ride ${rideId} status updated to 'started'`);
        }
        
        if (rides[rideId]) {
          rides[rideId].status = "started";
        }

        const userId = ride.user?.toString() || ride.userId;
        if (!userId) {
          console.error(`❌ No user ID found for ride ${rideId}`);
          return;
        }

        const userRoom = userId.toString();
        console.log(`📡 Notifying user ${userRoom} about ride start and OTP verification`);

        io.to(userRoom).emit("rideStatusUpdate", {
          rideId: rideId,
          status: "started",
          message: "Driver has started the ride",
          otpVerified: true,
          timestamp: new Date().toISOString()
        });

        
        io.to(userRoom).emit("otpVerified", {
          rideId: rideId,
          driverId: driverId,
          userId: userId,
          status: "started",
          otpVerified: true,
          timestamp: new Date().toISOString()
        });

        io.to(userRoom).emit("driverStartedRide", {
          rideId: rideId,
          driverId: driverId,
          status: "started",
          otpVerified: true,
          timestamp: new Date().toISOString()
        });

        io.emit("otpVerifiedGlobal", {
          rideId: rideId,
          targetUserId: userRoom,
          status: "started",
          otpVerified: true,
          timestamp: new Date().toISOString()
        });

        setTimeout(() => {
          io.to(userRoom).emit("otpVerified", {
            rideId: rideId,
            driverId: driverId,
            userId: userId,
            status: "started",
            otpVerified: true,
            timestamp: new Date().toISOString()
          });
          console.log(`✅ Backup OTP verification notification sent to user ${userRoom}`);
        }, 1000);

        console.log(`✅ All OTP verification notifications sent to user ${userRoom}`);

        socket.emit("rideStarted", {
          rideId: rideId,
          message: "Ride started successfully"
        });
        
      } catch (error) {
        console.error("❌ Error processing driver started ride:", error);
      }
    });

    socket.on("rideStatusUpdate", (data) => {
      try {
        const { rideId, status, userId } = data;
        console.log(`📋 Ride status update: ${rideId} -> ${status}`);
        
        if (status === "started" && data.otpVerified) {
          const ride = rides[rideId];
          if (ride && ride.userId) {
            io.to(ride.userId.toString()).emit("otpVerified", {
              rideId: rideId,
              status: status,
              otpVerified: true,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (error) {
        console.error("❌ Error handling ride status update:", error);
      }
    });

    socket.on("rejectRide", async (data, callback) => {
      try {
        const { rideId, driverId, reason = "Driver declined" } = data;

        console.log(`\n❌ REJECT RIDE REQUEST: ${rideId} by driver ${driverId}`);
        console.log(`   Reason: ${reason}`);

        // ✅ Update database to track rejection
        const ride = await Ride.findOne({ RAID_ID: rideId });

        if (!ride) {
          console.log(`❌ Ride ${rideId} not found`);
          if (callback) {
            return callback({
              success: false,
              message: "Ride not found"
            });
          }
          return;
        }

        // ✅ Only allow rejection if ride is still pending or searching
        if (ride.status !== "pending" && ride.status !== "searching") {
          console.log(`⚠️ Ride ${rideId} cannot be rejected (status: ${ride.status})`);
          if (callback) {
            return callback({
              success: false,
              message: `Cannot reject ride - current status: ${ride.status}`
            });
          }
          return;
        }

        // ✅ Track rejection in database (optional: add rejectedBy array to Ride model)
        // For now, we'll just log it and keep ride in pending state for other drivers
        console.log(`✅ Driver ${driverId} rejected ride ${rideId}, ride remains available for other drivers`);

        // ✅ Update driver status in active sockets
        if (activeDriverSockets.has(driverId)) {
          const driverData = activeDriverSockets.get(driverId);
          driverData.status = "Live";
          driverData.isOnline = true;
          activeDriverSockets.set(driverId, driverData);
          console.log(`✅ Driver ${driverId} status updated to Live`);
        }

        // ✅ Send confirmation to driver
        socket.emit("rideRejectionConfirmed", {
          success: true,
          rideId: rideId,
          message: "Ride rejected successfully. You are now available for new rides.",
          status: "Live"
        });

        // ✅ Notify user that this driver rejected (optional)
        const userRoom = ride.user.toString();
        io.to(userRoom).emit("driverRejectedRide", {
          rideId: rideId,
          driverId: driverId,
          message: "A driver declined your ride. Searching for another driver...",
          timestamp: new Date().toISOString()
        });

        // ✅ Send callback response
        if (callback) {
          callback({
            success: true,
            message: "Ride rejected successfully",
            status: "Live"
          });
        }

        // ✅ Update in-memory rides object (for backward compatibility)
        if (rides[rideId]) {
          rides[rideId].rejectedBy = rides[rideId].rejectedBy || [];
          rides[rideId].rejectedBy.push({
            driverId: driverId,
            rejectedAt: Date.now(),
            reason: reason
          });
        }

      } catch (error) {
        console.error("❌ Error rejecting ride:", error);
        if (callback) {
          callback({
            success: false,
            message: "Failed to reject ride",
            error: error.message
          });
        }
      }
    });

    socket.on("driverHeartbeat", ({ driverId }) => {
      if (activeDriverSockets.has(driverId)) {
        const driverData = activeDriverSockets.get(driverId);
        driverData.lastUpdate = Date.now();
        driverData.isOnline = true;
        activeDriverSockets.set(driverId, driverData);
       
        console.log(`❤️ Heartbeat received from driver: ${driverId}`);
      }
    });
   
    socket.on("getCurrentPrices", (callback) => {
      try {
        console.log('📡 User explicitly requested current prices');
        const currentPrices = ridePriceController.getCurrentPrices();
        console.log('💰 Sending prices in response:', currentPrices);
       
        if (typeof callback === 'function') {
          callback(currentPrices);
        }
        socket.emit('currentPrices', currentPrices);
      } catch (error) {
        console.error('❌ Error handling getCurrentPrices:', error);
        if (typeof callback === 'function') {
          callback({ bike: 0, taxi: 0, port: 0 });
        }
      }
    });

    socket.on("disconnect", () => {
      console.log(`\n❌ Client disconnected: ${socket.id || 'unknown'}`);
      console.log(`📱 Remaining connected clients: ${io.engine?.clientsCount - 1 || 'unknown'}`);
     
      if (socket.driverId) {
        console.log(`🛑 Driver ${socket.driverName} (${socket.driverId}) disconnected`);
       
        if (activeDriverSockets.has(socket.driverId)) {
          const driverData = activeDriverSockets.get(socket.driverId);
          driverData.isOnline = false;
          driverData.status = "Offline";
          activeDriverSockets.set(socket.driverId, driverData);
       
          saveDriverLocationToDB(
            socket.driverId,
            socket.driverName,
            driverData.location.latitude,
            driverData.location.longitude,
            driverData.vehicleType,
            "offline"
          ).catch(console.error);
        }
       
        broadcastDriverLocationsToAllUsers();
        logDriverStatus();
      }
    });
  });
 
  // Cleanup interval (outside connection, inside init)
  setInterval(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - 300000;
    const oneMinuteAgo = now - 60000; // ✅ NEW: 1 minute threshold for inactivity
    let cleanedCount = 0;
   
    Array.from(activeDriverSockets.entries()).forEach(([driverId, driver]) => {
      // ✅ NEW: Check for inactive drivers (stale connection)
      if (driver.isOnline && driver.lastUpdate < oneMinuteAgo) {
        console.log(`⚠️ Driver ${driver.driverName} (${driverId}) inactive for >60s - Marking Offline`);
        driver.isOnline = false;
        driver.status = "Offline";
        activeDriverSockets.set(driverId, driver);
        
        // Update DB to Offline
        saveDriverLocationToDB(
          driverId,
          driver.driverName,
          driver.location.latitude,
          driver.location.longitude,
          driver.vehicleType,
          "offline"
        ).catch(console.error);
      }

      if (!driver.isOnline && driver.lastUpdate < fiveMinutesAgo) {
        activeDriverSockets.delete(driverId);
        cleanedCount++;
        console.log(`🧹 Removed offline driver (5+ minutes): ${driver.driverName} (${driverId})`);
      }
    });
   
    const thirtyMinutesAgo = now - 1800000;
    Array.from(userLocationTracking.entries()).forEach(([userId, data]) => {
      if (data.lastUpdate < thirtyMinutesAgo) {
        userLocationTracking.delete(userId);
        cleanedCount++;
        console.log(`🧹 Removed stale user location tracking for user: ${userId}`);
      }
    });
   
    // ✅ NEW: Cleanup stale rides from memory (older than 3 hours)
    const threeHoursAgo = now - (3 * 60 * 60 * 1000);
    Object.keys(rides).forEach(rideId => {
      if (rides[rideId].timestamp < threeHoursAgo) {
        delete rides[rideId];
        cleanedCount++;
        console.log(`🧹 Removed stale ride ${rideId} from memory (timeout)`);
      }
    });

    // ✅ NEW: Cleanup recentRideEmissions map centrally
    for (const [rideId, timestamp] of recentRideEmissions.entries()) {
      if (timestamp < oneMinuteAgo) {
        recentRideEmissions.delete(rideId);
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`\n🧹 Cleaned up ${cleanedCount} stale entries`);
      broadcastDriverLocationsToAllUsers();
      logDriverStatus();
    }
  }, 60000);
};

const getIO = () => {
  if (!io) throw new Error("❌ Socket.io not initialized!");
  return io;
};

module.exports = { init, getIO, broadcastPricesToAllUsers };