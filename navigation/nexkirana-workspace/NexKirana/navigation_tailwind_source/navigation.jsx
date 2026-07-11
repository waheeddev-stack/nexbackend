import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, SafeAreaView, Dimensions, Platform } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function NavigationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Retrieve shop details from params or default to Poojia Super Market mockup defaults
  const shopName = params.shop_name || params.shopName || "Pooja Super Market";
  const address = params.address || "4th Avenue, Near Main Road";
  const latitude = params.latitude ? parseFloat(params.latitude) : 28.6139;
  const longitude = params.longitude ? parseFloat(params.longitude) : 77.209;
  const distanceKm = params.distance_km ? parseFloat(params.distance_km) : 2.4;

  // Let's set initial user location slightly offset from the destination shop
  const startLat = latitude - 0.012;
  const startLng = longitude - 0.010;

  // Path coordinates simulation
  const routeCoords = [
    { latitude: startLat, longitude: startLng },
    { latitude: startLat + 0.004, longitude: startLng + 0.003 },
    { latitude: startLat + 0.008, longitude: startLng + 0.006 },
    { latitude: startLat + 0.010, longitude: startLng + 0.008 },
    { latitude: latitude, longitude: longitude }
  ];

  const [currentStep, setCurrentStep] = useState(0);
  const [userCoords, setUserCoords] = useState(routeCoords[0]);
  const [minsRemaining, setMinsRemaining] = useState(7);
  const [distanceRemaining, setDistanceRemaining] = useState(distanceKm);

  // Turn-by-turn guidance steps
  const steps = [
    { instruction: "In 500m, turn left", street: "onto 4th Avenue", iconName: "arrow-undo" },
    { instruction: "In 300m, turn right", street: "onto Main Street", iconName: "arrow-redo" },
    { instruction: "Continue straight", street: "for 800m", iconName: "arrow-up" },
    { instruction: "You are arriving", street: `at ${shopName}`, iconName: "pin" }
  ];

  // Simulating the user moving along the route coordinates
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
    <SafeAreaView className="flex-1 bg-slate-50">
      {/* 1. TOP HEADER BAR */}
      <View className="h-16 flex-row items-center justify-between px-4 bg-slate-50 border-b border-slate-200">
        <TouchableOpacity className="p-2" onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#0f172a" />
        </TouchableOpacity>

        <View className="flex-1 ml-3">
          <Text className="text-lg font-bold text-blue-700">NexKirana</Text>
          <Text className="text-[10px] font-semibold text-slate-500 tracking-wider uppercase">
            {shopName}
          </Text>
        </View>

        <View className="flex-row items-center">
          <View className="flex-row items-center mr-4 bg-orange-50 px-2.5 py-1 rounded-full border border-orange-100">
            <Ionicons name="time-outline" size={16} color="#f97316" className="mr-1" />
            <Text className="text-sm font-semibold text-orange-600 ml-1">
              {minsRemaining} mins
            </Text>
          </View>
          <TouchableOpacity className="p-2 bg-slate-100 rounded-full">
            <Ionicons name="cart-outline" size={20} color="#334155" />
          </TouchableOpacity>
        </View>
      </View>

      {/* MAP AND FLOATING CARD */}
      <View className="flex-1 relative">
        <MapView
          className="absolute inset-0"
          initialRegion={{
            latitude: (startLat + latitude) / 2,
            longitude: (startLng + longitude) / 2,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02
          }}
          showsUserLocation={false}
        >
          {/* Route line */}
          <Polyline
            coordinates={routeCoords}
            strokeColor="#1d70e7"
            strokeWidth={6}
          />

          {/* User Marker ("You") */}
          <Marker coordinate={userCoords} anchor={{ x: 0.5, y: 0.5 }}>
            <View className="items-center justify-center">
              <View className="w-7 h-7 rounded-full bg-blue-500/25 items-center justify-center">
                <View className="w-3.5 h-3.5 rounded-full bg-blue-600 border-2 border-white" />
              </View>
              <View className="bg-blue-600 px-2 py-0.5 rounded-md mt-1 shadow-sm">
                <Text className="text-white text-[9px] font-bold">You</Text>
              </View>
            </View>
          </Marker>

          {/* Shop Marker ("NexKirana") */}
          <Marker coordinate={{ latitude, longitude }}>
            <View className="items-center justify-center">
              <View className="w-9 h-9 rounded-full bg-blue-600 border-2 border-white items-center justify-center shadow-md">
                <Ionicons name="cart" size={18} color="white" />
              </View>
              <View className="bg-blue-600 px-2 py-0.5 rounded-md mt-1 shadow-sm">
                <Text className="text-white text-[9px] font-bold">NexKirana</Text>
              </View>
            </View>
          </Marker>
        </MapView>

        {/* 2. FLOATING NAVIGATION CARD */}
        <View className="absolute top-4 left-4 right-4 bg-[#0a42aa] rounded-2xl p-4 flex-row items-center shadow-lg">
          <View className="w-12 h-12 bg-white rounded-xl justify-center items-center">
            <Ionicons name={currentInstruction.iconName} size={26} color="#0a42aa" />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-white text-lg font-bold">
              {currentInstruction.instruction}
            </Text>
            <Text className="text-blue-200 text-sm mt-0.5">
              {currentInstruction.street}
            </Text>
          </View>
        </View>
      </View>

      {/* 3. BOTTOM PANEL */}
      <View className="bg-white rounded-t-[30px] px-6 pt-3 pb-6 shadow-2xl border-t border-slate-100">
        {/* Top drag handle decoration */}
        <View className="w-10 h-1 bg-slate-200 rounded-full align-middle self-center mb-4" />

        <View className="flex-row items-center justify-between mb-5">
          <View className="flex-row items-baseline">
            <Text className="text-3xl font-extrabold text-slate-900">{minsRemaining}</Text>
            <Text className="text-base text-slate-900 font-semibold ml-1"> mins</Text>
          </View>

          <View className="flex-row items-center">
            <View className="flex-row items-center ml-4">
              <Ionicons name="time-outline" size={16} color="#64748b" className="mr-1" />
              <Text className="text-sm font-semibold text-slate-600 ml-1">10:45 AM</Text>
            </View>
            <View className="flex-row items-center ml-4">
              <Ionicons name="navigate-outline" size={16} color="#64748b" className="mr-1" />
              <Text className="text-sm font-semibold text-slate-600 ml-1">{distanceRemaining} km</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          className="bg-blue-600 rounded-2xl h-14 justify-center items-center shadow-md shadow-blue-500/20"
          onPress={() => router.back()}
        >
          <Text className="text-white text-base font-bold">Exit Navigation</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
