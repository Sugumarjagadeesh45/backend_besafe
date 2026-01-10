const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authMiddleware } = require('../middleware/authMiddleware');

console.log('💰 Wallet Controller Methods:', Object.keys(walletController).filter(key => typeof walletController[key] === 'function'));

// All wallet routes require authentication
router.use(authMiddleware);

// Get wallet balance
router.get('/balance', (req, res) => {
  walletController.getWalletBalance(req, res);
});



// In your backend (e.g., walletRoutes.js)
router.post('/credit-ride', authMiddleware, async (req, res) => {
  try {
    const { rideId, amount, userId } = req.body;
    
    // 1. Find the ride
    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ success: false, message: 'Ride not found' });
    }
    
    // 2. Find the user
    const user = await User.findById(userId || req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // 3. Credit the wallet
    const creditAmount = parseFloat(amount);
    user.walletBalance = (user.walletBalance || 0) + creditAmount;
    
    // 4. Record transaction
    const transaction = new Transaction({
      userId: user._id,
      rideId,
      type: 'credit',
      amount: creditAmount,
      method: 'ride_payment',
      description: `Ride payment credit for ${rideId}`,
      balanceAfter: user.walletBalance
    });
    
    await transaction.save();
    await user.save();
    
    // 5. Update ride payment status
    ride.paymentStatus = 'completed';
    ride.paymentMethod = 'wallet';
    await ride.save();
    
    // 6. Emit socket event for real-time update
    io.to(user._id.toString()).emit('walletUpdate', {
      walletBalance: user.walletBalance,
      transaction: {
        amount: creditAmount,
        type: 'credit'
      }
    });
    
    res.json({
      success: true,
      message: 'Wallet credited successfully',
      walletBalance: user.walletBalance,
      rideId,
      creditedAmount: creditAmount
    });
    
  } catch (error) {
    console.error('Wallet credit error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// Add money to wallet
router.post('/add-money', (req, res) => {
  walletController.addMoneyToWallet(req, res);
});

// Get transaction history
router.get('/transactions', (req, res) => {
  walletController.getTransactionHistory(req, res);
});

// Create wallet (if doesn't exist)
router.post('/create', (req, res) => {
  walletController.createWallet(req, res);
});

// Make payment from wallet
router.post('/payment', (req, res) => {
  walletController.makePayment(req, res);
});

// Withdraw from wallet
router.post('/withdraw', (req, res) => {
  walletController.withdrawFromWallet(req, res);
});

module.exports = router;
// const express = require("express");
// const { getWallet, requestWithdraw } = require("../controllers/driver/WalletController");
// const authMiddleware = require("../middleware/authMiddleware");

// const router = express.Router();

// router.get("/", authMiddleware, getWallet);
// router.post("/withdraw", authMiddleware, requestWithdraw);

// module.exports = router;
