// Connect to socket.io with keepalive configuration
const socket = io({
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  timeout: 20000,
});

// Cookie functions
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function setCookie(name, value, days) {
    var expires = "";
    if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days*24*60*60*1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "")  + expires + "; path=/";
}

// DOM elements
const audioStatus = document.getElementById('audioStatus');
const startButton = document.getElementById('startButton');
const contentContainer = document.getElementById('contentContainer');
const loadingContainer = document.getElementById('loadingContainer');
const loadingText = document.getElementById('loadingText');

// State
let userInteracted = false;
let audioTrack = getCookie('audioTrack') || '1';
let stemPlaying = false; // Desired state of stem
let triggerPlaying = false;
let currentTriggerFile = '';
let triggerStartTime = 0; // To calculate how much time to skip
let isLastClip = false;
let pendingSyncTime = -1; // Store server time to apply on unlock
let wakeLock = null; // Wake lock reference

// Audio Elements
const mainAudio = new Audio(); // The Stem
mainAudio.loop = false; 
mainAudio.preload = 'auto'; // Ensure we try to load metadata
// We preload main stem based on track
mainAudio.src = `/audio/track${audioTrack}.mp3`;

const triggerAudio = new Audio(); // The Interruption
triggerAudio.onended = () => {
    triggerPlaying = false;
    currentTriggerFile = '';
    
    resumeStemIfShould();
    
    isLastClip = false; // Reset flag
    updateStatus();
};

// Silent audio to prevent device sleep
const silentAudio = new Audio('/audio/silence.mp3');
silentAudio.loop = true;
silentAudio.volume = 0.01; // Very quiet

function startSilentAudio() {
    try {
        // If already playing, don't restart
        if (!silentAudio.paused) {
            return;
        }
        
        // Start playing the silent audio file
        silentAudio.play()
            .then(() => {
                console.log('Silent audio started to prevent sleep');
            })
            .catch(err => {
                console.error('Failed to start silent audio:', err);
                // Retry after a short delay
                setTimeout(() => {
                    silentAudio.play().catch(e => console.error('Retry failed:', e));
                }, 500);
            });
    } catch (e) {
        console.error('Failed to start silent audio:', e);
    }
}

// Report track to server
socket.emit('reportTrack', { track: audioTrack });

// Socket.io connection and reconnection handling
socket.on('connect', () => {
    console.log('Socket connected');
    // Send periodic keepalive ping to prevent timeout
    if (userInteracted) {
        socket.emit('ping');
    }
});

socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Socket reconnected after', attemptNumber, 'attempts');
    // Re-report track to server
    socket.emit('reportTrack', { track: audioTrack });
    // Get latest command to sync state
    socket.emit('getLatestCommand');
    // Re-request wake lock if user had previously interacted
    if (userInteracted && 'wakeLock' in navigator) {
        navigator.wakeLock.request('screen')
            .then(lock => {
                wakeLock = lock;
                console.log('Wake Lock re-acquired after reconnect');
            })
            .catch(err => console.error('Wake Lock re-acquisition failed:', err));
    }
    // Restart silent audio
    if (userInteracted) {
        startSilentAudio();
    }
});

// Send periodic keepalive pings to prevent timeout
setInterval(() => {
    if (socket.connected && userInteracted) {
        socket.emit('ping');
    }
}, 20000); // Every 20 seconds

// Monitor and maintain silent audio to prevent device sleep
setInterval(() => {
    if (userInteracted) {
        // Check if silent audio is paused and restart it
        if (silentAudio.paused) {
            console.log('Silent audio paused, restarting...');
            startSilentAudio();
        }
    }
}, 5000); // Check every 5 seconds

