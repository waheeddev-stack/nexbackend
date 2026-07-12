import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, SafeAreaView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import NearbyShopsMap from '../components/NearbyShopsMap';

const StoreCard = ({ icon, iconColor, iconBg, name, category, rating, distance, status, statusColor, statusBg, onPress }: any) => (
  <TouchableOpacity style={styles.storeCard} onPress={onPress}>
    <View style={[styles.storeIconContainer, { backgroundColor: iconBg }]}>
      <Ionicons name={icon} size={24} color={iconColor} />
    </View>
    <View style={styles.storeInfo}>
      <Text style={styles.storeName}>{name}</Text>
      <Text style={styles.storeCategory}>{category}</Text>
      <View style={styles.storeMeta}>
        <Ionicons name="star" size={12} color="#f59e0b" />
        <Text style={styles.storeRating}> {rating}</Text>
        <Text style={styles.storeDistance}> • <Ionicons name="location-outline" size={12} /> {distance}</Text>
      </View>
    </View>
    <View style={[styles.statusBadge, { backgroundColor: statusBg, borderColor: statusColor }]}>
      <Text style={[styles.statusText, { color: statusColor }]}>{status}</Text>
    </View>
  </TouchableOpacity>
);

const MapScreen = () => {
  const navigation = useNavigation<any>();
  const [shops, setShops] = useState<any[]>([]);

  const getShopStyling = (index: number) => {
    const styles = [
      { icon: "storefront-outline", iconColor: "#4f46e5", iconBg: "#e0e7ff", category: "Groceries • Fresh Produce", rating: "4.8 (1.2k)", status: "OPEN", statusColor: "#16a34a", statusBg: "#f0fdf4" },
      { icon: "bag-handle-outline", iconColor: "#d97706", iconBg: "#fef3c7", category: "Daily Needs • Dairy", rating: "4.5 (850)", status: "OPEN", statusColor: "#16a34a", statusBg: "#f0fdf4" },
      { icon: "leaf-outline", iconColor: "#dc2626", iconBg: "#fee2e2", category: "Organic • Imported Goods", rating: "4.9 (2k+)", status: "CLOSED", statusColor: "#dc2626", statusBg: "#fef2f2" },
    ];
    return styles[index % styles.length];
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity>
            <Ionicons name="menu-outline" size={28} color="#0f172a" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Find a Store</Text>
          <View style={styles.headerRight}>
            <View style={styles.timeBadge}>
              <Ionicons name="time-outline" size={14} color="#b45309" />
              <Text style={styles.timeText}>7 mins</Text>
            </View>
            <TouchableOpacity>
              <Ionicons name="cart-outline" size={26} color="#0f172a" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={20} color="#94a3b8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for stores, milk, bread..."
              placeholderTextColor="#94a3b8"
            />
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="mic-outline" size={20} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="scan-outline" size={20} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Map Area */}
        <View style={styles.mapArea}>
          <NearbyShopsMap onShopsLoaded={setShops} />
        </View>

        {/* Bottom Sheet */}
        <View style={styles.bottomSheet}>
          <View style={styles.dragHandle} />
          
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Stores near you</Text>
            <TouchableOpacity style={styles.filterBtn}>
              <Text style={styles.filterText}>Filter</Text>
              <Ionicons name="options-outline" size={16} color="#3b82f6" style={{marginLeft: 4}} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.storeList} showsVerticalScrollIndicator={false}>
            {shops.length === 0 ? (
              <Text style={{ textAlign: 'center', marginTop: 20, color: '#64748b' }}>Finding nearby stores...</Text>
            ) : (
              shops.map((shop, index) => {
                const style = getShopStyling(index);
                return (
                  <StoreCard 
                    key={shop.id || index}
                    icon={style.icon}
                    iconColor={style.iconColor}
                    iconBg={style.iconBg}
                    name={shop.shop_name}
                    category={shop.address || style.category}
                    rating={style.rating}
                    distance={`${shop.distance_km ? shop.distance_km.toFixed(1) : (shop.distanceKm ? shop.distanceKm.toFixed(1) : '0')} km`}
                    status={style.status}
                    statusColor={style.statusColor}
                    statusBg={style.statusBg}
                    onPress={() => navigation.navigate('Navigation', { shop })}
                  />
                );
              })
            )}
            {/* Add some padding at bottom for safe area */}
            <View style={{height: 20}} />
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 10 : 0,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginLeft: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 12,
  },
  timeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#b45309',
    marginLeft: 4,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: '#334155',
  },
  iconBtn: {
    padding: 4,
    marginLeft: 4,
  },
  mapArea: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    position: 'relative',
    // Push it behind the rounded top of bottom sheet slightly
    marginBottom: -20,
  },
  bottomSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
    height: '55%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#cbd5e1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3b82f6',
  },
  storeList: {
    flex: 1,
  },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  storeIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  storeInfo: {
    flex: 1,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  storeCategory: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 6,
  },
  storeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  storeRating: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  storeDistance: {
    fontSize: 12,
    color: '#64748b',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default MapScreen;
