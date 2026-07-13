import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline, UrlTile, MAP_TYPES, Camera } from 'react-native-maps';
import io, { Socket } from 'socket.io-client';
import { Platform } from 'react-native';

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface RouteData {
  success: boolean;
  data: {
    order_id: string;
    shop_location: Coordinate;
    customer_location: Coordinate;
    polyline: Coordinate[];
    distance_km: number;
    eta_minutes: number;
    route_steps?: string[];
  };
  timestamp: string;
}

interface LiveLocationUpdate {
  order_id: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  timestamp: string;
}

// Get backend URL based on platform
const getBackendUrl = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000'; // Android emulator
  } else if (Platform.OS === 'ios') {
    return 'http://127.0.0.1:5000'; // iOS simulator
  } else {
    return 'http://127.0.0.1:5000'; // Web
  }
};

const BACKEND_URL = getBackendUrl();

export default function LiveNavigationScreen({ route }: any) {
  // orderId passed from your previous screen
  const { orderId } = route.params;

  const mapRef = useRef<MapView>(null);
  const socketRef = useRef<Socket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [customerLocation, setCustomerLocation] = useState<Coordinate | null>(null);
  const [driverLocation, setDriverLocation] = useState<Coordinate | null>(null);
  const [routePolyline, setRoutePolyline] = useState<Coordinate[]>([]);
  const [eta, setEta] = useState<string>('');
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [orderStatus, setOrderStatus] = useState<string>('tracking');

  useEffect(() => {
    // 1. Fetch the initial route and static coordinates from your Node.js backend
    fetchInitialRoute();

    // 2. Connect to your real-time Socket.io server
    connectSocket();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, [orderId]);

  const fetchInitialRoute = async () => {
    try {
      setLoading(true);
      setError(null);

      // Call the Node.js API to fetch route and initial positions
      const response = await fetch(
        `${BACKEND_URL}/api/navigation/order/${orderId}`
      );

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const result: RouteData = await response.json();

      if (result.success) {
        const { shop_location, customer_location, polyline, eta_minutes, distance_km } =
          result.data;

        setCustomerLocation(customer_location);
        setDriverLocation(shop_location);
        setRoutePolyline(polyline);
        setEta(`${eta_minutes} min`);
        setDistanceKm(distance_km);

        // Center map on customer location
        if (mapRef.current && customer_location) {
          mapRef.current.animateToRegion({
            latitude: customer_location.latitude,
            longitude: customer_location.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          });
        }
      } else {
        throw new Error('Failed to load route data');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load navigation data';
      console.error('❌ Error fetching route:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const connectSocket = () => {
    try {
      const socket = io(BACKEND_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('✅ Connected to socket server');
        // Subscribe to this order's live updates
        socket.emit('order:track', { orderId });
      });

      socket.on('connect_error', (error: any) => {
        console.warn('❌ Socket connection error:', error);
      });

      // Listen for live location updates from the shopkeeper/delivery partner
      socket.on('shop:location:updated', (data: LiveLocationUpdate) => {
        console.log('📍 Live location update:', data);

        const newCoord: Coordinate = {
          latitude: data.latitude,
          longitude: data.longitude,
        };

        setDriverLocation(newCoord);

        // Optional: Smoothly re-center the map as the driver moves
        // Comment this out if you want the user to be able to pan freely
        if (mapRef.current) {
          mapRef.current.animateCamera(
            {
              center: newCoord,
              pitch: 45,
              heading: data.heading || 0,
              altitude: 300,
            },
            { duration: 1000 }
          );
        }
      });

      // Listen for order status changes
      socket.on('order:status:updated', (data: any) => {
        console.log('📦 Order status update:', data);
        setOrderStatus(data.status);

        if (data.status === 'delivered') {
          setEta('Delivered');
        } else if (data.status === 'cancelled') {
          setError('Order was cancelled');
        }
      });

      socket.on('disconnect', () => {
        console.log('🔌 Disconnected from socket server');
      });
    } catch (err) {
      console.error('❌ Socket connection failed:', err);
    }
  };

  const handleRetry = () => {
    fetchInitialRoute();
    connectSocket();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Loading live map...</Text>
      </View>
    );
  }

  if (error || !customerLocation || !driverLocation) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || 'Failed to load map data'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Floating ETA Display Card */}
      <View style={styles.etaCard}>
        <Text style={styles.etaLabel}>ETA</Text>
        <Text style={styles.etaText}>{eta}</Text>
        <Text style={styles.distanceText}>{distanceKm.toFixed(2)} km</Text>
      </View>

      {/* Status Indicator */}
      <View style={styles.statusBadge}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: orderStatus === 'delivered' ? '#4CAF50' : '#FF9800' },
          ]}
        />
        <Text style={styles.statusText}>
          {orderStatus === 'delivered'
            ? 'Delivered'
            : orderStatus === 'on-the-way'
            ? 'On the way'
            : 'Tracking'}
        </Text>
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={MAP_TYPES.NONE} // Disables the default Google/Apple base map
        initialRegion={{
          latitude: customerLocation.latitude,
          longitude: customerLocation.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={false}
        zoomEnabled={true}
        scrollEnabled={true}
        pitchEnabled={true}
      >
        {/* ========== THIS IS THE MAGIC: Renders OpenStreetMap for free ========== */}
        <UrlTile
          urlTemplate="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
        />

        {/* Customer Destination Marker - RED PIN */}
        <Marker
          coordinate={customerLocation}
          title="Your Location"
          description="Delivery destination"
          pinColor="red"
        />

        {/* Live Moving Driver Marker - BLUE PIN */}
        {driverLocation && (
          <Marker
            coordinate={driverLocation}
            title="Delivery Partner"
            description="Currently moving"
            pinColor="blue"
            // You can replace pinColor with a custom bike/scooter image:
            // image={require('../../assets/bike.png')}
          />
        )}

        {/* The Route Path - Blue Polyline */}
        {routePolyline.length > 0 && (
          <Polyline
            coordinates={routePolyline}
            strokeColor="#4285F4"
            strokeWidth={5}
            lineDashPattern={[0]}
            geodesic={true}
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#333',
  },
  errorText: {
    fontSize: 16,
    color: '#d32f2f',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  etaCard: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 30,
    zIndex: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  etaLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500',
    textAlign: 'center',
  },
  etaText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
  },
  distanceText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
  },
  statusBadge: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    backgroundColor: 'white',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    zIndex: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
});
