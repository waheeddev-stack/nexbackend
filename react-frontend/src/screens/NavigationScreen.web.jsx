import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

const autoTrackUserLocation = async (): Promise<{
  latitude: number;
  longitude: number;
  address: string;
  source: 'GPS' | 'IP' | 'Default';
}> => {
  let lat = 28.6139;
  let lng = 77.209;
  let source: 'GPS' | 'IP' | 'Default' = 'Default';

  // 1. Try HTML5 Browser Geolocation first with generous timeout
  try {
    const coords = await new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
      if (typeof window !== 'undefined' && 'navigator' in window && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          (err) => reject(err),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      } else {
        reject(new Error('No browser geolocation'));
      }
    });
    lat = coords.latitude;
    lng = coords.longitude;
    source = 'GPS';
  } catch (gpsErr) {
    console.warn('GPS geolocation failed, automatically tracking via IP location...', gpsErr);
    // 2. Automatic IP-Based Geolocation Fallback
    try {
      const res = await fetch('https://ipwho.is/');
      const data = await res.json();
      if (data && data.success && data.latitude && data.longitude) {
        lat = data.latitude;
        lng = data.longitude;
        source = 'IP';
      } else {
        const res2 = await fetch('https://get.geojs.io/v1/ip/geo.json');
        const data2 = await res2.json();
        if (data2 && data2.latitude && data2.longitude) {
          lat = parseFloat(data2.latitude);
          lng = parseFloat(data2.longitude);
          source = 'IP';
        }
      }
    } catch (ipErr) {
      console.warn('IP geolocation failed', ipErr);
    }
  }

  // 3. Automatically track and convert Lat/Lng to Real Street Address via OpenStreetMap Nominatim
  let address = source === 'IP' ? 'Approximate City Location' : 'Current GPS Location';
  try {
    const revRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    );
    const revData = await revRes.json();
    if (revData && revData.display_name) {
      const parts = revData.display_name.split(', ');
      address = parts.slice(0, 3).join(', ');
    }
  } catch (revErr) {
    console.warn('Reverse geocoding address fetch failed', revErr);
  }

  return { latitude: lat, longitude: lng, address, source };
};

