import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline, UrlTile, MAP_TYPES, Camera } from 'react-native-maps';
import io from 'socket.io-client';
import { Platform } from 'react-native';

const getBackendUrl = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000';
  } else if (Platform.OS === 'ios') {
    return 'http://127.0.0.1:5000';
  } else {
    return 'http://127.0.0.1:5000';
  }
};

const BACKEND_URL = getBackendUrl();

export default function LiveNavigationScreen({ route }) {
  const { orderId } = route.params;

  const mapRef = useRef(null);
  const socketRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [customerLocation, setCustomerLocation] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [routePolyline, setRoutePolyline] = useState([]);
  const [eta, setEta] = useState('');
  const [distanceKm, setDistanceKm] = useState(0);
  const [orderStatus, setOrderStatus] = useState('tracking');

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

export default function LiveNavigationScreen({ route }) {
  // orderId passed from your previous screen
  const { orderId } = route.params;

  const mapRef = useRef(null);
  const socketRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [customerLocation, setCustomerLocation] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [routePolyline, setRoutePolyline] = useState([]);
  const [eta, setEta] = useState('');
  const [distanceKm, setDistanceKm] = useState(0);
  const [orderStatus, setOrderStatus] = useState('tracking');

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

  if (loading || error || !customerLocation || !driverLocation) {
    return null;
  }

  return (
    <View style={styles.container}>
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
});