// Interaction Handler
startButton.addEventListener('click', () => {
    // Request Wake Lock immediately to prevent device sleep
    if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen')
        .then(lock => {
            wakeLock = lock;
            console.log('Wake Lock active');
            // Re-acquire lock if visibility changes (e.g. tab switch)
            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible') {
                    // Re-acquire wake lock if needed
                    if (wakeLock === null) {
                        try {
                            wakeLock = await navigator.wakeLock.request('screen');
                            console.log('Wake Lock re-acquired on visibility change');
                        } catch (err) {
                            console.error('Wake Lock re-acquisition failed:', err);
                        }
                    }
                    // Resume silent audio if paused
                    if (silentAudio.paused) {
                        startSilentAudio();
                    }
                }
            });
        })
        .catch(err => console.error('Wake Lock failed:', err));
    }
    
    userInteracted = true;
    
    // Start playing silent audio to prevent device sleep
    // Do this synchronously to ensure it starts before device can sleep
    startSilentAudio();
    
    // Also send immediate ping to keep connection alive
    if (socket.connected) {
        socket.emit('ping');
    }
    contentContainer.style.display = 'none';
    loadingContainer.style.display = 'none';
    
    // unlock audio
    // Explicitly load to ensure mobile browsers are ready
    mainAudio.load();
    
    mainAudio.play().then(() => {
        mainAudio.pause();
        
        // Apply pending sync time if we have one
        if (pendingSyncTime >= 0) {
            console.log("Applying pending sync time on unlock:", pendingSyncTime);
            
            const applyTime = () => {
                mainAudio.currentTime = pendingSyncTime;
                console.log("Applied time:", mainAudio.currentTime);
            };

            if (mainAudio.readyState >= 1) {
                applyTime();
            } else {
                // Wait for metadata if not ready
                mainAudio.addEventListener('loadedmetadata', () => {
                    console.log("Metadata loaded, applying time");
                    applyTime();
                }, { once: true });
            }
            
            // Safari fallback: sometimes it needs a retry after a tick
            setTimeout(applyTime, 50);
            setTimeout(applyTime, 200);
        }
        
    }).catch(e => console.log("Audio unlock failed", e));
    
    triggerAudio.play().then(() => {
        triggerAudio.pause();
    }).catch(e => console.log("Trigger unlock failed", e));

    socket.emit('getLatestCommand'); // In case we joined late
    
    // If stem was already playing (received event before click), start it now
    if (stemPlaying && !triggerPlaying) {
        mainAudio.play().catch(e => console.error("Resume stem after unlock", e));
    }
    
    updateStatus();
});

// Helper: Resume Stem with Time Sync
function resumeStemIfShould() {
    if (stemPlaying && !triggerPlaying) {
        // Calculate time skipped
        if (triggerStartTime > 0) {
            const durationPaused = (Date.now() - triggerStartTime) / 1000;
            mainAudio.currentTime += durationPaused;
            triggerStartTime = 0; // Reset
        }
        mainAudio.play().catch(e => console.error("Stem resume failed", e));
    }
}

// Helper: Update Status UI & Server
function updateStatus() {
    let text = `Group: ${audioTrack}`;
    let statusObj = {
        track: audioTrack,
        state: 'idle',
        file: '',
        time: 0,
        duration: 0
    };

    if (triggerPlaying) {
        text += ` | Playing ${currentTriggerFile}`;
        statusObj.state = 'trigger';
        statusObj.file = currentTriggerFile;
        statusObj.time = triggerAudio.currentTime;
        statusObj.duration = triggerAudio.duration;
    } else if (stemPlaying && !mainAudio.paused) {
        text += ` | Playing Stem`;
        statusObj.state = 'stem';
        // Extract filename from src URL
        const srcParts = mainAudio.src.split('/');
        const fileName = srcParts[srcParts.length - 1];
        statusObj.file = decodeURIComponent(fileName);
        statusObj.time = mainAudio.currentTime;
        statusObj.duration = mainAudio.duration;
    } else {
        text += ` | Waiting/Paused`;
        statusObj.state = 'paused';
    }
    
    audioStatus.textContent = text;
    audioStatus.style.display = 'block';
    
    // Console log current playing track if any
    if (statusObj.file && (statusObj.state === 'trigger' || statusObj.state === 'stem')) {
        console.log(`Currently Playing: ${statusObj.file}`);
    }

    // Send to server (throttled or on change)
    socket.emit('reportStatus', statusObj);
}

// Heartbeat to update time
setInterval(() => {
    if (stemPlaying || triggerPlaying) {
        updateStatus();
    }
}, 2000); // Every 2 seconds to avoid spamming too much

// Socket Events

// 1. Set Group (e.g. after sort)
socket.on('setGroup', (data) => {
    console.log("Group updated to", data.group);
    audioTrack = data.group.toString();
    
    // Update Cookie for persistence on refresh
    setCookie('audioTrack', audioTrack, 7);

    // Use provided filename or fallback
    const newSrc = data.filename ? `/audio/${data.filename}` : `/audio/track${audioTrack}.mp3`;

    // Reload main audio source if changed
    if (mainAudio.src !== location.origin + newSrc) {
        const wasPlaying = !mainAudio.paused;
        const currentTime = mainAudio.currentTime;
        
        mainAudio.src = newSrc;
        mainAudio.currentTime = currentTime; 
        
        if (wasPlaying) {
            mainAudio.play().catch(e => console.error(e));
        }
    }
    
    updateStatus();
});

// 1b. Set Track (Update main track file without changing group)
socket.on('setTrack', (data) => {
    console.log("Track updated to", data.filename);
    if (!data.filename) return;
    
    const newSrc = `/audio/${data.filename}`;
    
    // Check if actually changed
    // mainAudio.src is absolute url, so check endsWith or construct absolute
    if (!mainAudio.src.endsWith(newSrc)) {
        const wasPlaying = !mainAudio.paused;
        const currentTime = mainAudio.currentTime;
        
        mainAudio.src = newSrc;
        mainAudio.currentTime = currentTime;
        
        if (wasPlaying) {
             mainAudio.play().catch(e => console.error(e));
        }
        updateStatus();
    }
});

