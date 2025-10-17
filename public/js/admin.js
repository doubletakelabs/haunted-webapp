// Connect to socket.io with admin client identifier
const socket = io({
    query: {
        client: 'admin'
    }
});

// DOM elements
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const endingTrackBtn = document.getElementById('endingTrackBtn');
const loopTrackBtn = document.getElementById('loopTrackBtn');
const returnFromLoopBtn = document.getElementById('returnFromLoopBtn');
const statusInfo = document.getElementById('statusInfo');
const userListContainer = document.getElementById('userListContainer');
const audioTimerContainer = document.getElementById('audioTimerContainer');
const mainTrackTimer = document.getElementById('mainTrackTimer');
const endingTrackTimer = document.getElementById('endingTrackTimer');

// Audio state
let isPlaying = false;
let isEndingPlaying = false;
let isLoopPlaying = false;
let playbackStartTime = null;
let endingStartTime = null;
let loopStartTime = null;
let pausedTime = null;
let timerInterval = null;

// Audio durations (in seconds) - these will be updated when audio metadata is loaded
let mainTrackDurations = {
    track1: 0,
    track2: 0,
    track3: 0,
    track4: 0
};
let endingTrackDuration = 0;
let loopTrackDuration = 0;

// Create hidden audio elements to get durations
const hiddenAudio1 = new Audio('/audio/track1.mp3');
const hiddenAudio2 = new Audio('/audio/track2.mp3');
const hiddenAudio3 = new Audio('/audio/track3.mp3');
const hiddenAudio4 = new Audio('/audio/track4.mp3');
const hiddenEndingAudio = new Audio('/audio/end.mp3');
const hiddenLoopAudio = new Audio('/audio/loop.mp3');

// Load audio metadata to get durations
hiddenAudio1.addEventListener('loadedmetadata', () => {
    mainTrackDurations.track1 = hiddenAudio1.duration;
    updateTimerDisplay();
    log('Track 1 duration loaded: ' + formatTime(mainTrackDurations.track1));
});

hiddenAudio2.addEventListener('loadedmetadata', () => {
    mainTrackDurations.track2 = hiddenAudio2.duration;
    updateTimerDisplay();
    log('Track 2 duration loaded: ' + formatTime(mainTrackDurations.track2));
});

hiddenAudio3.addEventListener('loadedmetadata', () => {
    mainTrackDurations.track3 = hiddenAudio3.duration;
    updateTimerDisplay();
    log('Track 3 duration loaded: ' + formatTime(mainTrackDurations.track3));
});

hiddenAudio4.addEventListener('loadedmetadata', () => {
    mainTrackDurations.track4 = hiddenAudio4.duration;
    updateTimerDisplay();
    log('Track 4 duration loaded: ' + formatTime(mainTrackDurations.track4));
});

hiddenEndingAudio.addEventListener('loadedmetadata', () => {
    endingTrackDuration = hiddenEndingAudio.duration;
    updateTimerDisplay();
    log('Ending track duration loaded: ' + formatTime(endingTrackDuration));
});

hiddenLoopAudio.addEventListener('loadedmetadata', () => {
    loopTrackDuration = hiddenLoopAudio.duration;
    updateTimerDisplay();
    log('Loop track duration loaded: ' + formatTime(loopTrackDuration));
});

