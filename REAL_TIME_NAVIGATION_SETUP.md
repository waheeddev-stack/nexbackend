# Real-Time OpenStreetMap Navigation Setup Guide

This guide walks you through setting up and testing the live real-time navigation feature that combines OpenStreetMap tiles with Socket.io live location updates.

## 📋 Overview

The system consists of three main parts:

1. **Backend (Node.js + Express + Socket.io)**
   - Serves OpenStreetMap routes via OSRM API
   - Streams live GPS coordinates via Socket.io
   - Broadcasts driver location to all connected mobile clients

2. **Frontend (React Native + Expo)**
   - Renders free OpenStreetMap tiles using `<UrlTile>` component
   - Fetches initial route from backend
   - Listens to Socket.io for live location updates
   - Animates driver marker in real-time

3. **Simulator (Node.js CLI)**
   - Simulates a delivery partner moving along the route
   - Emits location updates every 2 seconds
   - Useful for testing without a real driver

---

## 🔧 Installation & Setup

### Prerequisites

- **Backend**: Node.js 18+, npm/yarn
- **Frontend**: Expo CLI, React Native
- **Both**: Active internet connection (for OSRM API and Socket.io)

### Step 1: Backend Setup

```bash
cd nexbackend

# Install dependencies (includes socket.io, socket.io-client, yargs)
npm install

# Start the backend server
npm run dev
# Or: npm start

# The server should start on http://localhost:5000
```

**Verify** the backend is running:

```bash
curl http://localhost:5000/api/navigation/status
```

Expected response:

```json
{
  "success": true,
  "service": "NexKirana Navigation & Spatial Routing Engine",
  "version": "2.0.0",
  "features": [
    "Haversine Nearby Shop Finder",
    "OSRM Turn-by-Turn Road Routing",
    "OpenStreetMap Reverse Geocoding",
    "Real-Time Socket.IO GPS Streaming",
    "Order Route Fetching"
  ],
  "status": "healthy"
}
```

### Step 2: Frontend Setup

```bash
cd ../NexKirana

# Install dependencies
npm install

# If expo modules need refresh
npx expo install

# Start the Expo development server
npm start
```

Then press `i` for iOS simulator, `a` for Android emulator, or `w` for web.

---

## 🚀 Testing the Real-Time Navigation

### Test 1: Fetch Route Data

First, verify the backend can fetch route data:

```bash
curl http://localhost:5000/api/navigation/order/test-order-123
```

Expected response:

```json
{
  "success": true,
  "data": {
    "order_id": "test-order-123",
    "shop_location": {
      "latitude": 28.7041,
      "longitude": 77.1025
    },
    "customer_location": {
      "latitude": 28.5244,
      "longitude": 77.1855
    },
    "polyline": [
      { "latitude": 28.7041, "longitude": 77.1025 },
      { "latitude": 28.6600, "longitude": 77.1100 },
      ...
    ],
    "distance_km": "25.50",
    "eta_minutes": 45
  }
}
```

### Test 2: Run the Simulator

In a new terminal, run the simulation script:

```bash
cd nexbackend

# Basic usage (uses test-order-123, updates every 2 seconds)
npm run simulate:navigation

# Or with custom parameters:
node scripts/simulateLiveNavigation.js --orderId test-order-123 --speed 2000 --repeat 1
```

**Command Options:**

```bash
--orderId (or -o)  : Order ID to track (default: "test-order-123")
--speed (or -s)    : Delay between updates in milliseconds (default: 2000)
--backend (or -b)  : Backend URL (default: "http://localhost:5000")
--repeat (or -r)   : Times to repeat the route (default: 1, use 0 for infinite)
```

**Example:**

```bash
# Fast simulation, repeating 3 times
node scripts/simulateLiveNavigation.js -o order-456 -s 1000 -r 3

# Slow simulation (5 seconds per update), infinite loop
node scripts/simulateLiveNavigation.js -s 5000 -r 0
```

**Expected Output:**

```
🚀 Live Navigation Simulator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Order ID: test-order-123
🌐 Backend: http://localhost:5000
⏱️  Update Interval: 2000ms
🔄 Repeat Route: 1x
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 Fetching route for order test-order-123...
✅ Route fetched successfully!
   📍 Waypoints: 245
   📏 Distance: 25.5 km
   ⏳ ETA: 45 minutes
   First point: 28.7041, 77.1025
   Last point: 28.5244, 77.1855

🔌 Connecting to Socket.io...
✅ Socket.io connected

🚗 Starting live location updates...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 [0%] Point 1/245: 28.704100, 77.102500 | Heading: 45°
📍 [0%] Point 2/245: 28.704050, 77.102600 | Heading: 42°
📍 [0%] Point 3/245: 28.704000, 77.102700 | Heading: 40°
...
```

### Test 3: View in Mobile App

