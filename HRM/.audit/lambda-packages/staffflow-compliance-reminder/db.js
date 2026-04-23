/**
 * Shared database connection utilities for Lambda functions
 * Uses Neon serverless driver for PostgreSQL
 */

const { neon } = require('@neondatabase/serverless');

// Database connection pool (singleton pattern for Lambda)
let sql = null;

/**
 * Get or create database connection
 * Uses environment variable DATABASE_URL
 */
function getDbConnection() {
  if (!sql) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    sql = neon(databaseUrl);
  }
  return sql;
}

/**
 * Execute a database query with retry logic
 * @param {string} query - SQL query string
 * @param {Array} params - Query parameters
 * @param {number} maxRetries - Maximum number of retries
 */
async function executeWithRetry(query, params, maxRetries = 3) {
  const sql = getDbConnection();
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await sql(query, params);
    } catch (error) {
      lastError = error;
      console.log(`Database query attempt ${attempt} failed:`, error.message);
      
      // Reset connection on transient errors
      if (attempt < maxRetries && isTransientError(error)) {
        sql = null;
        getDbConnection();
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }
  }
  
  throw lastError;
}

/**
 * Check if error is transient and worth retrying
 */
function isTransientError(error) {
  const transientMessages = [
    'connection',
    'timeout',
    'network',
    'ECONNREFUSED',
    'ETIMEDOUT'
  ];
  const errorMessage = error.message?.toLowerCase() || '';
  return transientMessages.some(msg => errorMessage.includes(msg));
}

/**
 * Close database connection (for Lambda cleanup)
 */
async function closeDbConnection() {
  // Neon serverless doesn't require explicit connection closing
  sql = null;
}

module.exports = {
  getDbConnection,
  executeWithRetry,
  closeDbConnection
};
