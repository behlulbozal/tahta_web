/**
 * WebRTC client for phone side
 * Creates offer and sends media to Tahta
 */

const CHUNK_SIZE = 64 * 1024; // 64KB chunks

/**
 * WebRTC client class
 */
export class WebRTCClient {
    constructor(signaling) {
        this.signaling = signaling;
        this.pc = null;
        this.dataChannel = null;

        // Callbacks
        this.onConnected = null;
        this.onDisconnected = null;
        this.onProgress = null;
        this.onError = null;

        // State
        this.isConnected = false;
    }

    /**
     * Connect to Tahta via WebRTC
     */
    async connect() {
        try {
            // ICE servers configuration
            const config = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            };

            // Create peer connection
            this.pc = new RTCPeerConnection(config);

            // Create data channel for sending media
            this.dataChannel = this.pc.createDataChannel('media', {
                ordered: true
            });

            // Data channel events
            this.dataChannel.onopen = () => {
                console.log('DataChannel open');
                this.isConnected = true;
                if (this.onConnected) this.onConnected();
            };

            this.dataChannel.onclose = () => {
                console.log('DataChannel closed');
                this.isConnected = false;
                if (this.onDisconnected) this.onDisconnected();
            };

            this.dataChannel.onerror = (error) => {
                console.error('DataChannel error:', error);
                if (this.onError) this.onError(error);
            };

            // ICE candidate handling
            this.pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.signaling.addIceCandidate({
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex
                    });
                }
            };

            // Connection state change
            this.pc.onconnectionstatechange = () => {
                console.log('Connection state:', this.pc.connectionState);

                if (this.pc.connectionState === 'connected') {
                    this.signaling.updateStatus('connected');
                } else if (this.pc.connectionState === 'failed' ||
                           this.pc.connectionState === 'disconnected' ||
                           this.pc.connectionState === 'closed') {
                    this.isConnected = false;
                    if (this.onDisconnected) this.onDisconnected();
                }
            };

            // ICE connection state change
            this.pc.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', this.pc.iceConnectionState);
            };

            // Listen for answer from Tahta
            this.signaling.onAnswer((answer) => {
                console.log('Received answer from Tahta');
                this.pc.setRemoteDescription(new RTCSessionDescription(answer));
            });

            // Listen for ICE candidates from Tahta
            this.signaling.onRemoteIceCandidate((candidate) => {
                console.log('Received ICE candidate from Tahta');
                if (candidate && candidate.candidate) {
                    this.pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
            });

            // Create and send offer
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            await this.signaling.setOffer({
                type: offer.type,
                sdp: offer.sdp
            });

            console.log('Offer sent to Tahta');

        } catch (error) {
            console.error('WebRTC connect error:', error);
            if (this.onError) this.onError(error);
            throw error;
        }
    }

    /**
     * Send file to Tahta
     * @param {string} type - 'image' or 'audio'
     * @param {string} filename - Original filename
     * @param {ArrayBuffer} data - File data
     */
    async sendFile(type, filename, data) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            throw new Error('DataChannel not open');
        }

        const totalSize = data.byteLength;
        const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

        console.log(`Sending ${type}: ${filename} (${totalSize} bytes, ${totalChunks} chunks)`);

        // Send header
        const header = {
            header: {
                type: type,
                filename: filename,
                totalSize: totalSize,
                totalChunks: totalChunks
            }
        };
        this.dataChannel.send(JSON.stringify(header));

        // Send chunks
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, totalSize);
            const chunk = data.slice(start, end);

            // Wait for buffer to drain if needed
            while (this.dataChannel.bufferedAmount > CHUNK_SIZE * 4) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            this.dataChannel.send(chunk);

            // Report progress
            const progress = (i + 1) / totalChunks;
            if (this.onProgress) {
                this.onProgress(progress);
            }
        }

        // Send completion message
        this.dataChannel.send(JSON.stringify({ complete: true }));

        console.log('File sent successfully');
    }

    /**
     * Send image to Tahta
     * @param {Blob} blob - Image blob
     * @param {string} filename - Filename (optional)
     */
    async sendImage(blob, filename = 'photo.jpg') {
        const arrayBuffer = await blob.arrayBuffer();
        await this.sendFile('image', filename, arrayBuffer);
    }

    /**
     * Send audio to Tahta
     * @param {Blob} blob - Audio blob
     * @param {string} filename - Filename (optional)
     */
    async sendAudio(blob, filename = 'recording.webm') {
        const arrayBuffer = await blob.arrayBuffer();
        await this.sendFile('audio', filename, arrayBuffer);
    }

    /**
     * Disconnect from Tahta
     */
    disconnect() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }

        this.isConnected = false;
        this.signaling.cleanup();
    }
}