1. **Open the LiveNavigationScreen on your phone/emulator**

2. **Pass the order ID as a route parameter:**

   ```typescript
   // In your navigation stack or screen that navigates to LiveNavigationScreen:
   navigation.navigate('LiveNavigation', { orderId: 'test-order-123' })
   ```

3. **Open Expo and launch the app**

4. **While the app is open on the map, run the simulator** (from Step 2)

5. **Watch the blue marker move in real-time** as the simulator emits location updates!

---

## 🎯 How It Works

### Backend → Frontend Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Frontend requests initial route                     │
│ GET /api/navigation/order/{orderId}                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Backend returns:                                             │
│ - Shop location                                              │
│ - Customer location                                          │
│ - Full polyline (array of coordinates)                       │
│ - Distance and ETA                                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Frontend connects to Socket.io                       │
│ Emits: "order:track" event with orderId                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Backend emits live location updates                 │
│ Event: "shop:location:updated"                              │
│ Data: { orderId, latitude, longitude, heading, speed }      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Frontend updates marker position                    │
│ - Updates driverLocation state                              │
│ - Animates map camera to follow driver                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Result: Blue marker moves smoothly across OSM map           │
│ in real-time as new coordinates arrive!                     │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

#### `LiveNavigationScreen.tsx`
- Renders the map with OpenStreetMap tiles
- Fetches initial route from backend
- Listens to Socket.io for location updates
- Animates driver marker and camera as data arrives

#### `/api/navigation/order/:orderId`
- Fetches order details (shop & customer locations)
- Queries OSRM for the route between them
- Returns polyline coordinates and ETA

#### `simulateLiveNavigation.js`
- Connects to Socket.io as a client
- Loops through polyline coordinates
- Emits each coordinate as a "shop:location:updated" event
- Simulates realistic heading and speed values

---

## 🐛 Troubleshooting

### "Cannot connect to backend"

**Check:**
1. Is the backend running? (`npm run dev`)
2. Is the backend URL correct in the simulator?
3. Are you using the correct IP? (10.0.2.2 for Android, 127.0.0.1 for iOS)
4. Is Socket.io port 5000 open? (not blocked by firewall)

### "Route fetch fails"

**Check:**
1. Is the order ID correct?
2. Is OSRM API accessible? (test: `curl https://router.project-osrm.org/route/v1/driving/77.1025,28.7041;77.1855,28.5244?overview=full`)
3. Check backend logs for errors

### "Marker doesn't move"

**Check:**
1. Is the simulator running? (`npm run simulate:navigation`)
2. Is it connected to the same backend?
3. Is the Socket.io connection active on the frontend? (check console logs)
4. Are you listening to the correct Socket.io event name?

### "Simulator stops after a few updates"

**Check:**
1. Are you using `--repeat 1` or `-r 1`? It will stop after one route
2. Use `-r 0` or `--repeat 0` for infinite loop
3. Check for errors in the simulator output

---

## 📱 Customization

### Change Update Frequency

```bash
# Faster updates (every 1 second)
npm run simulate:navigation -- --speed 1000

# Slower updates (every 5 seconds)
npm run simulate:navigation -- --speed 5000
```

### Use Custom Coordinates

Edit the mock coordinates in [navigationRoute.js](routes/navigationRoute.js#L220):

```javascript
const mockOrder = {
  shop_location: { latitude: 28.7041, longitude: 77.1025 },    // Your shop
  customer_location: { latitude: 28.5244, longitude: 77.1855 }, // Your customer
};
```

### Customize the Map Style

In [LiveNavigationScreen.tsx](NexKirana/src/screens/LiveNavigationScreen.tsx), modify the OSM tile URL:

```typescript
<UrlTile
  urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"  // Default OSM
  // Or use other providers:
  // urlTemplate="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"  // Topographic
  // urlTemplate="https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png"  // Dark mode
  maximumZ={19}
  flipY={false}
/>
```

---

## 🎓 Next Steps

1. **Integrate with real orders**: Connect the mock order data to your database
2. **Add authentication**: Implement token verification in the Socket.io connection
3. **Real driver tracking**: Replace the simulator with actual GPS data from the driver app
4. **Custom markers**: Replace pin colors with custom bike/scooter images
5. **Advanced features**:
   - Real-time traffic updates
   - Alternative route suggestions
   - Delivery partner ratings and reviews
   - Customer notifications at key milestones

---

## 📚 Additional Resources

- [react-native-maps documentation](https://github.com/react-native-maps/react-native-maps)
- [OpenStreetMap tile servers](https://wiki.openstreetmap.org/wiki/Tile_servers)
- [OSRM API documentation](https://router.project-osrm.org/)
- [Socket.io documentation](https://socket.io/docs/)

---

**Need help?** Check the console logs on both the backend and frontend for debugging information.
