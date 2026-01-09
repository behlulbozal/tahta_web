/**
 * WebRTC client for phone side
 * Creates offer and sends media to Tahta
 */

const CHUNK_SIZE = 64 * 1024; // 64KB chunks

// Detect iOS Safari
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
const isIOSSafari = isIOS && isSafari;

function log(msg, data = null) {
    const timestamp = new Date().toISOString().substr(11, 12);
    if (data) {
        console.log(`[${timestamp}] ${msg}`, data);
    } else {
        console.log(`[${timestamp}] ${msg}`);
    }
}

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
        this.onFileReceived = null;  // Called when file is received from Tahta

        // State
        this.isConnected = false;
        this.connectionTimeout = null;

        // File receiving state
        this.pendingFile = null;

        log(`Platform: iOS=${isIOS}, Safari=${isSafari}, iOS Safari=${isIOSSafari}`);
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
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' }
                ],
                // iOS Safari sometimes needs this
                iceCandidatePoolSize: 10
            };

            // Create peer connection
            this.pc = new RTCPeerConnection(config);
            log('RTCPeerConnection created');

            // Create data channel for sending media
            this.dataChannel = this.pc.createDataChannel('media', {
                ordered: true
            });
            log('DataChannel created');

            // Data channel events
            this.dataChannel.onopen = () => {
                log('DataChannel OPEN');
                this.clearConnectionTimeout();
                this.isConnected = true;
                if (this.onConnected) this.onConnected();
            };

            this.dataChannel.onclose = () => {
                log('DataChannel CLOSED');
                this.isConnected = false;
                if (this.onDisconnected) this.onDisconnected();
            };

            this.dataChannel.onerror = (error) => {
                log('DataChannel ERROR', error);
                if (this.onError) this.onError(error);
            };

            // Handle incoming messages (for receiving files from Tahta)
            this.dataChannel.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            // ICE candidate handling
            this.pc.onicecandidate = (event) => {
                if (event.candidate) {
                    log('Local ICE candidate', event.candidate.candidate.substr(0, 50) + '...');
                    this.signaling.addIceCandidate({
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex
                    });
                } else {
                    log('ICE gathering complete (null candidate)');
                }
            };

            // ICE gathering state change
            this.pc.onicegatheringstatechange = () => {
                log('ICE gathering state:', this.pc.iceGatheringState);
            };

            // Connection state change
            this.pc.onconnectionstatechange = () => {
                log('Connection state:', this.pc.connectionState);

                if (this.pc.connectionState === 'connected') {
                    this.clearConnectionTimeout();
                    this.signaling.updateStatus('connected');
                } else if (this.pc.connectionState === 'failed') {
                    log('CONNECTION FAILED - this is the issue on iOS Safari');
                    this.clearConnectionTimeout();
                    this.isConnected = false;
                    if (this.onError) this.onError(new Error('Connection failed'));
                } else if (this.pc.connectionState === 'disconnected' ||
                           this.pc.connectionState === 'closed') {
                    this.isConnected = false;
                    if (this.onDisconnected) this.onDisconnected();
                }
            };

            // ICE connection state change
            this.pc.oniceconnectionstatechange = () => {
                log('ICE connection state:', this.pc.iceConnectionState);

                // On iOS Safari, sometimes only ICE connection state changes, not connection state
                if (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed') {
                    log('ICE connected/completed');
                } else if (this.pc.iceConnectionState === 'failed') {
                    log('ICE CONNECTION FAILED');
                    if (isIOSSafari) {
                        alert('ICE connection failed. This may be a network issue on iOS Safari.');
                    }
                } else if (this.pc.iceConnectionState === 'disconnected') {
                    log('ICE disconnected');
                }
            };

            // Signaling state change
            this.pc.onsignalingstatechange = () => {
                log('Signaling state:', this.pc.signalingState);
            };

            // Listen for answer from Tahta
            this.signaling.onAnswer(async (answer) => {
                log('Received answer from Tahta');
                log('Answer SDP type:', answer.type);
                log('Answer SDP length:', answer.sdp?.length);

                try {
                    const desc = new RTCSessionDescription(answer);
                    log('RTCSessionDescription created');

                    await this.pc.setRemoteDescription(desc);
                    log('Remote description SET successfully');
                    log('Signaling state after answer:', this.pc.signalingState);
                    log('ICE connection state after answer:', this.pc.iceConnectionState);
                    log('Connection state after answer:', this.pc.connectionState);
                } catch (err) {
                    log('ERROR setting remote description:', err.message);
                    alert('SDP Error: ' + err.message);
                    if (this.onError) this.onError(err);
                }
            });

            // Listen for ICE candidates from Tahta
            this.signaling.onRemoteIceCandidate(async (candidate) => {
                log('Received remote ICE candidate');
                if (candidate && candidate.candidate) {
                    try {
                        const iceCandidate = new RTCIceCandidate(candidate);
                        await this.pc.addIceCandidate(iceCandidate);
                        log('Remote ICE candidate ADDED');
                    } catch (err) {
                        log('ERROR adding remote ICE candidate:', err.message);
                    }
                }
            });

            // Create and send offer
            log('Creating offer...');
            const offer = await this.pc.createOffer();
            log('Offer created, setting local description...');
            await this.pc.setLocalDescription(offer);
            log('Local description set');

            await this.signaling.setOffer({
                type: offer.type,
                sdp: offer.sdp
            });
            log('Offer sent to Firebase');

            // Set connection timeout (30 seconds)
            this.connectionTimeout = setTimeout(() => {
                if (!this.isConnected) {
                    log('CONNECTION TIMEOUT after 30 seconds');
                    log('Final states - ICE:', this.pc?.iceConnectionState, 'Connection:', this.pc?.connectionState);
                    if (isIOSSafari) {
                        alert('Connection timeout. States: ICE=' + this.pc?.iceConnectionState + ', Conn=' + this.pc?.connectionState);
                    }
                }
            }, 30000);

        } catch (error) {
            log('WebRTC connect ERROR', error);
            if (this.onError) this.onError(error);
            throw error;
        }
    }

    /**
     * Clear connection timeout
     */
    clearConnectionTimeout() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
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
     * Handle incoming message from Tahta
     */
    handleMessage(data) {
        try {
            if (typeof data === 'string') {
                const msg = JSON.parse(data);

                if (msg.header) {
                    // Start receiving file
                    log('Receiving file:', msg.header.filename);
                    this.pendingFile = {
                        type: msg.header.type,
                        filename: msg.header.filename,
                        totalSize: msg.header.totalSize,
                        totalChunks: msg.header.totalChunks,
                        chunks: [],
                        receivedSize: 0
                    };
                } else if (msg.complete && this.pendingFile) {
                    // File transfer complete
                    this.finalizeFile();
                }
            } else if (data instanceof ArrayBuffer || data instanceof Blob) {
                // Binary chunk
                if (this.pendingFile) {
                    if (data instanceof Blob) {
                        data.arrayBuffer().then(ab => {
                            this.pendingFile.chunks.push(ab);
                            this.pendingFile.receivedSize += ab.byteLength;
                            if (this.onProgress) {
                                this.onProgress(this.pendingFile.receivedSize / this.pendingFile.totalSize);
                            }
                        });
                    } else {
                        this.pendingFile.chunks.push(data);
                        this.pendingFile.receivedSize += data.byteLength;
                        if (this.onProgress) {
                            this.onProgress(this.pendingFile.receivedSize / this.pendingFile.totalSize);
                        }
                    }
                }
            }
        } catch (e) {
            log('Error handling message:', e);
        }
    }

    /**
     * Finalize received file
     */
    finalizeFile() {
        if (!this.pendingFile) return;

        const { type, filename, chunks } = this.pendingFile;
        log(`File received: ${filename}, ${chunks.length} chunks`);

        // Combine chunks
        const blob = new Blob(chunks, { type: type === 'pdf' ? 'application/pdf' : 'application/octet-stream' });

        // Trigger download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        log('File downloaded:', filename);

        if (this.onFileReceived) {
            this.onFileReceived(type, filename, blob);
        }

        this.pendingFile = null;
    }

    /**
     * Request PDF from Tahta
     */
    requestPdf() {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            throw new Error('DataChannel not open');
        }

        log('Requesting PDF from Tahta...');
        this.dataChannel.send(JSON.stringify({ type: 'pdf_request' }));
    }

    /**
     * Disconnect from Tahta
     */
    disconnect() {
        log('Disconnecting...');
        this.clearConnectionTimeout();

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
        log('Disconnected');
    }
}
