// Connect to socket.io
const socket = io();

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

// Audio Elements
const mainAudio = new Audio(); // The Stem
mainAudio.loop = false; 
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

// Report track to server
socket.emit('reportTrack', { track: audioTrack });

// Interaction Handler
startButton.addEventListener('click', () => {
    userInteracted = true;
    contentContainer.style.display = 'none';
    loadingContainer.style.display = 'none';
    
    // unlock audio
    mainAudio.play().then(() => {
        mainAudio.pause();
        mainAudio.currentTime = 0;
    }).catch(e => console.log("Audio unlock failed", e));
    
    triggerAudio.play().then(() => {
        triggerAudio.pause();
    }).catch(e => console.log("Trigger unlock failed", e));

    socket.emit('getLatestCommand'); // In case we joined late
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
        statusObj.file = `track${audioTrack}.mp3`;
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

    // Reload main audio source
    const wasPlaying = !mainAudio.paused;
    const currentTime = mainAudio.currentTime;
    
    mainAudio.src = `/audio/track${audioTrack}.mp3`;
    mainAudio.currentTime = currentTime; 
    
    if (wasPlaying) {
        mainAudio.play().catch(e => console.error(e));
    }
    
    updateStatus();
});

// 2. Play Stem (Global Start)
socket.on('playStem', (data) => {
    console.log("Play Stem", data);
    stemPlaying = true;
    
    // Always sync time first
    if (data.startAt !== undefined) {
         mainAudio.currentTime = data.startAt;
    }
    
    if (triggerPlaying) {
        // If interrupted, just reset the anchor time so when we resume we add the delta from NOW.
        triggerStartTime = Date.now();
    } else {
        mainAudio.play().catch(e => console.error("Play stem failed", e));
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
    
    triggerAudio.play().catch(e => console.error("Play trigger failed", e));
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

// Initial Status
updateStatus();
