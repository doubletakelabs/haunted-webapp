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
const statusInfo = document.getElementById('statusInfo');
const userListContainer = document.getElementById('userListContainer');

// Audio state
let isPlaying = false;

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
    `;
    userListContainer.appendChild(summary);
}

// Event listeners
playBtn.addEventListener('click', () => {
    socket.emit('playAudio');
    isPlaying = true;
    log('Sent play command to all clients');
});

pauseBtn.addEventListener('click', () => {
    socket.emit('pauseAudio');
    isPlaying = false;
    log('Sent stop command to all clients');
});

restartBtn.addEventListener('click', () => {
    socket.emit('restart');
    isPlaying = false;
    log('Restarted experience for all clients');
});

endingTrackBtn.addEventListener('click', () => {
    socket.emit('playEndingTrack');
    log('Playing ending track for all clients');
});

// Socket events
socket.on('connect', () => {
    log('Connected to server');
});

socket.on('disconnect', () => {
    log('Disconnected from server');
});

// Handle user list updates
socket.on('userList', (users) => {
    updateUserList(users);
    log(`User list updated: ${Object.keys(users).length} users connected`);
});

// Initial log
log('Admin panel initialized'); 