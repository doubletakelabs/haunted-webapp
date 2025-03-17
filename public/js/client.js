// Connect to socket.io
const socket = io();

// Cookie functions
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function deleteCookie(name) {
    // Multiple approaches to ensure cookie deletion works
    // 1. Standard approach
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    
    // 2. Try with different paths
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=`;
    
    // 3. Try with domain
    const domain = window.location.hostname;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${domain}`;
    
    // 4. Try with max-age approach
    document.cookie = `${name}=; max-age=0; path=/;`;
    
    // 5. Overwrite with empty value
    document.cookie = `${name}=`;
    
    // Verify deletion
    const cookieExists = getCookie(name);
    if (cookieExists) {
        console.warn(`Warning: Failed to delete cookie ${name}`);
    } else {
        console.log(`Cookie ${name} deleted successfully`);
    }
}

// DOM elements
const audioStatus = document.getElementById('audioStatus');
const startButton = document.getElementById('startButton');
const contentContainer = document.getElementById('contentContainer');
const loadingContainer = document.getElementById('loadingContainer');
const loadingProgress = document.getElementById('loadingProgress');
const loadingText = document.getElementById('loadingText');

// Track if user has interacted with the page
let userInteracted = false;

// Get the assigned track
const audioTrack = getCookie('audioTrack') || '1'; // Default to track 1

// Report track to server
socket.emit('reportTrack', { track: audioTrack });

// Audio loading state
let mainAudioLoaded = false;
let endingAudioLoaded = false;
let totalBytesLoaded = 0;
let totalBytesExpected = 1; // Start with 1 to avoid division by zero

// Create audio elements
const mainAudio = new Audio();
mainAudio.src = `/audio/track${audioTrack}.mp3`;
mainAudio.loop = false;

const endingAudio = new Audio();
endingAudio.src = '/audio/end.mp3';
endingAudio.loop = false;

// Hide loading container initially until we start loading
loadingContainer.style.display = 'none';

// Update loading progress
function updateLoadingProgress(loaded, total, isMainAudio) {
    if (isMainAudio) {
        mainAudioLoaded = (loaded === total);
    } else {
        endingAudioLoaded = (loaded === total);
    }
    
    totalBytesLoaded = loaded;
    totalBytesExpected = total;
    
    // Calculate percentage
    const percentage = Math.min(100, Math.round((totalBytesLoaded / totalBytesExpected) * 100));
    
    // Update loading bar
    loadingProgress.style.width = `${percentage}%`;
    loadingText.textContent = `Loading audio files: ${percentage}%`;
    
    // If both files are loaded, hide the loading bar and show the start button
    if (mainAudioLoaded && endingAudioLoaded) {
        loadingContainer.style.display = 'none';
        startButton.style.display = 'block';
        
        // Still update the status text even though it's hidden (for debugging)
        audioStatus.textContent = 'Audio loaded. Ready to start.';
    }
}

// Set up XMLHttpRequest to track loading progress for main audio
function preloadAudio(url, isMainAudio) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        
        xhr.onprogress = function(event) {
            if (event.lengthComputable) {
                updateLoadingProgress(event.loaded, event.total, isMainAudio);
            }
        };
        
        xhr.onload = function() {
            if (xhr.status === 200) {
                updateLoadingProgress(xhr.response.byteLength, xhr.response.byteLength, isMainAudio);
                resolve();
            } else {
                reject(new Error(`Failed to load audio: ${xhr.statusText}`));
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('Network error while loading audio'));
        };
        
        xhr.send();
    });
}

// Start preloading audio files
function startPreloading() {
    loadingContainer.style.display = 'flex';
    startButton.style.display = 'none';
    
    // Preload both audio files
    Promise.all([
        preloadAudio(`/audio/track${audioTrack}.mp3`, true),
        preloadAudio('/audio/end.mp3', false)
    ]).then(() => {
        console.log('All audio files preloaded successfully');
    }).catch(error => {
        console.error('Error preloading audio:', error);
        loadingText.textContent = 'Error loading audio. Please refresh the page.';
    });
}

// Start preloading immediately
startPreloading();

// Update status display
function updateStatus() {
    let statusText = `Track: ${audioTrack}`;
    
    if (!mainAudio.paused) {
        statusText += ` | Playing Main | Time: ${Math.floor(mainAudio.currentTime)}s`;
    } else if (!endingAudio.paused) {
        statusText += ` | Playing Ending | Time: ${Math.floor(endingAudio.currentTime)}s`;
    } else {
        statusText += ' | Paused';
    }
    
    // Update the status text even though it's hidden (for debugging)
    audioStatus.textContent = statusText;
    
    // Also log to console for debugging
    console.log(`Status: ${statusText}`);
}

// Handle play audio command
function handlePlayAudio(data) {
    if (!userInteracted) {
        console.log('Cannot play audio until user interacts with the page');
        return;
    }
    
    console.log('Executing play command', data);
    
    // Stop ending audio
    endingAudio.pause();
    endingAudio.currentTime = 0;
    
    // Play main audio
    if (data && typeof data.startAt === 'number') {
        if(data.startAt > mainAudio.duration) {
            return;
        }
        mainAudio.currentTime = data.startAt;
    }
    
    mainAudio.play().catch(e => {
        console.error('Error playing audio:', e);
    });
    
    updateStatus();
}

// Handle pause audio command
function handlePauseAudio() {
    if (!userInteracted) {
        console.log('Cannot pause audio until user interacts with the page');
        return;
    }
    
    console.log('Executing pause command');
    
    mainAudio.pause();
    endingAudio.pause();
    
    updateStatus();
}

// Handle play ending track command
function handlePlayEndingTrack(data) {
    if (!userInteracted) {
        console.log('Cannot play ending audio until user interacts with the page');
        return;
    }
    
    console.log('Executing play ending track command', data);
    
    // Stop main audio
    mainAudio.pause();
    mainAudio.currentTime = 0;
    
    // Play ending audio
    if (data && typeof data.startAt === 'number') {
        if(data.startAt > endingAudio.duration) {
            return;
        }
        endingAudio.currentTime = data.startAt;
    }

    endingAudio.play().catch(e => {
        console.error('Error playing ending audio:', e);
    });
    
    updateStatus();
}

// Start button click handler
startButton.addEventListener('click', () => {
    userInteracted = true;
    contentContainer.classList.add('hidden');
    contentContainer.style.display = 'none';
    startButton.classList.add('hidden');
    startButton.style.display = 'none'; // Ensure the button is completely hidden

    mainAudio.play();
    endingAudio.play();
    mainAudio.pause();
    endingAudio.pause();

    // Request the latest command from the server
    socket.emit('getLatestCommand');
    
    // Update status to show we're ready
    updateStatus();
});

// Update status every second
setInterval(updateStatus, 1000);

// Socket events
socket.on('playAudio', function(data) {
    handlePlayAudio(data);
});

socket.on('pauseAudio', function() {
    handlePauseAudio();
});

socket.on('playEndingTrack', function(data) {
    handlePlayEndingTrack(data);
});

socket.on('restart', function() {
    console.log('Experience restarted');
    
    mainAudio.pause();
    endingAudio.pause();
    
    updateStatus();
    
    // Clear the audioTrack cookie when experience restarts
    deleteCookie('audioTrack');
    
    // Don't show the start button again after restart
    // The page will reload due to clearTrackCookie event
});

socket.on('clearTrackCookie', function() {
    console.log('Clearing track cookie');
    deleteCookie('audioTrack');
    
    // Force reload to ensure we get a new track assignment
    setTimeout(() => {
        window.location.reload();
    }, 100);
});