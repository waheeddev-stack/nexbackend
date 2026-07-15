import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  Platform,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useRoute, useNavigation } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');

export default function NavigationScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { shop } = route.params;

  // Let's set initial user location (starting point of navigation)
  // We offset it slightly from the shop to create a realistic route
  const startLat = shop.latitude - 0.015;
  const startLng = shop.longitude - 0.012;

  // Midpoints to form a realistic path (e.g. going north, turning onto 4th Avenue, then to the shop)
  const routeCoords = [
    { latitude: startLat, longitude: startLng },
    { latitude: startLat + 0.005, longitude: startLng + 0.002 }, // turn 1
    { latitude: startLat + 0.008, longitude: startLng + 0.007 }, // turn 2
    { latitude: startLat + 0.012, longitude: startLng + 0.010 }, // turn 3
    { latitude: shop.latitude, longitude: shop.longitude } // Destination
  ];

  const [currentStep, setCurrentStep] = useState(0);
  const [userCoords, setUserCoords] = useState(routeCoords[0]);
  const [minsRemaining, setMinsRemaining] = useState(7);
  const [distanceRemaining, setDistanceRemaining] = useState(shop.distance_km || 2.4);

  // Custom step instructions matching the flow
  const steps = [
    { instruction: 'In 500m, turn left', street: 'onto 4th Avenue', icon: '↰' },
    { instruction: 'In 300m, turn right', street: 'onto Main Street', icon: '↱' },
    { instruction: 'Continue straight', street: 'for 800m', icon: '↑' },
    { instruction: 'You are arriving', street: `at ${shop.shop_name}`, icon: '📍' }
  ];

  // Simulate progress along the route
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const nextStep = prev + 1;
        if (nextStep < routeCoords.length) {
          setUserCoords(routeCoords[nextStep]);
          setMinsRemaining((prevMins) => Math.max(1, prevMins - 2));
          setDistanceRemaining((prevDist) => Math.max(0.1, +(prevDist - 0.6).toFixed(1)));
          return nextStep;
        } else {
          clearInterval(interval);
          return prev;
        }
      });
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  const currentInstruction = steps[Math.min(currentStep, steps.length - 1)];

  return (
    <SafeAreaView style={styles.container}>
      {/* 1. TOP HEADER BAR */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>NexKirana</Text>
          <Text style={styles.headerSubtitle}>{shop.shop_name.toUpperCase()}</Text>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.headerTimer}>
            <Text style={styles.timerEmoji}>⏱️</Text>
            <Text style={styles.timerText}>{minsRemaining} mins</Text>
          </View>
          <TouchableOpacity style={styles.cartButton}>
            <Text style={styles.cartIcon}>🛒</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* MAP AND INTERACTIVE OVERLAYS */}
      <View style={styles.mapContainer}>
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: (startLat + shop.latitude) / 2,
            longitude: (startLng + shop.longitude) / 2,
            latitudeDelta: 0.025,
            longitudeDelta: 0.025
          }}
          showsUserLocation={false}
        >
          {/* Route Line */}
          <Polyline
            coordinates={routeCoords}
            strokeColor="#1d70e7"
            strokeWidth={6}
          />

          {/* User Marker ("You") */}
          <Marker coordinate={userCoords} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.userMarkerContainer}>
              <View style={styles.userMarkerOuterRing}>
                <View style={styles.userMarkerInnerCircle} />
              </View>
              <View style={styles.markerLabelContainer}>
                <Text style={styles.markerLabelText}>You</Text>
              </View>
            </View>
          </Marker>

          {/* Destination Marker ("NexKirana" / Shop) */}
          <Marker coordinate={{ latitude: shop.latitude, longitude: shop.longitude }}>
            <View style={styles.destMarkerContainer}>
              <View style={styles.destPinOuter}>
                <Text style={styles.destPinIcon}>🛒</Text>
              </View>
              <View style={[styles.markerLabelContainer, styles.destLabelBg]}>
                <Text style={styles.markerLabelText}>NexKirana</Text>
              </View>
            </View>
          </Marker>
        </MapView>

        {/* 2. FLOATING TURN-BY-TURN CARD */}
        <View style={styles.turnCard}>
          <View style={styles.turnIconContainer}>
            <Text style={styles.turnArrowSymbol}>{currentInstruction.icon}</Text>
          </View>
          <View style={styles.turnTextContainer}>
            <Text style={styles.turnMainText}>{currentInstruction.instruction}</Text>
            <Text style={styles.turnSubText}>{currentInstruction.street}</Text>
          </View>
        </View>
      </View>

      {/* 3. BOTTOM PANEL */}
      <View style={styles.bottomSheet}>
        {/* Drag handle decoration */}
        <View style={styles.dragHandle} />

        <View style={styles.statsContainer}>
          <View style={styles.timeMainContainer}>
            <Text style={styles.timeNumber}>{minsRemaining}</Text>
            <Text style={styles.timeLabel}> mins</Text>
          </View>

          <View style={styles.subStatsRow}>
            <View style={styles.subStatItem}>
              <Text style={styles.subStatIcon}>🕒</Text>
              <Text style={styles.subStatText}>10:45 AM</Text>
            </View>
            <View style={styles.subStatItem}>
              <Text style={styles.subStatIcon}>🛣️</Text>
              <Text style={styles.subStatText}>{distanceRemaining} km</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.exitButton}
          onPress={() => navigation.goBack()}
        >
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
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backButton: {
    padding: 8,
  },
  backIcon: {
    fontSize: 24,
    color: '#0f172a',
    fontWeight: 'bold',
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1d4ed8', // premium blue
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    letterSpacing: 0.5,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTimer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  timerEmoji: {
    fontSize: 18,
    marginRight: 4,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  cartButton: {
    padding: 8,
  },
  cartIcon: {
    fontSize: 20,
    color: '#334155',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  /* FLOATING CARD */
  turnCard: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: '#0a42aa', // deep navigation blue
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  turnIconContainer: {
    width: 46,
    height: 46,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  turnArrowSymbol: {
    fontSize: 26,
    color: '#0a42aa',
    fontWeight: 'bold',
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
    color: '#93c5fd',
    fontSize: 14,
    marginTop: 2,
  },
  /* CUSTOM MAP MARKERS */
  userMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userMarkerOuterRing: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(29, 112, 231, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userMarkerInnerCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1d70e7',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  markerLabelContainer: {
    backgroundColor: '#1d70e7',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  destLabelBg: {
    backgroundColor: '#1d70e7',
  },
  markerLabelText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  destMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  destPinOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1d70e7',
    borderWidth: 2,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  destPinIcon: {
    fontSize: 18,
  },
  /* BOTTOM SHEET */
  bottomSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#e2e8f0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
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
  subStatIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  subStatText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  exitButton: {
    backgroundColor: '#0a5cdb',
    borderRadius: 16,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0a5cdb',
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
