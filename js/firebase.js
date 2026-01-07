/**
 * Firebase Realtime Database signaling for WebRTC
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import {
    getDatabase,
    ref,
    set,
    push,
    onValue,
    remove,
    off
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';

// Firebase configuration
const firebaseConfig = {
    databaseURL: "https://tahta-connect-default-rtdb.firebaseio.com"
};

// Initialize Firebase
let app = null;
let database = null;

try {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    console.log('Firebase initialized');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

/**
 * Firebase signaling client for phone side
 */
export class FirebaseSignaling {
    constructor(roomId) {
        this.roomId = roomId;
        this.roomRef = ref(database, `rooms/${roomId}`);
        this.listeners = [];
    }

    /**
     * Set SDP offer from phone
     */
    async setOffer(sdp) {
        try {
            await set(ref(database, `rooms/${this.roomId}/phone/sdp`), sdp);
            return true;
        } catch (error) {
            console.error('Set offer error:', error);
            return false;
        }
    }

    /**
     * Add ICE candidate from phone
     */
    async addIceCandidate(candidate) {
        try {
            await push(ref(database, `rooms/${this.roomId}/phone/ice_candidates`), candidate);
            return true;
        } catch (error) {
            console.error('Add ICE candidate error:', error);
            return false;
        }
    }

    /**
     * Listen for SDP answer from Tahta
     */
    onAnswer(callback) {
        const answerRef = ref(database, `rooms/${this.roomId}/tahta/sdp`);

        const unsubscribe = onValue(answerRef, (snapshot) => {
            const data = snapshot.val();
            if (data && data.sdp) {
                callback(data);
            }
        });

        this.listeners.push({ ref: answerRef, unsubscribe });
    }

    /**
     * Listen for ICE candidates from Tahta
     */
    onRemoteIceCandidate(callback) {
        const candidatesRef = ref(database, `rooms/${this.roomId}/tahta/ice_candidates`);
        const processedKeys = new Set();

        const unsubscribe = onValue(candidatesRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                Object.entries(data).forEach(([key, candidate]) => {
                    if (!processedKeys.has(key)) {
                        processedKeys.add(key);
                        callback(candidate);
                    }
                });
            }
        });

        this.listeners.push({ ref: candidatesRef, unsubscribe });
    }

    /**
     * Listen for room status changes
     */
    onStatusChange(callback) {
        const statusRef = ref(database, `rooms/${this.roomId}/status`);

        const unsubscribe = onValue(statusRef, (snapshot) => {
            const status = snapshot.val();
            if (status) {
                callback(status);
            }
        });

        this.listeners.push({ ref: statusRef, unsubscribe });
    }

    /**
     * Check if room exists
     */
    async checkRoom() {
        return new Promise((resolve) => {
            const roomRef = ref(database, `rooms/${this.roomId}`);

            onValue(roomRef, (snapshot) => {
                resolve(snapshot.exists());
            }, { onlyOnce: true });
        });
    }

    /**
     * Update room status
     */
    async updateStatus(status) {
        try {
            await set(ref(database, `rooms/${this.roomId}/status`), status);
            return true;
        } catch (error) {
            console.error('Update status error:', error);
            return false;
        }
    }

    /**
     * Cleanup: remove listeners and phone data
     */
    cleanup() {
        // Remove all listeners
        this.listeners.forEach(({ ref: listenerRef, unsubscribe }) => {
            off(listenerRef);
        });
        this.listeners = [];

        // Remove phone data from room
        try {
            remove(ref(database, `rooms/${this.roomId}/phone`));
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }
}

// Export for use in other modules
export { database };