// Format time in seconds to MM:SS format
function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return '00:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Update timer display
function updateTimerDisplay() {
    const currentTime = Date.now();
    let elapsedMainTime = 0;
    let elapsedEndingTime = 0;
    let elapsedLoopTime = 0;
    
    if (isPlaying && playbackStartTime) {
        elapsedMainTime = (currentTime - playbackStartTime) / 1000;
    }
    
    if (isEndingPlaying && endingStartTime) {
        elapsedEndingTime = (currentTime - endingStartTime) / 1000;
    }
    
    if (isLoopPlaying && loopStartTime) {
        elapsedLoopTime = (currentTime - loopStartTime) / 1000;
    }
    
    // Calculate average duration for main tracks
    const avgMainDuration = (mainTrackDurations.track1 + mainTrackDurations.track2 + mainTrackDurations.track3 + mainTrackDurations.track4) / 4;
    
    // Update main track timer - show paused time when in loop mode
    let mainTrackStatus = '';
    let mainTrackTime = elapsedMainTime;
    
    if (isLoopPlaying && pausedTime !== null) {
        mainTrackStatus = ' (Paused at)';
        mainTrackTime = pausedTime;
    } else if (isLoopPlaying) {
        mainTrackStatus = ' (Paused)';
        mainTrackTime = 0;
    }
    
    mainTrackTimer.innerHTML = `
        <div class="timer-label">Main Tracks${mainTrackStatus}:</div>
        <div class="timer-time">${formatTime(mainTrackTime)} / ${formatTime(avgMainDuration)}</div>
        <div class="timer-progress">
            <div class="timer-bar" style="width: ${Math.min(100, (mainTrackTime / avgMainDuration) * 100)}%"></div>
        </div>
    `;
    
    // Update ending track timer
    endingTrackTimer.innerHTML = `
        <div class="timer-label">Ending Track:</div>
        <div class="timer-time">${formatTime(elapsedEndingTime)} / ${formatTime(endingTrackDuration)}</div>
        <div class="timer-progress">
            <div class="timer-bar" style="width: ${Math.min(100, (elapsedEndingTime / endingTrackDuration) * 100)}%"></div>
        </div>
    `;
    
    // Update timer container visibility
    if (isPlaying || isEndingPlaying || isLoopPlaying) {
        audioTimerContainer.style.display = 'block';
    } else {
        audioTimerContainer.style.display = 'block'; // Keep visible but show 00:00
    }
}

// Start timer update interval
function startTimerInterval() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimerDisplay, 1000);
}

// Stop timer update interval
function stopTimerInterval() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Log function
function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    statusInfo.innerHTML = `[${timestamp}] ${message}\n` + statusInfo.innerHTML;
}

