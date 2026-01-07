/**
 * Tahta Connect - Main UI Logic
 * Handles camera, gallery, audio recording, and sending to Tahta
 */

import { FirebaseSignaling } from './firebase.js';
import { WebRTCClient } from './webrtc.js';

// State
let signaling = null;
let rtc = null;
let videoStream = null;
let mediaRecorder = null;
let audioChunks = [];
let audioTimer = null;
let audioSeconds = 0;
let currentFacingMode = 'environment'; // Back camera by default
let capturedPhotoBlob = null;

// DOM elements (cached after load)
let elements = {};

/**
 * Initialize on page load
 */
$(document).ready(function() {
    // Cache DOM elements
    elements = {
        statusBar: $('#status-bar'),
        statusDot: $('#status-dot'),
        statusText: $('#status-text'),
        errorMessage: $('#error-message'),
        errorText: $('#error-text'),
        actions: $('#actions'),
        cameraView: $('#camera-view'),
        cameraPreview: $('#camera-preview'),
        photoPreviewView: $('#photo-preview-view'),
        photoPreview: $('#photo-preview'),
        audioView: $('#audio-view'),
        audioTimer: $('#audio-timer'),
        waveformBars: $('#waveform-bars'),
        progress: $('#progress'),
        progressBar: $('#progress-bar'),
        progressText: $('#progress-text'),
        fileInput: $('#file-input')
    };

    // Get room ID from URL
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');

    if (!roomId) {
        showError('Gecersiz baglanti linki. QR kodu tekrar okutun.');
        return;
    }

    // Initialize connection
    initConnection(roomId);

    // Button event handlers
    $('#btn-camera').click(openCamera);
    $('#btn-gallery').click(() => elements.fileInput.click());
    $('#btn-audio').click(startAudioRecording);
    $('#btn-capture').click(capturePhoto);
    $('#btn-cancel-camera').click(closeCamera);
    $('#btn-switch-camera').click(switchCamera);
    $('#btn-send-photo').click(sendCapturedPhoto);
    $('#btn-retake-photo').click(retakePhoto);
    $('#btn-stop-audio').click(stopAudioRecording);
    $('#btn-cancel-audio').click(cancelAudioRecording);
    elements.fileInput.change(handleFileSelect);
});

/**
 * Initialize WebRTC connection
 */
async function initConnection(roomId) {
    try {
        updateStatus('connecting', 'Baglaniyor...');

        // Initialize Firebase signaling
        signaling = new FirebaseSignaling(roomId);

        // Check if room exists
        const roomExists = await signaling.checkRoom();
        if (!roomExists) {
            showError('Tahta baglantisi bulunamadi. QR kodu tekrar okutun.');
            return;
        }

        // Initialize WebRTC
        rtc = new WebRTCClient(signaling);

        rtc.onConnected = () => {
            updateStatus('connected', 'Baglandi');
            elements.actions.removeClass('hidden');
            elements.errorMessage.addClass('hidden');
        };

        rtc.onDisconnected = () => {
            updateStatus('disconnected', 'Baglanti kesildi');
            elements.actions.addClass('hidden');
        };

        rtc.onProgress = (progress) => {
            elements.progressBar.css('width', (progress * 100) + '%');
        };

        rtc.onError = (error) => {
            console.error('WebRTC error:', error);
            showError('Baglanti hatasi olustu.');
        };

        // Connect
        await rtc.connect();

    } catch (error) {
        console.error('Connection error:', error);
        showError('Baglanti kurulamadi. Sayfayi yenileyin.');
    }
}

/**
 * Update status indicator
 */
function updateStatus(status, text) {
    elements.statusText.text(text);

    // Remove all status classes
    elements.statusBar.removeClass('status-connecting status-connected status-disconnected status-error');

    // Add current status class
    elements.statusBar.addClass('status-' + status);

    // Update dot color
    elements.statusDot.removeClass('bg-yellow-500 bg-green-500 bg-red-500 animate-pulse');

    switch (status) {
        case 'connecting':
            elements.statusDot.addClass('bg-yellow-500 animate-pulse');
            break;
        case 'connected':
            elements.statusDot.addClass('bg-green-500');
            break;
        case 'disconnected':
        case 'error':
            elements.statusDot.addClass('bg-red-500');
            break;
    }
}

/**
 * Show error message
 */
function showError(message) {
    elements.errorText.text(message);
    elements.errorMessage.removeClass('hidden');
    updateStatus('error', 'Hata');
}

// ==================== Camera Functions ====================

/**
 * Open camera
 */
async function openCamera() {
    try {
        const constraints = {
            video: {
                facingMode: currentFacingMode,
                width: { ideal: 1280 },
                height: { ideal: 960 }
            },
            audio: false
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);

        const video = document.getElementById('camera-preview');
        video.srcObject = videoStream;

        elements.actions.addClass('hidden');
        elements.cameraView.removeClass('hidden');

    } catch (error) {
        console.error('Camera error:', error);
        alert('Kamera erisimi reddedildi veya kamera bulunamadi.');
    }
}

