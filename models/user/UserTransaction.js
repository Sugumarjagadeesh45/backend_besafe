const mongoose = require('mongoose');

const userTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true,
    index: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  category: {
    type: String,
    enum: [
      'wallet_recharge',      // User added money to wallet
      'ride_payment',         // Payment for ride (debit)
      'shopping_payment',     // Payment for online shopping (debit)
      'refund',              // Refund for cancelled ride/order (credit)
      'bonus',               // Bonus/cashback (credit)
      'admin_credit',        // Admin added money (credit)
      'admin_debit',         // Admin deducted money (debit)
      'withdrawal'           // User withdrew money (debit)
    ],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    required: true
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  balanceBefore: {
    type: Number,
    required: true
  },
  rideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    default: null
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed'
  },
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// Index for efficient queries
userTransactionSchema.index({ userId: 1, createdAt: -1 });
userTransactionSchema.index({ transactionId: 1 });

// Auto-generate transaction ID
userTransactionSchema.pre('save', function(next) {
  if (this.isNew && !this.transactionId) {
    this.transactionId = `TXN${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('UserTransaction', userTransactionSchema);