// 2. Play Stem (Global Start)
socket.on('playStem', (data) => {
    console.log("Play Stem", data);
    stemPlaying = true;
    
    // Always sync time first
    if (data.startAt !== undefined) {
         mainAudio.currentTime = data.startAt;
         pendingSyncTime = data.startAt; // Backup for unlock
    }
    
    if (triggerPlaying) {
        // If interrupted, just reset the anchor time so when we resume we add the delta from NOW.
        triggerStartTime = Date.now();
    } else {
        // If user has interacted, play immediately.
        // If not (just joined), we can't autoplay yet.
        if (userInteracted) {
            mainAudio.play().catch(e => console.error("Play stem failed", e));
        } else {
            console.log("Waiting for user interaction to play stem at", data.startAt);
        }
    }
    updateStatus();
});

// 3. Pause Stem (Global Pause)
socket.on('pauseStem', () => {
    console.log("Pause Stem");
    stemPlaying = false;
    mainAudio.pause();
    updateStatus();
});

// 4. Play Trigger (Interruption)
socket.on('playTrigger', (data) => {
    console.log("Play Trigger", data.filename, "Last Clip:", data.isLastClip);
    if (!userInteracted) return;

    // Pause stem if playing
    if (!mainAudio.paused) {
        mainAudio.pause();
    }
    
    triggerAudio.src = `/audio/${data.filename}`;
    currentTriggerFile = data.filename;
    isLastClip = !!data.isLastClip;
    triggerPlaying = true;
    triggerAudio.currentTime = 0;

    if (isLastClip) {
        stemPlaying = false; // Kill stem logic immediately
        triggerStartTime = 0;
    } else {
        // Only track time if we plan to resume
        triggerStartTime = Date.now();
    }
    
    triggerAudio.load(); // Ensure new source is loaded
    triggerAudio.play()
        .catch(e => {
            console.error("Play trigger failed", e);
            audioStatus.textContent = "Error playing trigger: " + e.message;
        });
    
    updateStatus();
});

// 5. Stop Trigger (Stop Audio Button)
socket.on('stopTrigger', () => {
    console.log("Stop Trigger");
    triggerAudio.pause();
    triggerAudio.currentTime = 0;
    triggerPlaying = false;
    currentTriggerFile = '';
    
    // If it was a last clip, stemPlaying is already false.
    // If it was normal, stemPlaying is true.
    // resumeStemIfShould will handle it.
    
    resumeStemIfShould();
    isLastClip = false; // Reset flag
    updateStatus();
});

// 6. Reset Client
socket.on('resetClient', () => {
    console.log("Resetting client state");
    stemPlaying = false;
    triggerPlaying = false;
    mainAudio.pause();
    mainAudio.currentTime = 0;
    triggerAudio.pause();
    triggerAudio.currentTime = 0;
    currentTriggerFile = '';
    triggerStartTime = 0;
    isLastClip = false;
    updateStatus();
});

// 7. Periodic Sync
socket.on('sync', (data) => {
    // Initial sync for paused state
    if (data.isPaused) {
        console.log("Received initial paused sync:", data.elapsedTime);
        mainAudio.currentTime = data.elapsedTime;
        pendingSyncTime = data.elapsedTime; // Backup for unlock
        return;
    }

    // If we are supposed to be playing the stem (and not interrupted by trigger)
    if (stemPlaying && !triggerPlaying) {
        const drift = Math.abs(mainAudio.currentTime - data.elapsedTime);
        // If drift is significant (> 0.5s), snap to server time
        if (drift > 0.5) {
            console.log(`Syncing: Correction of ${drift.toFixed(3)}s`);
            mainAudio.currentTime = data.elapsedTime;
            // Ensure it's playing
            if (mainAudio.paused) mainAudio.play().catch(e => {});
        }
    } else if (stemPlaying && triggerPlaying) {
        // If we are interrupted, we just update our 'resume' target indirectly
        // Actually, simpler: when we eventually resume, we want to resume at 'server elapsed time'
        // + whatever time passes from now until then.
        // But 'resumeStemIfShould' uses 'currentTime += delta'.
        // If 'currentTime' is drifting in background (it shouldn't if paused),
        // we might be better off snapping to this sync time (while paused).
        // Updating currentTime while paused is safe and doesn't start playback.
        
        // However, 'elapsedTime' is NOW.
        // 'triggerStartTime' is when we paused.
        // We want the audio to 'seek' to NOW, but stay paused?
        // NO. We want the audio to conceptually 'play in background'.
        // So if we update mainAudio.currentTime to data.elapsedTime, we are effectively
        // doing exactly what we want: keeping the 'needle' moving.
        mainAudio.currentTime = data.elapsedTime;
        triggerStartTime = Date.now(); // Reset our local delta tracking since we just synced to absolute
    }
});

// 8. Force Refresh
socket.on('forceRefresh', () => {
    console.log("Force refresh received");
    window.location.reload();
});

// Initial Status
updateStatus();