/**
 * Switch between front and back camera
 */
async function switchCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

    // Stop current stream
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }

    // Reopen with new facing mode
    await openCamera();
}

/**
 * Capture photo from video
 */
function capturePhoto() {
    const video = document.getElementById('camera-preview');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');

    // Flip horizontally if using front camera
    if (currentFacingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0);

    // Stop camera
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    // Convert to blob and show preview
    canvas.toBlob((blob) => {
        capturedPhotoBlob = blob;

        // Show preview
        const url = URL.createObjectURL(blob);
        elements.photoPreview.attr('src', url);

        elements.cameraView.addClass('hidden');
        elements.photoPreviewView.removeClass('hidden');

    }, 'image/jpeg', 0.9);
}

/**
 * Send captured photo
 */
async function sendCapturedPhoto() {
    if (!capturedPhotoBlob) return;

    elements.photoPreviewView.addClass('hidden');
    await sendMedia('image', 'photo.jpg', capturedPhotoBlob);
    capturedPhotoBlob = null;
    elements.actions.removeClass('hidden');
}

/**
 * Retake photo
 */
function retakePhoto() {
    capturedPhotoBlob = null;
    elements.photoPreviewView.addClass('hidden');
    openCamera();
}

/**
 * Close camera
 */
function closeCamera() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }

    elements.cameraView.addClass('hidden');
    elements.actions.removeClass('hidden');
}

// ==================== Audio Recording Functions ====================

/**
 * Start audio recording
 */
async function startAudioRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus'
        });
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                audioChunks.push(e.data);
            }
        };

        mediaRecorder.start(100); // Collect data every 100ms

        // Show audio view
        elements.actions.addClass('hidden');
        elements.audioView.removeClass('hidden');

        // Start timer
        audioSeconds = 0;
        updateAudioTimer();
        audioTimer = setInterval(() => {
            audioSeconds++;
            updateAudioTimer();
            updateWaveform();
        }, 1000);

        // Create initial waveform bars
        createWaveformBars();

    } catch (error) {
        console.error('Audio recording error:', error);
        alert('Mikrofon erisimi reddedildi.');
    }
}

/**
 * Update audio timer display
 */
function updateAudioTimer() {
    const mins = Math.floor(audioSeconds / 60);
    const secs = audioSeconds % 60;
    elements.audioTimer.text(`${mins}:${secs.toString().padStart(2, '0')}`);
}

/**
 * Create waveform visualization bars
 */
function createWaveformBars() {
    elements.waveformBars.empty();
    for (let i = 0; i < 30; i++) {
        const bar = $('<div>').addClass('waveform-bar').css('height', '4px');
        elements.waveformBars.append(bar);
    }
}

/**
 * Update waveform animation
 */
function updateWaveform() {
    const bars = elements.waveformBars.find('.waveform-bar');
    bars.each(function() {
        const height = Math.random() * 50 + 10;
        $(this).css('height', height + 'px');
    });
}

/**
 * Stop audio recording and send
 */
async function stopAudioRecording() {
    clearInterval(audioTimer);

    return new Promise((resolve) => {
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });

            elements.audioView.addClass('hidden');

            await sendMedia('audio', 'recording.webm', blob);

            elements.actions.removeClass('hidden');
            resolve();
        };

        mediaRecorder.stop();

        // Stop microphone
        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    });
}

/**
 * Cancel audio recording
 */
function cancelAudioRecording() {
    clearInterval(audioTimer);

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
    }

    elements.audioView.addClass('hidden');
    elements.actions.removeClass('hidden');
}

// ==================== File Handling ====================

/**
 * Handle file selection from gallery
 */
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    await sendMedia('image', file.name, file);

    // Reset input for next selection
    event.target.value = '';
}

// ==================== Media Sending ====================

/**
 * Send media to Tahta
 */
async function sendMedia(type, filename, blob) {
    if (!rtc || !rtc.isConnected) {
        showError('Baglanti yok. Sayfayi yenileyin.');
        return;
    }

    try {
        // Show progress
        elements.progress.removeClass('hidden');
        elements.progressText.text('Gonderiliyor...');
        elements.progressBar.css('width', '0%');

        // Send via WebRTC
        if (type === 'image') {
            await rtc.sendImage(blob, filename);
        } else if (type === 'audio') {
            await rtc.sendAudio(blob, filename);
        }

        // Success
        elements.progressText.text('Gonderildi!');
        elements.progressBar.css('width', '100%');

        // Hide progress after delay
        setTimeout(() => {
            elements.progress.addClass('hidden');
            elements.progressBar.css('width', '0%');
        }, 2000);

    } catch (error) {
        console.error('Send error:', error);
        elements.progressText.text('Gonderme hatasi!');

        setTimeout(() => {
            elements.progress.addClass('hidden');
        }, 2000);
    }
}

// ==================== Cleanup ====================

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    if (rtc) {
        rtc.disconnect();
    }
});
