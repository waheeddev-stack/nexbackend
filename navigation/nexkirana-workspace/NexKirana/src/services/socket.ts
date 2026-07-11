import { io, Socket } from 'socket.io-client';
import { Platform } from 'react-native';

// Detect backend URL based on platform
const getSocketUrl = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000'; // Android emulator
  } else if (Platform.OS === 'ios') {
    return 'http://127.0.0.1:5000'; // iOS simulator
  } else {
    return 'http://127.0.0.1:5000'; // Web
  }
};

const SOCKET_URL = getSocketUrl();

class SocketService {
  public socket: Socket | null = null;

  connect() {
    if (!this.socket) {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      this.socket.on('connect', () => {
        console.log('✅ Connected to socket server');
      });

      this.socket.on('connect_error', (error) => {
        console.warn('❌ Socket connection error:', error);
      });

      this.socket.on('disconnect', () => {
        console.log('🔌 Disconnected from socket server');
      });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  trackOrder(orderId: string) {
    if (this.socket) {
      this.socket.emit('order:track', { orderId });
    }
  }

  onLocationUpdate(callback: (data: any) => void) {
    if (this.socket) {
      this.socket.on('shop:location:updated', callback);
    }
  }

  offLocationUpdate() {
    if (this.socket) {
      this.socket.off('shop:location:updated');
    }
  }
}

const socketService = new SocketService();
export default socketService;
