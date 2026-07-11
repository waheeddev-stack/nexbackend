import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform, ScrollView } from 'react-native';
import * as Location from 'expo-location';

interface Shopkeeper {
  id: number;
  shop_name: string;
  name: string;
  latitude: number;
  longitude: number;
  distance: number;
  distanceKm?: number;
}

interface LocationCoords {
  latitude: number;
  longitude: number;
}

// Detect backend URL based on platform
const getBackendUrl = () => {
  return Platform.select({
    ios: 'http://127.0.0.1:5000',
    android: 'http://10.0.2.2:5000',
    default: 'http://127.0.0.1:5000',
  });
};

const BACKEND_URL = getBackendUrl();

// Web-only component for displaying map with shops
function WebMapView({ userLocation, shops, routeCoords }: any) {
  const mapWidth = 600;
  const mapHeight = 500;

  // Calculate bounds to center map on all points
  const allPoints = [userLocation, ...shops, ...routeCoords].filter(p => p);
  const lats = allPoints.map(p => p.latitude);
  const lngs = allPoints.map(p => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const latRange = maxLat - minLat;
  const lngRange = maxLng - minLng;
  const padding = 0.2;

  // Project lat/lng to pixel coordinates
  const projectToPixel = (lat: number, lng: number) => {
    const y = ((lat - minLat + latRange * padding / 2) / (latRange + latRange * padding)) * mapHeight;
    const x = ((lng - minLng + lngRange * padding / 2) / (lngRange + lngRange * padding)) * mapWidth;
    return { x, y };
  };

  // Create SVG path for polyline
  const polylinePath = routeCoords.length > 0
    ? `M ${routeCoords.map(coord => {
        const { x, y } = projectToPixel(coord.latitude, coord.longitude);
        return `${x},${y}`;
      }).join(' L ')}`
    : '';

  return (
    <View style={webStyles.mapContainer}>
      <View style={webStyles.mapBackground}>
        <svg width={mapWidth} height={mapHeight} style={webStyles.svgMap}>
          {/* Background */}
          <rect width={mapWidth} height={mapHeight} fill="#e8f4f8" />

          {/* Grid */}
          {[...Array(5)].map((_, i) => (
            <React.Fragment key={`grid-h-${i}`}>
              <line
                x1={0}
                y1={(i / 4) * mapHeight}
                x2={mapWidth}
                y2={(i / 4) * mapHeight}
                stroke="#ddd"
                strokeWidth="1"
              />
            </React.Fragment>
          ))}
          {[...Array(5)].map((_, i) => (
            <React.Fragment key={`grid-v-${i}`}>
              <line
                x1={(i / 4) * mapWidth}
                y1={0}
                x2={(i / 4) * mapWidth}
                y2={mapHeight}
                stroke="#ddd"
                strokeWidth="1"
              />
            </React.Fragment>
          ))}

          {/* Blue polyline to nearest shop */}
          {polylinePath && (
            <path d={polylinePath} stroke="#0066ff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* Shop markers */}
          {shops.map((shop, idx) => {
            const { x, y } = projectToPixel(shop.latitude, shop.longitude);
            const isNearest = idx === 0;
            return (
              <g key={`shop-${idx}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={isNearest ? 12 : 10}
                  fill={isNearest ? '#22c55e' : '#ef4444'}
                  stroke="white"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dy="0.3em"
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                >
                  {idx + 1}
                </text>
              </g>
            );
          })}

          {/* User location marker */}
          {userLocation && (
            <g>
              <circle
                cx={projectToPixel(userLocation.latitude, userLocation.longitude).x}
                cy={projectToPixel(userLocation.latitude, userLocation.longitude).y}
                r="10"
                fill="#3b82f6"
                stroke="white"
                strokeWidth="2"
              />
              <circle
                cx={projectToPixel(userLocation.latitude, userLocation.longitude).x}
                cy={projectToPixel(userLocation.latitude, userLocation.longitude).y}
                r="6"
                fill="white"
              />
            </g>
          )}
        </svg>
      </View>

      {/* Legend */}
      <View style={webStyles.legend}>
        <View style={webStyles.legendItem}>
          <View style={{ ...webStyles.legendColor, backgroundColor: '#3b82f6' }} />
          <Text style={webStyles.legendText}>Your Location</Text>
        </View>
        <View style={webStyles.legendItem}>
          <View style={{ ...webStyles.legendColor, backgroundColor: '#22c55e' }} />
          <Text style={webStyles.legendText}>Nearest Shop (Green)</Text>
        </View>
        <View style={webStyles.legendItem}>
          <View style={{ ...webStyles.legendColor, backgroundColor: '#ef4444' }} />
          <Text style={webStyles.legendText}>Other Shops (Red)</Text>
        </View>
        <View style={webStyles.legendItem}>
          <View style={{ ...webStyles.legendColor, backgroundColor: '#0066ff' }} />
          <Text style={webStyles.legendText}>Route (Blue Line)</Text>
        </View>
      </View>
    </View>
  );
}

const webStyles = StyleSheet.create({
  mapContainer: {
    padding: 20,
    backgroundColor: '#f0f9ff',
    borderRadius: 10,
    marginBottom: 20,
  },
  mapBackground: {
    backgroundColor: '#e8f4f8',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 15,
  },
  svgMap: {
    display: 'block',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 15,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendColor: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 13,
    color: '#333',
  },
});

export default function NearbyShopsMap() {
  const isWeb = Platform.OS === 'web';

  // Dynamic imports for native platforms only
  const [MapView, setMapView] = useState<any>(null);
  const [Marker, setMarker] = useState<any>(null);
  const [Callout, setCallout] = useState<any>(null);
  const [Polyline, setPolyline] = useState<any>(null);
  const [UrlTile, setUrlTile] = useState<any>(null);
  const [MAP_TYPES, setMAP_TYPES] = useState<any>(null);

  useEffect(() => {
    if (!isWeb) {
      import('react-native-maps').then(mod => {
        setMapView(() => mod.default);
        setMarker(() => mod.Marker);
        setCallout(() => mod.Callout);
        setPolyline(() => mod.Polyline);
        setUrlTile(() => mod.UrlTile);
        setMAP_TYPES(mod.MAP_TYPES);
      }).catch(err => console.error('Error loading maps:', err));
    }
  }, [isWeb]);

  const [userLocation, setUserLocation] = useState<LocationCoords | null>(null);
  const [shops, setShops] = useState<Shopkeeper[]>([]);
  const [routeCoords, setRouteCoords] = useState<LocationCoords[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErrorMsg('Permission to access location was denied');
          setLoading(false);
          return;
        }

        let location = await Location.getCurrentPositionAsync({});
        const coords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };

        setUserLocation(coords);
        fetchNearbyShops(coords.latitude, coords.longitude);
      } catch (err) {
        console.error('Error getting location:', err);
        // For web demo - use default location
        if (isWeb) {
          const demoCoords = { latitude: 28.7041, longitude: 77.1025 };
          setUserLocation(demoCoords);
          fetchNearbyShops(demoCoords.latitude, demoCoords.longitude);
        } else {
          setErrorMsg('Error getting location. Please enable GPS.');
          setLoading(false);
        }
      }
    })();
  }, [isWeb]);

  const fetchNearbyShops = async (lat: number, lng: number) => {
    try {
      const API_URL = `${BACKEND_URL}/api/navigation/nearby?lat=${lat}&lng=${lng}&radiusKm=5`;
      console.log('Fetching nearby shops from:', API_URL);

      const response = await fetch(API_URL);
      const result = await response.json();

      if (result.success && result.shops && result.shops.length > 0) {
        console.log('Found shops:', result.shops);
        setShops(result.shops);

        const nearestShop = result.shops[0];
        await fetchRoute(lat, lng, nearestShop.latitude, nearestShop.longitude);
      } else {
        setErrorMsg('No shops found nearby');
      }
    } catch (error) {
      console.error('Failed to fetch shops:', error);
      setErrorMsg('Failed to connect to server.');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoute = async (startLat: number, startLng: number, endLat: number, endLng: number) => {
    try {
      const start = `${startLng},${startLat}`;
      const end = `${endLng},${endLat}`;
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;

      console.log('Fetching route from OSRM:', osrmUrl);
      const response = await fetch(osrmUrl);
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        const points = data.routes[0].geometry.coordinates.map((coord: number[]) => ({
          latitude: coord[1],
          longitude: coord[0],
        }));
        console.log('Route points calculated:', points.length);
        setRouteCoords(points);
      }
    } catch (error) {
      console.error('Failed to calculate route:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0b57d0" />
        <Text style={styles.loadingText}>Finding nearest store & route...</Text>
      </View>
    );
  }

  if (errorMsg || !userLocation) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{errorMsg || 'Location unavailable'}</Text>
      </View>
    );
  }

  // WEB RENDERING - SVG-based map
  if (isWeb) {
    return <WebMapComponent userLocation={userLocation} shops={shops} routeCoords={routeCoords} />;
  }

  // NATIVE RENDERING - react-native-maps
  if (!MapView || !Marker || !Polyline) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0b57d0" />
        <Text style={styles.loadingText}>Loading map components...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapType={MAP_TYPES.NONE}
        initialRegion={{
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        }}
        showsUserLocation={true}
      >
        <UrlTile
          urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
        />

        {shops.map((shop, index) => (
          <Marker
            key={shop.id}
            coordinate={{
              latitude: Number(shop.latitude),
              longitude: Number(shop.longitude),
            }}
            pinColor={index === 0 ? 'green' : 'red'}
          >
            <Callout>
              <View style={styles.calloutContainer}>
                <Text style={styles.shopName}>{shop.shop_name}</Text>
                <Text style={styles.distanceText}>
                  {(shop.distance || shop.distanceKm || 0).toFixed(2)} km away
                </Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#3b82f6"
            strokeWidth={5}
            lineJoin="round"
          />
        )}
      </MapView>

      {shops.length > 0 && (
        <View style={styles.overlay}>
          <Text style={styles.overlayTitle}>Nearest Shop: {shops[0].shop_name}</Text>
          <Text style={styles.overlayText}>Follow the blue line to navigate.</Text>
        </View>
      )}
    </View>
  );
}

// Web component using SVG
function WebMapComponent({ userLocation, shops, routeCoords }: any) {
  const mapWidth = 700;
  const mapHeight = 600;

  if (!userLocation || !shops || shops.length === 0) {
    return (
      <View style={webStyles.container}>
        <Text style={webStyles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  // Calculate bounds
  const allPoints = [userLocation, ...shops, ...routeCoords].filter(p => p && p.latitude && p.longitude);
  const lats = allPoints.map(p => p.latitude);
  const lngs = allPoints.map(p => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latRange = Math.max(maxLat - minLat, 0.01);
  const lngRange = Math.max(maxLng - minLng, 0.01);
  const padding = 0.15;

  const projectToPixel = (lat: number, lng: number) => {
    const y = ((lat - minLat + latRange * padding / 2) / (latRange + latRange * padding)) * mapHeight;
    const x = ((lng - minLng + lngRange * padding / 2) / (lngRange + lngRange * padding)) * mapWidth;
    return { x, y };
  };

  const polylinePoints = routeCoords.map(coord => {
    const { x, y } = projectToPixel(coord.latitude, coord.longitude);
    return `${x},${y}`;
  }).join(' L ');
  const polylinePath = polylinePoints ? `M ${polylinePoints}` : '';

  const userPos = projectToPixel(userLocation.latitude, userLocation.longitude);
  const nearestShop = shops[0];
  const nearestPos = projectToPixel(nearestShop.latitude, nearestShop.longitude);

  return (
    <ScrollView style={webStyles.scrollContainer}>
      <View style={webStyles.mainContainer}>
        <Text style={webStyles.pageTitle}>🗺️ Nearby Shops Navigation</Text>
        
        <View style={webStyles.mapContainer}>
          <Text style={webStyles.mapSubtitle}>Tap the map or scroll to see details</Text>
          <svg width={mapWidth} height={mapHeight} style={webStyles.svg} viewBox={`0 0 ${mapWidth} ${mapHeight}`}>
            {/* Background with gradient */}
            <defs>
              <linearGradient id="mapGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#e8f4f8" />
                <stop offset="100%" stopColor="#d0e8f2" />
              </linearGradient>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e0e0e0" strokeWidth="0.5"/>
              </pattern>
            </defs>
            <rect width={mapWidth} height={mapHeight} fill="url(#mapGradient)" />
            <rect width={mapWidth} height={mapHeight} fill="url(#grid)" />

            {/* BLUE POLYLINE TO NEAREST SHOP */}
            {polylinePath && (
              <>
                <path d={polylinePath} stroke="#0066ff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                <path d={polylinePath} stroke="#00ccff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" strokeDasharray="5,5" />
              </>
            )}

            {/* SHOP MARKERS */}
            {shops.map((shop: any, idx: number) => {
              const { x, y } = projectToPixel(shop.latitude, shop.longitude);
              const isNearest = idx === 0;
              return (
                <g key={`shop-${idx}`}>
                  {/* Glow/Halo effect */}
                  <circle cx={x} cy={y} r={isNearest ? 22 : 16} fill={isNearest ? '#22c55e' : '#ef4444'} opacity="0.2" />
                  <circle cx={x} cy={y} r={isNearest ? 22 : 16} fill="none" stroke={isNearest ? '#22c55e' : '#ef4444'} strokeWidth="1.5" opacity="0.4" />
                  
                  {/* Main marker */}
                  <circle cx={x} cy={y} r={isNearest ? 14 : 11} fill={isNearest ? '#22c55e' : '#ef4444'} stroke="white" strokeWidth="2" />
                  
                  {/* Number/Icon inside */}
                  <text x={x} y={y} textAnchor="middle" dy="0.3em" fill="white" fontSize="14" fontWeight="bold">
                    {idx + 1}
                  </text>
                  
                  {/* Label below */}
                  <text x={x} y={y + 30} textAnchor="middle" fill={isNearest ? '#22c55e' : '#ef4444'} fontSize="11" fontWeight="500">
                    {isNearest ? 'Nearest' : `Shop ${idx + 1}`}
                  </text>
                </g>
              );
            })}

            {/* USER LOCATION MARKER */}
            <g>
              {/* Pulse animation effect (static) */}
              <circle cx={userPos.x} cy={userPos.y} r="16" fill="#3b82f6" opacity="0.15" />
              <circle cx={userPos.x} cy={userPos.y} r="12" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.3" />
              
              {/* Main marker */}
              <circle cx={userPos.x} cy={userPos.y} r="10" fill="#3b82f6" stroke="white" strokeWidth="2.5" />
              
              {/* Center dot */}
              <circle cx={userPos.x} cy={userPos.y} r="5" fill="white" />
              
              {/* Label */}
              <text x={userPos.x} y={userPos.y - 25} textAnchor="middle" fill="#3b82f6" fontSize="11" fontWeight="600">
                You
              </text>
            </g>

            {/* CONNECTION LINE FROM USER TO NEAREST SHOP */}
            <line x1={userPos.x} y1={userPos.y} x2={nearestPos.x} y2={nearestPos.y} stroke="#0066ff" strokeWidth="2" opacity="0.5" strokeDasharray="3,3" />
          </svg>
        </View>

        {/* INFO CARDS */}
        <View style={webStyles.cardsContainer}>
          <View style={webStyles.infoCard}>
            <Text style={webStyles.cardIcon}>📍</Text>
            <View style={webStyles.cardContent}>
              <Text style={webStyles.cardLabel}>Your Location</Text>
              <Text style={webStyles.cardValue}>{userLocation.latitude.toFixed(4)}°, {userLocation.longitude.toFixed(4)}°</Text>
            </View>
          </View>

          <View style={{...webStyles.infoCard, borderLeftColor: '#22c55e'}}>
            <Text style={webStyles.cardIcon}>🏪</Text>
            <View style={webStyles.cardContent}>
              <Text style={webStyles.cardLabel}>Nearest Shop</Text>
              <Text style={webStyles.cardValue}>{nearestShop.shop_name}</Text>
              <Text style={webStyles.distance}>{nearestShop.distanceKm?.toFixed(2)} km away • {nearestShop.estimatedDeliveryTime || 'N/A'}</Text>
            </View>
          </View>
        </View>

        {/* LEGEND */}
        <View style={webStyles.legendBox}>
          <Text style={webStyles.legendTitle}>🎯 Map Legend</Text>
          <View style={webStyles.legendGrid}>
            <View style={webStyles.legendItem}>
              <View style={{ ...webStyles.legendDot, backgroundColor: '#3b82f6' }} />
              <Text style={webStyles.legendLabel}>Your Location</Text>
            </View>
            <View style={webStyles.legendItem}>
              <View style={{ ...webStyles.legendDot, backgroundColor: '#22c55e' }} />
              <Text style={webStyles.legendLabel}>Nearest Shop (Green)</Text>
            </View>
            <View style={webStyles.legendItem}>
              <View style={{ ...webStyles.legendDot, backgroundColor: '#ef4444' }} />
              <Text style={webStyles.legendLabel}>Other Shops (Red)</Text>
            </View>
            <View style={webStyles.legendItem}>
              <View style={{ ...webStyles.legendDot, backgroundColor: '#0066ff', height: 2, width: 20 }} />
              <Text style={webStyles.legendLabel}>Route (Blue Line)</Text>
            </View>
          </View>
        </View>

        {/* ALL SHOPS LIST */}
        <View style={webStyles.shopsList}>
          <Text style={webStyles.shopsTitle}>🏪 All Nearby Shops ({shops.length})</Text>
          {shops.map((shop: any, idx: number) => (
            <View key={shop.id} style={webStyles.shopRow}>
              <View style={{...webStyles.shopNumber, backgroundColor: idx === 0 ? '#22c55e' : '#ef4444'}}>
                <Text style={webStyles.shopNumberText}>{idx + 1}</Text>
              </View>
              <View style={webStyles.shopInfo}>
                <Text style={webStyles.shopName}>{shop.shop_name}</Text>
                <Text style={webStyles.shopDesc}>{shop.distanceKm?.toFixed(2)} km away • {shop.estimatedDeliveryTime || 'N/A'}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const webStyles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
    backgroundColor: '#f0f9ff',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  mainContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 20,
    textAlign: 'center',
  },
  mapContainer: {
    marginBottom: 25,
  },
  mapSubtitle: {
    fontSize: 13,
    color: '#666',
    marginBottom: 10,
    textAlign: 'center',
  },
  svg: {
    display: 'block',
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#0066ff',
    backgroundColor: '#e8f4f8',
  },
  cardsContainer: {
    marginBottom: 20,
    gap: 12,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#3b82f6',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardIcon: {
    fontSize: 24,
  },
  cardContent: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 2,
  },
  distance: {
    fontSize: 12,
    color: '#22c55e',
    fontWeight: '500',
    marginTop: 3,
  },
  legendBox: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 12,
  },
  legendGrid: {
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 3,
  },
  legendLabel: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  shopsList: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  shopsTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 12,
  },
  shopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  shopNumber: {
    width: 32,
    height: 32,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shopNumberText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 13,
  },
  shopInfo: {
    flex: 1,
  },
  shopName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 2,
  },
  shopDesc: {
    fontSize: 11,
    color: '#666',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f4f9',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#444746',
  },
  errorText: {
    fontSize: 16,
    color: '#b3261e',
    textAlign: 'center',
    padding: 20,
  },
  calloutContainer: {
    padding: 5,
    minWidth: 100,
  },
  shopName: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 2,
  },
  distanceText: {
    fontSize: 12,
    color: '#444746',
  },
  overlay: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  overlayTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#1e293b',
    marginBottom: 4,
  },
  overlayText: {
    fontWeight: '500',
    fontSize: 14,
    color: '#64748b',
  },
});
