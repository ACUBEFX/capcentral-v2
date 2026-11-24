require('dotenv').config();
const mysql = require('mysql2');

const useTls = process.env.DB_SSL === 'true';

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'Cap-Central',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ...(useTls
        ? {
            ssl: {
                minVersion: 'TLSv1.2'
            }
        }
        : {})
});

module.exports = db;