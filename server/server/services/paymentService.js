/**
 * PayHero Payment Service
 * Handles communication with PayHero API
 */

const https = require('https');

const PAYHERO_CONFIG = {
  API_KEY: process.env.PAYHERO_API_KEY || '6CUxNcfi9jRpr4eWicAn',
  API_SECRET: process.env.PAYHERO_API_SECRET || 'j6zP2XpAlXn9UhtHOj9PbYQVAdlQnkeyrEWuFOAH',
  CHANNEL_ID: process.env.PAYHERO_CHANNEL_ID || 6175,
  ACCOUNT_ID: process.env.PAYHERO_ACCOUNT_ID || 6175,
  ENDPOINT: 'https://backend.payhero.co.ke/api/v2/payments'
};

/**
 * Generate Basic Auth token
 */
function generateBasicAuthToken() {
  const credentials = `${PAYHERO_CONFIG.API_KEY}:${PAYHERO_CONFIG.API_SECRET}`;
  const encoded = Buffer.from(credentials).toString('base64');
  console.log('🔐 Auth Header Generated');
  return 'Basic ' + encoded;
}

/**
 * Normalize phone number to PayHero format (254XXXXXXXXX)
 */
function normalizePhoneNumber(phone) {
  // Remove spaces, dashes, parentheses
  let normalized = phone.replace(/[\s\-\(\)]/g, '');
  
  console.log(`📞 Original: ${phone} → Normalized: ${normalized}`);
  
  // If starts with 07, 01, or 06, replace with 254
  if (normalized.match(/^0[167]/)) {
    normalized = '254' + normalized.substring(1);
    console.log(`   (0x → 254x conversion)`);
  }
  // If doesn't start with 254, add it
  else if (!normalized.match(/^254/)) {
    normalized = '254' + normalized;
    console.log(`   (Added 254 prefix)`);
  }
  
  console.log(`   Final: ${normalized}`);
  return normalized;
}

/**
 * Initiate payment with PayHero API
 */
async function initiatePayment(amount, phoneNumber, externalReference, callbackUrl) {
  return new Promise((resolve, reject) => {
    try {
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      
      const payload = {
        amount: parseFloat(amount),
        phone_number: normalizedPhone,
        channel_id: PAYHERO_CONFIG.CHANNEL_ID,
        provider: 'm-pesa',
        external_reference: externalReference,
        callback_url: callbackUrl
      };

      const payloadJson = JSON.stringify(payload);
      
      console.log('\n📋 PayHero API Request Details:');
      console.log(`   URL: https://backend.payhero.co.ke/api/v2/payments`);
      console.log(`   Method: POST`);
      console.log(`   Phone: ${normalizedPhone}`);
      console.log(`   Amount: ${amount}`);
      console.log(`   Reference: ${externalReference}`);
      console.log(`   Payload: ${payloadJson}\n`);

      const options = {
        hostname: 'backend.payhero.co.ke',
        port: 443,
        path: '/api/v2/payments',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadJson),
          'Authorization': generateBasicAuthToken(),
          'User-Agent': 'BetNexaPaymentServer/1.0'
        },
        timeout: 30000,
        rejectUnauthorized: false // For testing - remove in production
      };

      console.log('🌐 Connecting to PayHero API...');

      const req = https.request(options, (res) => {
        let data = '';
        
        console.log(`📊 Response Status: ${res.statusCode}`);

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          console.log(`📥 Response Data: ${data}`);
          
          try {
            const response = JSON.parse(data);
            
            if (res.statusCode === 200 || res.statusCode === 201) {
              console.log('✅ PayHero Success Response:', response);
              resolve({
                success: true,
                data: response,
                statusCode: res.statusCode
              });
            } else {
              console.log(`❌ PayHero API Error (${res.statusCode}):`, response);
              reject({
                success: false,
                message: response.error || response.message || `PayHero API Error: ${res.statusCode}`,
                statusCode: res.statusCode,
                response: response
              });
            }
          } catch (parseError) {
            console.error('❌ JSON Parse Error:', parseError.message);
            console.error('Raw response:', data);
            reject({
              success: false,
              message: 'Failed to parse PayHero response',
              error: parseError.message,
              rawResponse: data
            });
          }
        });
      });

      req.on('error', (error) => {
        console.error('❌ HTTPS Request Error:', error);
        console.error(`   Error Code: ${error.code}`);
        console.error(`   Error Message: ${error.message}`);
        
        let userMessage = 'Failed to connect to PayHero API';
        
        if (error.code === 'ECONNREFUSED') {
          userMessage = 'PayHero API server refused connection (check if API is online)';
        } else if (error.code === 'ETIMEDOUT') {
          userMessage = 'Connection to PayHero API timed out (network may be slow)';
        } else if (error.code === 'ENOTFOUND') {
          userMessage = 'Could not resolve PayHero API hostname (DNS issue)';
        } else if (error.code === 'CERT_HAS_EXPIRED') {
          userMessage = 'PayHero SSL certificate has expired';
        } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          userMessage = 'PayHero SSL certificate verification failed';
        }
        
        reject({
          success: false,
          message: userMessage,
          errorCode: error.code,
          error: error.message
        });
      });

      req.on('timeout', () => {
        console.error('❌ PayHero API Request Timeout');
        req.destroy();
        reject({
          success: false,
          message: 'PayHero API request timeout (took longer than 30 seconds)'
        });
      });

      console.log('📤 Sending request...');
      req.write(payloadJson);
      req.end();
      
    } catch (error) {
      console.error('❌ Unexpected Error:', error);
      reject({
        success: false,
        message: 'Unexpected error: ' + error.message,
        error: error.message
      });
    }
  });
}

module.exports = {
  initiatePayment,
  normalizePhoneNumber,
  generateBasicAuthToken,
  PAYHERO_CONFIG
};

module.exports = {
  initiatePayment,
  normalizePhoneNumber,
  generateBasicAuthToken,
  PAYHERO_CONFIG
};