export default function NavigationScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { shop } = route.params as RouteParams;

  const shopName = shop?.shop_name || 'Pooja Super Market';
  const address = shop?.address || '4th Avenue, Near Main Road';
  const destLat = shop?.latitude || 28.6139;
  const destLng = shop?.longitude || 77.209;
  const distanceKm = shop?.distance_km || 2.4;

  const [startLoc, setStartLoc] = useState({ latitude: destLat - 0.012, longitude: destLng - 0.010 });
  const [detectedAddress, setDetectedAddress] = useState<string>('Tracking address...');
  const [routeCoords, setRouteCoords] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [steps, setSteps] = useState<Array<{ instruction: string; street: string; iconName: string; distance: number }>>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [minsRemaining, setMinsRemaining] = useState(7);
  const [distanceRemaining, setDistanceRemaining] = useState(distanceKm);
  const [loading, setLoading] = useState(true);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);

  useEffect(() => {
    const fetchRouteAndStart = async () => {
      setLoading(true);
      const locData = await autoTrackUserLocation();
      const startLat = locData.latitude;
      const startLng = locData.longitude;

      setStartLoc({ latitude: startLat, longitude: startLng });
      setDetectedAddress(locData.address || 'Your Tracked Address');

      // 2. Fetch OSRM directions from backend or directly
      try {
        const url = `http://127.0.0.1:5000/api/navigation/directions?startLat=${startLat}&startLng=${startLng}&destLat=${destLat}&destLng=${destLng}`;
        const res = await fetch(url);
        const data = await res.json();

        const polyline = data.polyline || data.coordinates || [];
        setRouteCoords(polyline);
        setSteps(data.steps || []);
        setDistanceRemaining(data.distanceKm ?? data.distance_km ?? distanceKm);
        setMinsRemaining(data.durationMins ?? data.duration_mins ?? 7);
      } catch (error) {
        console.warn('Backend directions API failed, building fallback route', error);
        const fallback = [
          { latitude: startLat, longitude: startLng },
          { latitude: startLat + (destLat - startLat) * 0.3, longitude: startLng + (destLng - startLng) * 0.3 },
          { latitude: startLat + (destLat - startLat) * 0.7, longitude: startLng + (destLng - startLng) * 0.7 },
          { latitude: destLat, longitude: destLng },
        ];
        setRouteCoords(fallback);
        setSteps([
          { instruction: 'Proceed toward route', street: `from ${locData.address || 'your address'}`, iconName: 'arrow-up', distance: 500 },
          { instruction: 'In 300m, turn left', street: 'onto Shop Lane', iconName: 'arrow-undo', distance: 300 },
          { instruction: 'You are arriving', street: `at ${shopName}`, iconName: 'pin', distance: 0 },
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchRouteAndStart();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Initialize Leaflet map whenever loading completes or coordinates update
  useEffect(() => {
    if (loading || routeCoords.length === 0) return;

    const initLeafletMap = async () => {
      if (!(window as any).L) {
        await new Promise<void>((resolve) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(link);

          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => resolve();
          document.head.appendChild(script);
        });
      }

      const L = (window as any).L;
      if (!L || !mapContainerRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
      }

      // Center map on user's exact starting location
      const map = L.map(mapContainerRef.current).setView([startLoc.latitude, startLoc.longitude], 16);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 250);

      // Draw route line
      const pathPoints = routeCoords.map((c) => [c.latitude, c.longitude]);
      polylineRef.current = L.polyline(pathPoints, {
        color: '#1d70e7',
        weight: 6,
        opacity: 0.85,
      }).addTo(map);

      if (pathPoints.length > 1) {
        map.fitBounds(polylineRef.current.getBounds(), { padding: [50, 50] });
      }

      const initialHeading = routeCoords.length > 1
        ? calculateBearing(routeCoords[0].latitude, routeCoords[0].longitude, routeCoords[1].latitude, routeCoords[1].longitude)
        : 0;

      // User marker with tracked address
      const arrowIcon = L.divIcon({
        className: 'user-navigation-arrow-marker',
        html: `
          <div id="nav-arrow-wrapper" style="
            transform: rotate(${initialHeading}deg); 
            display: flex; 
            justify-content: center; 
            align-items: center;
            transition: transform 0.3s ease;
            position: relative;
          ">
            <svg width="36" height="36" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="14" fill="rgba(37, 99, 235, 0.25)" stroke="#ffffff" stroke-width="2"/>
              <path d="M16 5 L24 24 L16 19 L8 24 Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      userMarkerRef.current = L.marker([startLoc.latitude, startLoc.longitude], { icon: arrowIcon })
        .addTo(map)
        .bindPopup(`<b>📍 Starting from:</b><br>${detectedAddress}`)
        .openPopup();

      // Shop Marker
      const shopIcon = L.divIcon({
        className: 'destination-shop-marker',
        html: `
          <div style="align-items: center; display: flex; flex-direction: column; justify-content: center;">
            <div style="
              width: 38px; 
              height: 38px; 
              background-color: #2563eb; 
              border: 2px solid #fff; 
              border-radius: 50%; 
              display: flex; 
              justify-content: center; 
              align-items: center;
              box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            ">
              <span style="font-size: 18px; color: white;">🛒</span>
            </div>
            <div style="
              background-color: #2563eb; 
              padding: 2px 8px; 
              border-radius: 6px; 
              margin-top: 4px; 
              box-shadow: 0 2px 4px rgba(0,0,0,0.15);
            ">
              <span style="color: white; font-size: 10px; font-weight: bold; font-family: sans-serif; white-space: nowrap;">NexKirana</span>
            </div>
          </div>
        `,
        iconSize: [60, 60],
        iconAnchor: [30, 48],
      });

      L.marker([destLat, destLng], { icon: shopIcon }).addTo(map);
    };

    initLeafletMap();
  }, [loading, routeCoords, startLoc, detectedAddress]);

  // Simulate user movement along coords
  useEffect(() => {
    if (loading || routeCoords.length === 0) return;

    const interval = setInterval(() => {
      setCurrentStepIdx((prevIdx) => {
        const nextIdx = prevIdx + 1;
        if (nextIdx < routeCoords.length) {
          const currentLoc = routeCoords[prevIdx];
          const nextLoc = routeCoords[nextIdx];

          const heading = calculateBearing(
            currentLoc.latitude,
            currentLoc.longitude,
            nextLoc.latitude,
            nextLoc.longitude
          );

          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([nextLoc.latitude, nextLoc.longitude]);
            const arrowDom = document.getElementById('nav-arrow-wrapper');
            if (arrowDom) {
              arrowDom.style.transform = `rotate(${heading}deg)`;
            }
          }

          if (mapRef.current) {
            mapRef.current.panTo([nextLoc.latitude, nextLoc.longitude]);
          }

          setMinsRemaining((prevMins) => Math.max(1, prevMins - 1));
          setDistanceRemaining((prevDist) => Math.max(0.1, +(prevDist - 0.2).toFixed(1)));
          return nextIdx;
        } else {
          clearInterval(interval);
          return prevIdx;
        }
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [loading, routeCoords]);

  const currentInstruction = steps[Math.min(currentStepIdx, steps.length - 1)] || {
    instruction: 'Continue straight',
    street: `from ${detectedAddress}`,
    iconName: 'arrow-up',
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 1. TOP HEADER BAR matching navigation.jsx */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#0f172a" />
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>NexKirana</Text>
          <Text style={styles.headerSubtitle}>{shopName}</Text>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.timerBadge}>
            <Ionicons name="time-outline" size={16} color="#f97316" />
            <Text style={styles.timerText}>{minsRemaining} mins</Text>
          </View>
          <TouchableOpacity style={styles.cartButton}>
            <Ionicons name="cart-outline" size={20} color="#334155" />
          </TouchableOpacity>
        </View>
      </View>

      {/* MAP AND FLOATING CARD */}
      <View style={styles.mapContainer}>
        <div 
          ref={mapContainerRef} 
          style={{ 
            width: '100%', 
            height: '100%', 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            outline: 'none', 
            zIndex: 1 
          }} 
        />

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1d4ed8" />
            <Text style={styles.loadingText}>Auto-tracking your exact address & calculating route...</Text>
          </View>
        )}

        {!loading && (
          <View style={styles.turnCard}>
            <View style={styles.turnIconContainer}>
              <Ionicons name={currentInstruction.iconName as any} size={26} color="#0a42aa" />
            </View>
            <View style={styles.turnTextContainer}>
              <Text style={styles.turnMainText}>{currentInstruction.instruction}</Text>
              <Text style={styles.turnSubText} numberOfLines={1}>{currentInstruction.street}</Text>
            </View>
          </View>
        )}
      </View>

      {/* 3. BOTTOM PANEL matching navigation.jsx */}
      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        <View style={styles.statsContainer}>
          <View style={styles.timeMainContainer}>
            <Text style={styles.timeNumber}>{minsRemaining}</Text>
            <Text style={styles.timeLabel}> mins</Text>
          </View>

          <View style={styles.subStatsRow}>
            <View style={styles.subStatItem}>
              <Ionicons name="time-outline" size={16} color="#64748b" />
              <Text style={styles.subStatText}>10:45 AM</Text>
            </View>
            <View style={styles.subStatItem}>
              <Ionicons name="navigate-outline" size={16} color="#64748b" />
              <Text style={styles.subStatText}>{distanceRemaining} km</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.exitButton} onPress={() => navigation.goBack()}>
          <Text style={styles.exitButtonText}>Exit Navigation</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backButton: {
    padding: 8,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    backgroundColor: '#fff7ed',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: '#ffedd5',
  },
  timerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ea580c',
    marginLeft: 4,
  },
  cartButton: {
    padding: 8,
    backgroundColor: '#f1f5f9',
    borderRadius: 9999,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    marginTop: 12,
    color: '#1d4ed8',
    fontSize: 16,
    fontWeight: '600',
  },
  turnCard: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: '#0a42aa',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 1000,
  },
  turnIconContainer: {
    width: 48,
    height: 48,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  turnTextContainer: {
    marginLeft: 16,
    flex: 1,
  },
  turnMainText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  turnSubText: {
    color: '#bfdbfe',
    fontSize: 14,
    marginTop: 2,
  },
  bottomSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    zIndex: 1000,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#e2e8f0',
    borderRadius: 9999,
    alignSelf: 'center',
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  timeMainContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  timeNumber: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0f172a',
  },
  timeLabel: {
    fontSize: 16,
    color: '#0f172a',
    fontWeight: '600',
  },
  subStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
  },
  subStatText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginLeft: 4,
  },
  exitButton: {
    backgroundColor: '#2563eb',
    borderRadius: 16,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  exitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
