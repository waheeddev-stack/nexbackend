# ⚡ Quick Start: Test Real-Time Navigation in 5 Minutes

## One-Time Setup

```bash
# Terminal 1: Backend
cd nexkirana-workspace/nexbackend
npm install
npm run dev

# Terminal 2: Frontend (wait for backend to start)
cd nexkirana-workspace/NexKirana
npm install
npm start
# Press 'a' for Android or 'i' for iOS
```

## Run the Simulation

```bash
# Terminal 3: Simulator (wait for frontend to load)
cd nexkirana-workspace/nexbackend
npm run simulate:navigation
```

## What You Should See

**Frontend (Mobile App):**
- Map loads with OpenStreetMap tiles
- Red pin at customer location
- Blue pin at shop location
- Blue line showing the route

**As Simulator Runs:**
- Blue pin moves smoothly along the route
- Map camera follows the pin
- ETA countdown updates

**Simulator Output:**
```
📍 [0%] Point 1/245: 28.704100, 77.102500 | Heading: 45°
📍 [1%] Point 2/245: 28.704050, 77.102600 | Heading: 42°
📍 [2%] Point 3/245: 28.704000, 77.102700 | Heading: 40°
...
✅ Simulation complete!
```

---

## Simulation Options

```bash
# Speed up the animation (update every 1 second)
npm run simulate:navigation -- --speed 1000

# Slow down (update every 5 seconds)
npm run simulate:navigation -- --speed 5000

# Run 3 times (restart after completing route)
npm run simulate:navigation -- --repeat 3

# Use custom order ID
npm run simulate:navigation -- --orderId my-delivery-123

# Combine options
npm run simulate:navigation -- -o order-456 -s 1000 -r 2
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Simulator can't connect | Ensure backend is running on `localhost:5000` |
| Blue marker doesn't move | Check browser/app console for Socket.io errors |
| Map is blank | Ensure internet connection for OSM tiles |
| Frontend crashes | Check that expo packages are installed |

---

**All systems working?** 🎉 You have a real-time delivery tracking system!

Next: Replace mock coordinates with real database orders, integrate actual driver GPS, and customize the UI.
