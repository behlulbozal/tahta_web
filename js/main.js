/**
 * Tahta Connect - Main Application
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
let facingMode = 'environment';
let capturedBlob = null;

// Views
const views = {
    error: null,
    main: null,
    camera: null,
    photo: null,
    audio: null,
    progress: null,
    success: null
};

// Initialize
$(document).ready(() => {
    // Cache views
    views.error = $('#error-view');
    views.main = $('#main-view');
    views.camera = $('#camera-view');
    views.photo = $('#photo-view');
    views.audio = $('#audio-view');
    views.progress = $('#progress-view');
    views.success = $('#success-view');

    // Get room from URL
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');

    if (!roomId) {
        showError('Gecersiz baglanti. QR kodu tekrar okutun.');
        return;
    }

    // Connect
    connect(roomId);

    // Event handlers
    $('#btn-camera').click(openCamera);
    $('#btn-gallery').click(() => $('#file-input').click());
    $('#btn-audio').click(startRecording);
    $('#btn-pdf').click(requestPdf);
    $('#btn-capture').click(capture);
    $('#btn-cancel-camera').click(closeCamera);
    $('#btn-switch-camera').click(switchCamera);
    $('#btn-send-photo').click(sendPhoto);
    $('#btn-retake').click(retake);
    $('#btn-stop-audio').click(stopRecording);
    $('#btn-cancel-audio').click(cancelRecording);
    $('#btn-retry').click(() => location.reload());
    $('#file-input').change(handleFile);
});

// Show a view
function showView(name) {
    Object.values(views).forEach(v => v.addClass('hidden'));
    if (views[name]) views[name].removeClass('hidden');
}

// Update status
function setStatus(state, text) {
    $('#status-dot').removeClass('connecting connected error').addClass(state);
    $('#status-text').text(text);
}

// Show error
function showError(message) {
    $('#error-text').text(message);
    setStatus('error', 'Hata');
    showView('error');
}

// Connect to Tahta
async function connect(roomId) {
    setStatus('connecting', 'Baglaniyor');

    try {
        signaling = new FirebaseSignaling(roomId);

        const exists = await signaling.checkRoom();
        if (!exists) {
            showError('Tahta bulunamadi. QR kodu tekrar okutun.');
            return;
        }

        rtc = new WebRTCClient(signaling);

        rtc.onConnected = () => {
            setStatus('connected', 'Bagli');
            showView('main');
        };

        rtc.onDisconnected = () => {
            setStatus('error', 'Baglanti kesildi');
        };

        rtc.onProgress = (p) => {
            $('#progress-fill').css('width', (p * 100) + '%');
        };

        rtc.onError = () => {
            showError('Baglanti hatasi.');
        };

        await rtc.connect();

    } catch (e) {
        console.error(e);
        showError('Baglanti kurulamadi.');
    }
}

// Camera
async function openCamera() {
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: false
        });
        document.getElementById('camera-preview').srcObject = videoStream;
        showView('camera');
    } catch (e) {
        alert('Kamera erisimi reddedildi.');
    }
}

function closeCamera() {
    stopCamera();
    showView('main');
}

function stopCamera() {
    if (videoStream) {
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
    }
}

async function switchCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    stopCamera();
    await openCamera();
}

function capture() {
    const video = document.getElementById('camera-preview');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);

    stopCamera();

    canvas.toBlob(blob => {
        capturedBlob = blob;
        $('#photo-preview').attr('src', URL.createObjectURL(blob));
        showView('photo');
    }, 'image/jpeg', 0.9);
}

function retake() {
    capturedBlob = null;
    openCamera();
}

async function sendPhoto() {
    if (!capturedBlob) return;
    showView('progress');
    $('#progress-text').text('Gonderiliyor...');
    $('#progress-fill').css('width', '0%');

    try {
        await rtc.sendImage(capturedBlob, 'photo.jpg');
        showSuccess();
    } catch (e) {
        showError('Gonderilemedi.');
    }
    capturedBlob = null;
}

// Gallery
async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    showView('progress');
    $('#progress-text').text('Gonderiliyor...');
    $('#progress-fill').css('width', '0%');

    try {
        await rtc.sendImage(file, file.name);
        showSuccess();
    } catch (e) {
        showError('Gonderilemedi.');
    }
}

// Audio
async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start(100);
        audioSeconds = 0;
        updateTimer();
        audioTimer = setInterval(() => {
            audioSeconds++;
            updateTimer();
        }, 1000);

        showView('audio');
    } catch (e) {
        alert('Mikrofon erisimi reddedildi.');
    }
}

function updateTimer() {
    const m = Math.floor(audioSeconds / 60);
    const s = audioSeconds % 60;
    $('#audio-timer').text(`${m}:${s.toString().padStart(2, '0')}`);
}

function cancelRecording() {
    clearInterval(audioTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    showView('main');
}

async function stopRecording() {
    clearInterval(audioTimer);

    return new Promise(resolve => {
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });

            showView('progress');
            $('#progress-text').text('Gonderiliyor...');
            $('#progress-fill').css('width', '0%');

            try {
                await rtc.sendAudio(blob, 'kayit.webm');
                showSuccess();
            } catch (e) {
                showError('Gonderilemedi.');
            }
            resolve();
        };

        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    });
}

// PDF
function requestPdf() {
    if (!rtc || !rtc.isConnected) {
        alert('Baglanti yok');
        return;
    }

    showView('progress');
    $('#progress-text').text('PDF hazirlaniyor...');
    $('#progress-fill').css('width', '0%');

    // Set up file received callback
    rtc.onFileReceived = (type, filename, blob) => {
        if (type === 'pdf') {
            showSuccess();
        }
    };

    try {
        rtc.requestPdf();
    } catch (e) {
        showError('PDF alinamadi.');
    }
}

// Success
function showSuccess() {
    showView('success');
    setTimeout(() => showView('main'), 1500);
}

// Cleanup
window.addEventListener('beforeunload', () => {
    stopCamera();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (rtc) rtc.disconnect();
});