// Update user list display
function updateUserList(users) {
    // Clear current list
    userListContainer.innerHTML = '';
    
    // Create table header
    const table = document.createElement('table');
    table.className = 'user-table';
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    const headers = ['User ID', 'Track', 'Connected At', 'Status'];
    headers.forEach(headerText => {
        const th = document.createElement('th');
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create table body
    const tbody = document.createElement('tbody');
    
    // Count users by track
    let track1Count = 0;
    let track2Count = 0;
    let track3Count = 0;
    let track4Count = 0;
    
    // Add user rows
    if (Object.keys(users).length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 4;
        emptyCell.textContent = 'No users connected';
        emptyCell.className = 'empty-message';
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
    } else {
        Object.values(users).forEach(user => {
            const row = document.createElement('tr');
            
            // User ID cell
            const idCell = document.createElement('td');
            idCell.textContent = user.id.substring(0, 8) + '...'; // Truncate for display
            row.appendChild(idCell);
            
            // Track cell
            const trackCell = document.createElement('td');
            trackCell.textContent = user.track;
            trackCell.className = `track-${user.track}`;
            row.appendChild(trackCell);
            
            // Count tracks
            if (user.track === '1') track1Count++;
            if (user.track === '2') track2Count++;
            if (user.track === '3') track3Count++;
            if (user.track === '4') track4Count++;
            
            // Connected At cell
            const timeCell = document.createElement('td');
            timeCell.textContent = user.connectedAt;
            row.appendChild(timeCell);
            
            // Status cell
            const statusCell = document.createElement('td');
            statusCell.textContent = 'Connected';
            statusCell.className = 'status-connected';
            row.appendChild(statusCell);
            
            tbody.appendChild(row);
        });
    }
    
    table.appendChild(tbody);
    userListContainer.appendChild(table);
    
    // Add summary
    const summary = document.createElement('div');
    summary.className = 'user-summary';
    summary.innerHTML = `
        <p>Total connected: <strong>${Object.keys(users).length}</strong></p>
        <p>Track 1: <strong>${track1Count}</strong> users</p>
        <p>Track 2: <strong>${track2Count}</strong> users</p>
        <p>Track 3: <strong>${track3Count}</strong> users</p>
        <p>Track 4: <strong>${track4Count}</strong> users</p>
    `;
    userListContainer.appendChild(summary);
}

// Event listeners
playBtn.addEventListener('click', () => {
    socket.emit('playAudio');
    isPlaying = true;
    isEndingPlaying = false;
    playbackStartTime = Date.now();
    endingStartTime = null;
    startTimerInterval();
    log('Sent play command to all clients');
    updateTimerDisplay();
});

pauseBtn.addEventListener('click', () => {
    socket.emit('pauseAudio');
    isPlaying = false;
    isEndingPlaying = false;
    log('Sent pause command to all clients');
    updateTimerDisplay();
});

restartBtn.addEventListener('click', () => {
    socket.emit('restart');
    isPlaying = false;
    isEndingPlaying = false;
    playbackStartTime = null;
    endingStartTime = null;
    log('Restarted experience for all clients');
    updateTimerDisplay();
});

endingTrackBtn.addEventListener('click', () => {
    socket.emit('playEndingTrack');
    isPlaying = false;
    isEndingPlaying = true;
    isLoopPlaying = false;
    playbackStartTime = null;
    endingStartTime = Date.now();
    loopStartTime = null;
    startTimerInterval();
    log('Playing ending track for all clients');
    updateTimerDisplay();
});

loopTrackBtn.addEventListener('click', () => {
    socket.emit('playLoopTrack');
    isPlaying = false;
    isEndingPlaying = false;
    isLoopPlaying = true;
    playbackStartTime = null;
    endingStartTime = null;
    loopStartTime = Date.now();
    startTimerInterval();
    log('Pushing all clients to loop track');
    updateTimerDisplay();
});

returnFromLoopBtn.addEventListener('click', () => {
    socket.emit('returnFromLoop');
    isPlaying = true;
    isEndingPlaying = false;
    isLoopPlaying = false;
    playbackStartTime = Date.now();
    endingStartTime = null;
    loopStartTime = null;
    startTimerInterval();
    log('Returning all clients to original tracks');
    updateTimerDisplay();
});

// Socket events
socket.on('connect', () => {
    log('Connected to server');
    startTimerInterval(); // Start the timer interval when connected
});

socket.on('disconnect', () => {
    log('Disconnected from server');
    stopTimerInterval(); // Stop the timer interval when disconnected
});

// Handle user list updates
socket.on('userList', (users) => {
    updateUserList(users);
    log(`User list updated: ${Object.keys(users).length} users connected`);
});

// Handle playback status updates from server
socket.on('playbackStatus', (data) => {
    if (data.status === 'playing') {
        isPlaying = true;
        isEndingPlaying = false;
        isLoopPlaying = false;
        playbackStartTime = Date.now() - (data.elapsedTime * 1000);
        endingStartTime = null;
        loopStartTime = null;
    } else if (data.status === 'playingEnding') {
        isPlaying = false;
        isEndingPlaying = true;
        isLoopPlaying = false;
        playbackStartTime = null;
        endingStartTime = Date.now() - (data.elapsedTime * 1000);
        loopStartTime = null;
    } else if (data.status === 'playingLoop') {
        isPlaying = false;
        isEndingPlaying = false;
        isLoopPlaying = true;
        playbackStartTime = null;
        endingStartTime = null;
        loopStartTime = Date.now();
    } else if (data.status === 'paused') {
        isPlaying = false;
        isEndingPlaying = false;
        isLoopPlaying = false;
    }
    
    // Update paused time if provided
    if (data.pausedTime !== undefined) {
        pausedTime = data.pausedTime;
        console.log(`Admin received paused time: ${pausedTime} seconds`);
    }
    
    updateTimerDisplay();
});

// Initial log
log('Admin panel initialized');

// Initial timer display update
updateTimerDisplay(); 