import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import socketService from '../services/socket';

const getDistanceKm = (shop) => shop.distance_km ?? shop.distanceKm ?? 0;

const autoTrackUserLocation = async () => {
  let lat = 28.6139;
  let lng = 77.209;
  let source = 'Default';

  // 1. Try HTML5 Browser Geolocation first with generous timeout
  try {
    const coords = await new Promise((resolve, reject) => {
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
    console.log('Successfully acquired high-accuracy GPS location:', lat, lng);
  } catch (gpsErr) {
    console.warn('GPS geolocation failed or permission denied. Automatically tracking via IP location...', gpsErr);
    // 2. Automatic IP-Based Geolocation Fallback so we never default to wrong city
    try {
      const res = await fetch('https://ipwho.is/');
      const data = await res.json();
      if (data && data.success && data.latitude && data.longitude) {
        lat = data.latitude;
        lng = data.longitude;
        source = 'IP';
        console.log('Successfully acquired automatic IP geolocation:', lat, lng);
      } else {
        const res2 = await fetch('https://get.geojs.io/v1/ip/geo.json');
        const data2 = await res2.json();
        if (data2 && data2.latitude && data2.longitude) {
          lat = parseFloat(data2.latitude);
          lng = parseFloat(data2.longitude);
          source = 'IP';
          console.log('Successfully acquired backup IP geolocation:', lat, lng);
        }
      }
    } catch (ipErr) {
      console.warn('IP geolocation failed, using default fallback', ipErr);
    }
  }

  // 3. Automatically track and convert Lat/Lng to Real Human Street Address via OpenStreetMap Nominatim
  let address = source === 'IP' ? 'Approximate City Location' : 'Current GPS Location';
  try {
    const revRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    );
    const revData = await revRes.json();
    if (revData && revData.display_name) {
      // Format a clean, concise address from display_name
      const parts = revData.display_name.split(', ');
      address = parts.slice(0, 3).join(', ');
    }
  } catch (revErr) {
    console.warn('Reverse geocoding address fetch failed', revErr);
  }

  return { latitude: lat, longitude: lng, address, source };
};

const NearbyShopsMap = ({ onShopsLoaded }) => {
  const navigation = useNavigation();
  const [userLocation, setUserLocation] = useState({
    latitude: 28.6139,
    longitude: 77.209,
  });
  const [detectedAddress, setDetectedAddress] = useState('Detecting your address...');
  const [locationSource, setLocationSource] = useState('Locating...');
  const [shops, setShops] = useState([]);
  const [liveLocations, setLiveLocations] = useState({});
  const [routeCoords, setRouteCoords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedShop, setSelectedShop] = useState(null);
  const [debugDetails, setDebugDetails] = useState('');
  
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const markersRef = useRef({});
  const userMarkerRef = useRef(null);
  const hasInitializedMapRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const drawRouteOnMap = (coords) => {
    const L = window.L;
    if (!L || !mapRef.current) return;

    if (routeLayerRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (coords.length === 0) return;

    const latlngs = coords.map((coord) => [coord.latitude, coord.longitude]);
    routeLayerRef.current = L.polyline(latlngs, {
      color: '#0ea5e9',
      weight: 6,
      opacity: 0.95,
      lineJoin: 'round',
      dashArray: '10,6',
    }).addTo(mapRef.current);

    try {
      mapRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
    } catch (err) {
      console.warn('Unable to fit bounds for route', err);
    }
  };

  useEffect(() => {
    const loadLocationAndShops = async () => {
      setLoading(true);
      const locData = await autoTrackUserLocation();
      const lat = locData.latitude;
      const lng = locData.longitude;

      setUserLocation({ latitude: lat, longitude: lng });
      setDetectedAddress(locData.address || 'Your Current Location');
      setLocationSource(locData.source === 'GPS' ? 'Exact GPS Satellite' : 'Auto-Tracked Network IP');

      try {
        const response = await fetch(`http://127.0.0.1:5000/api/navigation/nearby?lat=${lat}&lng=${lng}&radiusKm=5`);
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Nearby shops API error');
        }

        const normalizedShops = (data.shops || []).map((shop) => ({
          ...shop,
          distance_km: shop.distance_km ?? shop.distanceKm ?? 0,
        }));

        setShops(normalizedShops);
        if (onShopsLoaded) onShopsLoaded(normalizedShops);
        
        setSelectedShop(normalizedShops[0] ?? null);
        setDebugDetails(`Loaded ${normalizedShops.length} shops, nearest: ${normalizedShops[0]?.shop_name || 'none'}`);
        if (normalizedShops.length > 0) {
          const nearest = normalizedShops[0];
          await fetchRoute(lat, lng, nearest.latitude, nearest.longitude);
        }
      } catch (error) {
        console.warn('Failed to load nearby shops from API', error);
        setShops([]);
        if (onShopsLoaded) onShopsLoaded([]);
      } finally {
        setLoading(false);
      }
    };

    loadLocationAndShops();

    socketService.connect();
    socketService.onLocationUpdate((data) => {
      setLiveLocations((prev) => ({
        ...prev,
        [data.shopId]: {
          latitude: data.latitude,
          longitude: data.longitude
        }
      }));
    });

    return () => {
      socketService.offLocationUpdate();
      socketService.disconnect();
    };
  }, []);

  const fetchRoute = async (startLat, startLng, endLat, endLng) => {
    setRouteCoords([]);
    const fallbackPoints = [
      { latitude: startLat, longitude: startLng },
      { latitude: endLat, longitude: endLng },
    ];

    try {
      const response = await fetch(
        `http://127.0.0.1:5000/api/navigation/directions?startLat=${startLat}&startLng=${startLng}&destLat=${endLat}&destLng=${endLng}`
      );
      const data = await response.json();

      if (data.success && data.polyline && data.polyline.length > 0) {
        setRouteCoords(data.polyline);
        return;
      }

      console.warn('Navigation endpoint returned no polyline. Falling back to straight-line path.', data);
    } catch (error) {
      console.warn('Navigation route fetch failed, using fallback line:', error);
    }

    setRouteCoords(fallbackPoints);
  };

  useEffect(() => {
    if (loading) return;

    if (shops.length > 0 && routeCoords.length === 0 && userLocation.latitude && userLocation.longitude) {
      const nearest = shops[0];
      fetchRoute(userLocation.latitude, userLocation.longitude, nearest.latitude, nearest.longitude);
    }


    const initMap = async () => {
      if (mapRef.current || !mapContainerRef.current) {
        return;
      }

      if (!window.L) {
        await new Promise((resolve) => {
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

      const L = window.L;
      if (!L) return;

      const map = L.map(mapContainerRef.current, {
        center: [userLocation.latitude, userLocation.longitude],
        zoom: 15,
        scrollWheelZoom: true,
        zoomControl: true,
      });
      mapRef.current = map;
      setMapReady(true);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 250);

      const userIcon = L.divIcon({
        className: 'user-location-marker',
        html: `
          <div style="position: relative; display: flex; align-items: center; justify-content: center;">
            <div style="width: 24px; height: 24px; background-color: #0ea5e9; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 12px rgba(14, 165, 233, 0.8);"></div>
            <div style="position: absolute; top: -32px; background: #0f172a; color: #fff; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: bold; white-space: nowrap; border: 1px solid #38bdf8; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
              📍 You Are Here
            </div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      userMarkerRef.current = L.marker([userLocation.latitude, userLocation.longitude], { icon: userIcon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family: sans-serif; padding: 4px; max-width: 220px;">
            <b style="color: #0ea5e9; font-size: 14px;">📍 Your Auto-Detected Address</b>
            <p style="margin: 6px 0 0 0; font-size: 12px; color: #334155; line-height: 1.4;">${detectedAddress}</p>
            <div style="margin-top: 6px; font-size: 10px; color: #64748b; font-style: italic;">Source: ${locationSource}</div>
          </div>
        `)
        .openPopup();
    };

    initMap();
  }, [loading, userLocation, detectedAddress, locationSource]);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current || !mapReady) return;

    Object.values(markersRef.current).forEach((marker) => {
      if (marker && mapRef.current.hasLayer && mapRef.current.hasLayer(marker)) {
        mapRef.current.removeLayer(marker);
      }
    });
    markersRef.current = {};

    shops.forEach((shop) => {
      const isLive = !!liveLocations[shop.id];
      const color = isLive ? '#ef4444' : '#2563eb';
      const shopIcon = L.divIcon({
        className: `shop-marker-${shop.id}`,
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div style=\"background:${color};color:#fff;padding:6px 10px;border-radius:10px;font-size:12px;font-weight:800;box-shadow:0 6px 18px rgba(11,99,255,0.12);white-space:nowrap;\">${shop.shop_name}</div>
            <div style=\"width:40px;height:40px;background:${color};border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;margin-top:6px;font-size:16px;box-shadow:0 6px 18px rgba(11,99,255,0.14);\">🛒</div>
          </div>
        `,
        iconSize: [80, 80],
        iconAnchor: [40, 80]
      });

      const marker = L.marker([shop.latitude, shop.longitude], { icon: shopIcon })
        .addTo(mapRef.current)
        .bindPopup(`
          <div style="font-family: sans-serif; padding: 6px; min-width: 170px;">
            <h4 style="margin: 0 0 4px 0; color: #1e293b; font-size: 15px;">${shop.shop_name}</h4>
            <p style="margin: 0 0 10px 0; font-size: 12px; color: #64748b;">${shop.address}</p>
            <button id="btn-nav-${shop.id}" style="
              background-color: #2563eb; 
              color: #fff; 
              border: none; 
              padding: 8px 12px; 
              border-radius: 6px; 
              cursor: pointer;
              font-weight: 700;
              width: 100%;
              font-size: 13px;
            ">Start Navigation</button>
          </div>
        `);

      marker.on('popupopen', () => {
        const btn = document.getElementById(`btn-nav-${shop.id}`);
        if (btn) {
          btn.onclick = () => {
            navigation.navigate('Navigation', { shop });
          };
        }
      });

      markersRef.current[shop.id] = marker;
    });
  }, [shops, mapReady, liveLocations, navigation]);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current || routeCoords.length === 0 || !mapReady) return;

    drawRouteOnMap(routeCoords);
  }, [routeCoords, mapReady]);

  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current) return;

    Object.keys(liveLocations).forEach((shopId) => {
      const marker = markersRef.current[shopId];
      const loc = liveLocations[+shopId];
      if (marker && loc) {
        marker.setLatLng([loc.latitude, loc.longitude]);
      }
    });
  }, [liveLocations]);

  const selectShopHandler = async (shop) => {
    setSelectedShop(shop);
    await fetchRoute(userLocation.latitude, userLocation.longitude, shop.latitude, shop.longitude);
    const L = window.L;
    if (mapRef.current && L) {
      mapRef.current.setView([shop.latitude, shop.longitude], 16);
      const marker = markersRef.current[shop.id];
      if (marker) {
        marker.openPopup();
      }
    }
  };

  return (
    <div
      ref={mapContainerRef}
      style={{ flex: 1, width: '100%', height: '100%', outline: 'none' }}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    minHeight: '100vh',
    paddingBottom: 20,
  },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
  },
  pageHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pageHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    color: '#1d4ed8',
    fontSize: 20,
    fontWeight: '700',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#0f4db6',
    marginLeft: 6,
    letterSpacing: 0.3,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#fde9c7',
  },
  timerIcon: {
    fontSize: 14,
    color: '#b87f00',
  },
  timerText: {
    marginLeft: 8,
    color: '#7b4d00',
    fontWeight: '800',
  },
  cartButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: 18,
  },
  searchBar: {
    marginHorizontal: 18,
    marginBottom: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: '#ffffff',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#e6eef6',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    boxShadow: '0 8px 20px rgba(11,37,64,0.06)',
  },
  searchIcon: {
    fontSize: 18,
    color: '#64748b',
  },
  searchPlaceholder: {
    flex: 1,
    color: '#9aa4b2',
    fontSize: 15,
  },
  searchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchActionButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    color: '#1d4ed8',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    cursor: 'pointer',
  },
  mapCard: {
    height: 360,
    marginHorizontal: 14,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6eef6',
    position: 'relative',
    boxShadow: '0 20px 50px rgba(11,37,64,0.06)',
  },
  mapOverlay: {
    position: 'absolute',
    right: 16,
    top: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    zIndex: 10,
  },
  mapActionButton: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e6eef6',
    cursor: 'pointer',
    boxShadow: '0 8px 20px rgba(2,6,23,0.06)',
  },
  listPanel: {
    flex: 1,
    marginTop: -44,
    paddingTop: 18,
    paddingHorizontal: 20,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    minHeight: 420,
  },
  panelHandle: {
    width: 64,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e6eef6',
    alignSelf: 'center',
    marginBottom: 16,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  panelAction: {
    fontSize: 14,
    color: '#1d4ed8',
    fontWeight: '800',
  },
  panelSubtitle: {
    color: '#64748b',
    fontSize: 13,
    marginBottom: 16,
  },
  shopList: {
    gap: 12,
    display: 'flex',
    flexDirection: 'column',
  },
  shopItem: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    cursor: 'pointer',
    boxShadow: '0 12px 30px rgba(2,6,23,0.04)',
  },
  shopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  shopBadge: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#fff5f0',
    justifyContent: 'center',
    alignItems: 'center',
    display: 'flex',
  },
  shopBadgeIcon: {
    fontSize: 22,
  },
  shopInfo: {
    flex: 1,
  },
  shopName: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 6,
  },
  shopAddress: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 8,
  },
  shopMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    display: 'flex',
  },
  shopMetaText: {
    fontSize: 12,
    color: '#475569',
  },
  shopMetaDot: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  openTag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#dcfce7',
    color: '#166534',
    fontWeight: '700',
    fontSize: 11,
    minWidth: 64,
    textAlign: 'center',
  },
  startButton: {
    backgroundColor: '#0b63ff',
    color: '#ffffff',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    border: 'none',
    fontWeight: '800',
    cursor: 'pointer',
    width: '100%',
    boxShadow: '0 8px 20px rgba(11,99,255,0.18)',
  },
  bottomCard: {
    position: 'fixed',
    left: 14,
    right: 14,
    bottom: 18,
    height: 100,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    boxShadow: '0 20px 40px rgba(2,6,23,0.08)',
    zIndex: 30,
  },
  bottomCardLeft: {
    display: 'flex',
    flexDirection: 'column',
  },
  bottomCardTime: {
    fontSize: 36,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 6,
  },
  bottomCardMeta: {
    color: '#64748b',
    fontSize: 13,
  },
  bottomCardRight: {
    width: 260,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomCardButton: {
    backgroundColor: '#0b63ff',
    color: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 12,
    fontWeight: '900',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 12px 30px rgba(11,99,255,0.18)',
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(248,250,252,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  loadingText: {
    marginTop: 12,
    color: '#2563eb',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default NearbyShopsMap;
