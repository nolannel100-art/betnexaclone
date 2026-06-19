/**
 * Payment Cache Service
 * In-memory cache for payment tracking when database is unavailable
 * Provides fallback for payment status checks during callback processing
 */

class PaymentCache {
  constructor() {
    this.payments = new Map(); // Map of externalReference/checkoutRequestId -> payment data
    this.callbacks = new Map(); // Map of checkoutRequestId -> callback data
  }

  /**
   * Store a payment initiation record
   */
  storePayment(externalReference, checkoutRequestId, paymentData) {
    const paymentRecord = {
      externalReference,
      checkoutRequestId,
      ...paymentData,
      createdAt: new Date(),
      status: 'PENDING'
    };

    // Store with both external reference and checkout request ID for flexible lookup
    if (externalReference) {
      this.payments.set(externalReference, paymentRecord);
    }
    if (checkoutRequestId) {
      this.payments.set(checkoutRequestId, paymentRecord);
    }

    console.log(`💾 Payment cached: ${externalReference || checkoutRequestId}`);
  }

  /**
   * Store a callback response
   */
  storeCallback(checkoutRequestId, callbackData) {
    this.callbacks.set(checkoutRequestId, {
      ...callbackData,
      receivedAt: new Date()
    });
    console.log(`💾 Callback cached: ${checkoutRequestId}`);
    
    // Also update the payment status
    for (let [key, payment] of this.payments) {
      if (payment.checkoutRequestId === checkoutRequestId) {
        payment.status = callbackData.status || callbackData.Status;
        payment.resultCode = callbackData.resultCode || callbackData.ResultCode;
        payment.mpesaReceipt = callbackData.mpesaReceipt || callbackData.MpesaReceiptNumber;
        break;
      }
    }
  }

  /**
   * Get payment by external reference
   */
  getPayment(externalReference) {
    return this.payments.get(externalReference);
  }

  /**
   * Get callback by checkout request ID
   */
  getCallback(checkoutRequestId) {
    return this.callbacks.get(checkoutRequestId);
  }

  /**
   * Get all payments (for debugging)
   */
  getAllPayments() {
    return Array.from(this.payments.values());
  }

  /**
   * Clear old entries (older than 1 hour)
   */
  cleanupOldEntries() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (let [key, payment] of this.payments) {
      if (payment.createdAt.getTime() < oneHourAgo) {
        this.payments.delete(key);
      }
    }

    for (let [key, callback] of this.callbacks) {
      if (callback.receivedAt.getTime() < oneHourAgo) {
        this.callbacks.delete(key);
      }
    }
  }
}

// Create singleton instance
const paymentCache = new PaymentCache();

// Cleanup old entries every 30 minutes
setInterval(() => {
  paymentCache.cleanupOldEntries();
  console.log('🧹 Payment cache cleaned');
}, 30 * 60 * 1000);

module.exports = paymentCache;
