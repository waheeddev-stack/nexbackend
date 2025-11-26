import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../server.js';

// Basic smoke tests and validation checks for critical endpoints.

test('GET / should return 200 and running message', async (t) => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Server is running/i);
});

test('POST /api/users/signup with missing fields returns 400', async () => {
  const res = await request(app).post('/api/users/signup').send({});
  assert.equal(res.status, 400);
  // either returns a JSON body with message or success=false
  assert(res.body && (res.body.success === false || /required/i.test(res.body.message || '')));
});

test('GET /api/users/nearby-shops without lat/lng returns 400', async () => {
  const res = await request(app).get('/api/users/nearby-shops');
  assert.equal(res.status, 400);
  assert(res.body && /Missing location/i.test(res.body.message || ''));
});

test('POST /api/users/orders missing required fields returns 400', async () => {
  const res = await request(app).post('/api/users/orders').send({});
  assert.equal(res.status, 400);
  assert(res.body && /Missing required fields/i.test(res.body.message || ''));
});

test('POST /api/shopkeepers/signup with missing fields returns 400', async () => {
  const res = await request(app).post('/api/shopkeepers/signup').send({});
  // Some implementations expect multipart/form-data; controllers validate body fields and should return 400
  assert.equal(res.status, 400);
});

// Note: These tests are intentionally lightweight smoke/validation tests that do not depend on a database.
// For full coverage (happy-path cases) you should mock the DB pool and external services (email/SMS/cloudinary)
// using your preferred test framework (jest with jest.mock or sinon), then assert success flows.
