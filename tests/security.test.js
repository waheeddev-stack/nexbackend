import { test, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';

// Basic security-oriented checks: send common SQLi payloads and ensure the server
// does not return 500 (internal error) and handles input safely.

const sqliPayloads = [
  "' OR '1'='1",
  "' OR 1=1; --",
  "'; DROP TABLE users; --",
  'admin' + String.fromCharCode(0) + "--",
  '" OR "" = "',
];

test('Signup endpoint resists common SQL injection payloads', async () => {
  for (const p of sqliPayloads) {
    const res = await request(app).post('/api/users/signup').send({ name: p, email: `test+${Math.random().toString(36).slice(2)}@example.com`, password: 'password123' });
    // We expect the app to respond with either validation error (400) or success (201/200), but not 500
    expect(res.status).not.toBe(500);
  }
});

test('Signin endpoint resists common SQL injection payloads', async () => {
  for (const p of sqliPayloads) {
    const res = await request(app).post('/api/users/signin').send({ email: p, password: 'whatever' });
    expect(res.status).not.toBe(500);
  }
});

// Add a small endpoint-fuzz check for order creation
test('Orders endpoint resists SQLi-like inputs', async () => {
  const res = await request(app).post('/api/users/orders').send({ user_id: 1, products: [], total: 0, address: "' OR '1'='1" });
  expect(res.status).not.toBe(500);
});
