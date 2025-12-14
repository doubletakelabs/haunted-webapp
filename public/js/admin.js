const socket = io({
    query: { client: 'admin' }
});

// State
let users = {}; // { socketId: { ... } }
let audioFiles = [];
let hiddenFiles = new Set();
let groupTracks = {}; // { groupId: filename }
let selectedUsers = new Set(); // Set of socketIds
let selectedAudio = null; // Filename

// DOM Elements
const groupsContainer = document.getElementById('groupsContainer');
const audioList = document.getElementById('audioList');
const hiddenAudioList = document.getElementById('hiddenAudioList');
const hiddenFilesContainer = document.getElementById('hiddenFilesContainer');
const loadCueBtn = document.getElementById('loadCueBtn');
const triggerCuesBtn = document.getElementById('triggerCuesBtn');
const clearCuesBtn = document.getElementById('clearCuesBtn');
const stopAudioBtn = document.getElementById('stopAudioBtn');
const sortPlayersBtn = document.getElementById('sortPlayersBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const playStemBtn = document.getElementById('playStemBtn');
const pauseStemBtn = document.getElementById('pauseStemBtn');
const resetExperienceBtn = document.getElementById('resetExperienceBtn');
const isLastClipCheckbox = document.getElementById('isLastClip');
const globalTimer = document.getElementById('globalTimer');
const groupCountSlider = document.getElementById('groupCountSlider');
const groupCountLabel = document.getElementById('groupCountLabel');
const applyGroupCountBtn = document.getElementById('applyGroupCountBtn');

let currentGroupCount = 6;

// Initialize Groups
function initGroups() {
    groupsContainer.innerHTML = '';
    for (let i = 1; i <= currentGroupCount; i++) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'group-container';
        groupDiv.dataset.groupId = i;
        
        // Create options for track selection
        let options = '';
        audioFiles.forEach(file => {
            // Default selection: track{i}.mp3
            const selected = (groupTracks && groupTracks[i] === file) || (!groupTracks && file === `track${i}.mp3`) ? 'selected' : '';
            options += `<option value="${file}" ${selected}>${file}</option>`;
        });

        groupDiv.innerHTML = `
            <div class="group-header" onclick="toggleGroupSelection(${i})">
                <input type="checkbox" class="checkbox group-checkbox" data-group="${i}">
                GROUP ${i}
                <select onclick="event.stopPropagation()" onchange="updateGroupTrack(${i}, this.value)" style="margin-left: auto; font-size: 0.8rem; padding: 2px;">
                    ${options}
                </select>
            </div>
            <div class="group-users" id="group-${i}-users" ondrop="drop(event)" ondragover="allowDrop(event)"></div>
        `;
        groupsContainer.appendChild(groupDiv);
    }
}

// Update Group Track
window.updateGroupTrack = function(groupId, filename) {
    socket.emit('updateGroupTrack', { groupId: groupId, filename: filename });
}

// Group Slider Logic
groupCountSlider.oninput = function() {
    groupCountLabel.textContent = this.value;
}

applyGroupCountBtn.onclick = () => {
    const newCount = parseInt(groupCountSlider.value);
    if(confirm(`Are you sure you want to change to ${newCount} groups? This will RESET the experience for everyone.`)) {
        socket.emit('updateGroupCount', { count: newCount });
    }
}

// Drag and Drop Functions
window.allowDrop = function(ev) {
    ev.preventDefault();
}

window.drag = function(ev) {
    ev.dataTransfer.setData("text/plain", ev.target.dataset.socketId);
    ev.target.classList.add('dragging');
}

window.drop = function(ev) {
    ev.preventDefault();
    const socketId = ev.dataTransfer.getData("text/plain");
    const target = ev.target.closest('.group-users');
    
    if (target && socketId) {
        const newGroupId = target.parentElement.dataset.groupId;
        console.log(`Moving ${socketId} to Group ${newGroupId}`);
        
        socket.emit('updateUserGroup', {
            socketId: socketId,
            group: newGroupId
        });
    }
    
    // Cleanup visual state
    const draggedEl = document.querySelector(`.user-item[data-socket-id="${socketId}"]`);
    if (draggedEl) draggedEl.classList.remove('dragging');
}


// Render Users
function renderUsers() {
    // Clear all group lists
    for (let i = 1; i <= currentGroupCount; i++) {
        const el = document.getElementById(`group-${i}-users`);
        if (el) el.innerHTML = '';
    }

    Object.values(users).forEach(user => {
        const groupId = user.track || 1; // Default to 1 if missing
        
        // If user is in a group higher than current count, visually put them in "Extras" or just last group?
        // Actually server handles reassignment on reset/sort.
        // Just ensure we don't crash if group doesn't exist.
        const container = document.getElementById(`group-${groupId}-users`);
        
        if (container) {
            const userDiv = document.createElement('div');
            userDiv.className = `user-item ${selectedUsers.has(user.socketId) ? 'selected' : ''}`;
            userDiv.draggable = true;
            userDiv.dataset.socketId = user.socketId;
            userDiv.ondragstart = window.drag;
            userDiv.onclick = (e) => {
                e.stopPropagation();
                toggleUserSelection(user.socketId);
            };

            const isSelected = selectedUsers.has(user.socketId);
            
            let statusText = 'Online';
            let statusColor = '#666';
            let backgroundColor = ''; // Default background

            if (user.status) {
                const s = user.status;
                if (s.state === 'trigger') {
                    const minutes = Math.floor(s.time / 60);
                    const seconds = Math.floor(s.time % 60);
                    const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    let durationFormatted = '';
                    if (s.duration && !isNaN(s.duration) && s.duration > 0) {
                        const durMinutes = Math.floor(s.duration / 60);
                        const durSeconds = Math.floor(s.duration % 60);
                        durationFormatted = ` / ${durMinutes.toString().padStart(2, '0')}:${durSeconds.toString().padStart(2, '0')}`;
                    }
                    statusText = `Playing ${s.file} (${timeFormatted}${durationFormatted})`;
                    statusColor = 'red';
                    backgroundColor = '#ffffe0'; // Light yellow for playing trigger
                } else if (s.state === 'stem') {
                    // Show specific track name if available
                    const minutes = Math.floor(s.time / 60);
                    const seconds = Math.floor(s.time % 60);
                    const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                    let durationFormatted = '';
                    if (s.duration && !isNaN(s.duration) && s.duration > 0) {
                        const durMinutes = Math.floor(s.duration / 60);
                        const durSeconds = Math.floor(s.duration % 60);
                        durationFormatted = ` / ${durMinutes.toString().padStart(2, '0')}:${durSeconds.toString().padStart(2, '0')}`;
                    }
                    statusText = `Playing ${s.file} (${timeFormatted}${durationFormatted})`;
                    statusColor = 'green';
                } else if (s.state === 'paused') {
                    statusText = `Paused/Waiting`;
                }
            }
            
            // Show Pending Cue
            let cueHtml = '';
            if (user.cuedTrack) {
                const type = user.cuedTrack.isLastClip ? '<span style="color:red">(END)</span>' : '';
                cueHtml = `<div style="color: blue; font-weight: bold; font-size: 0.8rem;">[READY${type}: ${user.cuedTrack.filename}]</div>`;
            }
            
            // Show History
            let historyHtml = '';
            if (user.triggerHistory && user.triggerHistory.length > 0) {
                historyHtml = `<div style="font-size: 0.75rem; color: #888; margin-top: 2px;">History: ${user.triggerHistory.join(', ')}</div>`;
                if (!backgroundColor) backgroundColor = '#e0f7fa'; // Light blue for history (if not playing trigger)
            }

            userDiv.style.backgroundColor = backgroundColor; // Apply background color

            userDiv.innerHTML = `
                <div style="display:flex; align-items:center;">
                    <input type="checkbox" class="checkbox" ${isSelected ? 'checked' : ''} pointer-events="none">
                    <div>
                        <div>User ${user.id.substring(0, 6)}</div>
                        <div class="user-status" style="color: ${statusColor}">${statusText}</div>
                        ${cueHtml}
                        ${historyHtml}
                    </div>
                </div>
            `;
            container.appendChild(userDiv);
        }
    });
    
    // Update group checkbox states
    for (let i = 1; i <= currentGroupCount; i++) {
        const groupUsers = Object.values(users).filter(u => u.track == i.toString());
        const checkbox = document.querySelector(`.group-checkbox[data-group="${i}"]`);
        
        if (checkbox) {
            if (groupUsers.length > 0 && groupUsers.every(u => selectedUsers.has(u.socketId))) {
                checkbox.checked = true;
                checkbox.indeterminate = false;
            } else if (groupUsers.length > 0 && groupUsers.some(u => selectedUsers.has(u.socketId))) {
                checkbox.checked = false;
                checkbox.indeterminate = true;
            } else {
                checkbox.checked = false;
                checkbox.indeterminate = false;
            }
        }
    }
    
    updateButtons();
}

// Render Audio Files
function renderAudioFiles() {
    audioList.innerHTML = '';
    hiddenAudioList.innerHTML = '';
    
    let visibleCount = 0;
    let hiddenCount = 0;

    audioFiles.forEach(file => {
        const isHidden = hiddenFiles.has(file);
        const container = isHidden ? hiddenAudioList : audioList;
        
        if (isHidden) hiddenCount++;
        else visibleCount++;

        const div = document.createElement('div');
        div.className = `audio-item ${selectedAudio === file ? 'selected' : ''}`;
        // Only allow selecting if visible? Or allow hidden too? Probably fine to allow hidden selection if you really want to.
        div.onclick = () => selectAudio(file);
        
        const eyeIcon = isHidden ? '👁️' : '👁️‍🗨️'; // Simple text icons for now, can use proper icons if available
        const eyeTitle = isHidden ? 'Unhide' : 'Hide';

        div.innerHTML = `
            <div style="display: flex; align-items: center; width: 100%;">
                <input type="checkbox" class="checkbox" ${selectedAudio === file ? 'checked' : ''}>
                <span style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis;">${file}</span>
                
                <button onclick="event.stopPropagation(); toggleHideAudio('${file}')" title="${eyeTitle}" style="width: auto; padding: 2px 5px; font-size: 0.8rem; background: #ddd; border: 1px solid #999; border-radius: 3px; margin-left: 5px; cursor: pointer;">
                    ${isHidden ? 'Show' : 'Hide'}
                </button>
                
                <button onclick="event.stopPropagation(); deleteAudio('${file}')" title="Delete" style="width: auto; padding: 2px 8px; font-size: 0.7rem; background: #ff4d4d; color: white; border: none; border-radius: 3px; margin-left: 5px;">X</button>
            </div>
        `;
        container.appendChild(div);
    });
    
    // Show/Hide the hidden container
    hiddenFilesContainer.style.display = hiddenCount > 0 ? 'block' : 'none';
    document.getElementById('hiddenCount').textContent = hiddenCount;
}

window.toggleHiddenList = function() {
    const list = document.getElementById('hiddenAudioList');
    const arrow = document.getElementById('hiddenListArrow');
    
    if (list.style.display === 'none') {
        list.style.display = 'block';
        arrow.style.transform = 'rotate(0deg)';
    } else {
        list.style.display = 'none';
        arrow.style.transform = 'rotate(-90deg)';
    }
}

window.toggleHideAudio = function(filename) {
    socket.emit('toggleHideAudioFile', filename);
}

window.deleteAudio = function(filename) {
    if (confirm(`Are you sure you want to PERMANENTLY delete ${filename}?`)) {
        socket.emit('deleteAudioFile', filename);
    }
}

// Selection Logic
function toggleUserSelection(socketId) {
    if (selectedUsers.has(socketId)) {
        selectedUsers.delete(socketId);
    } else {
        selectedUsers.add(socketId);
    }
    renderUsers();
    checkSelectAllState();
}

function toggleGroupSelection(groupId) {
    // Find all users in this group
    const groupUsers = Object.values(users).filter(u => u.track == groupId);
    const allSelected = groupUsers.every(u => selectedUsers.has(u.socketId));
    
    groupUsers.forEach(u => {
        if (allSelected) {
            selectedUsers.delete(u.socketId);
        } else {
            selectedUsers.add(u.socketId);
        }
    });
    renderUsers();
    checkSelectAllState();
}

function selectAudio(filename) {
    if (selectedAudio === filename) {
        selectedAudio = null;
    } else {
        selectedAudio = filename;
    }
    renderAudioFiles();
    updateButtons();
}

function checkSelectAllState() {
    const allUserIds = Object.keys(users);
    if (allUserIds.length > 0 && allUserIds.every(id => selectedUsers.has(id))) {
        selectAllBtn.checked = true;
    } else {
        selectAllBtn.checked = false;
    }
}

selectAllBtn.onclick = () => {
    if (selectAllBtn.checked) {
        Object.keys(users).forEach(id => selectedUsers.add(id));
    } else {
        selectedUsers.clear();
    }
    renderUsers();
    updateButtons();
};

function updateButtons() {
    const hasUsers = selectedUsers.size > 0;
    const hasAudio = selectedAudio !== null;
    const anyCued = Object.values(users).some(u => u.cuedTrack);
    const selectedHasCue = Array.from(selectedUsers).some(id => users[id] && users[id].cuedTrack);
    
    if (loadCueBtn) loadCueBtn.disabled = !(hasUsers && hasAudio);
    if (triggerCuesBtn) triggerCuesBtn.disabled = !anyCued;
    if (clearCuesBtn) clearCuesBtn.disabled = !(selectedHasCue || anyCued); // Can clear selected or logic for all? Let's just enable if any cues exist for simplicity or selected
    if (stopAudioBtn) stopAudioBtn.disabled = !hasUsers;
}

// Button Handlers
loadCueBtn.onclick = () => {
    if (selectedUsers.size > 0 && selectedAudio) {
        socket.emit('loadCue', {
            targets: Array.from(selectedUsers),
            filename: selectedAudio,
            isLastClip: isLastClipCheckbox.checked
        });
    }
};

triggerCuesBtn.onclick = () => {
    socket.emit('triggerAllCues');
};

clearCuesBtn.onclick = () => {
    // If users selected, clear them. Else, clear all?
    // For safety, let's clear selected if any, otherwise ask to clear all.
    if (selectedUsers.size > 0) {
        socket.emit('clearCues', { targets: Array.from(selectedUsers) });
    } else {
        if (confirm("Clear ALL pending cues?")) {
             // Collect all IDs with cues
             const targets = Object.values(users).filter(u => u.cuedTrack).map(u => u.socketId);
             socket.emit('clearCues', { targets: targets });
        }
    }
};

stopAudioBtn.onclick = () => {
    if (selectedUsers.size > 0) {
        socket.emit('stopAudio', {
            targets: Array.from(selectedUsers)
        });
    }
};

sortPlayersBtn.onclick = () => {
    if(confirm("Are you sure you want to shuffle and sort all players evenly?")) {
        socket.emit('sortPlayers');
    }
};

playStemBtn.onclick = () => {
    socket.emit('playStem');
};

pauseStemBtn.onclick = () => {
    socket.emit('pauseStem');
};

resetExperienceBtn.onclick = () => {
    if (confirm("Are you sure you want to RESET the entire experience? This will stop all audio and reset state.")) {
        socket.emit('resetExperience');
    }
};


// Update Global Timer
socket.on('playbackStatus', (data) => {
    // data: { status: 'playing'/'paused', elapsedTime: number }
    if (data.status === 'playing' || data.status === 'playingLoop') {
        const minutes = Math.floor(data.elapsedTime / 60);
        const seconds = Math.floor(data.elapsedTime % 60);
        globalTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        // If paused, maybe show paused state or keep last time?
        // Let's assume the server sends 0 or valid time.
        // If paused, we might want to indicate it.
        if (data.elapsedTime > 0) {
             const minutes = Math.floor(data.elapsedTime / 60);
             const seconds = Math.floor(data.elapsedTime % 60);
             globalTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} (PAUSED)`;
        } else {
             // If stopped (0), show 00:00 (STOPPED)
             // But wait, if we just paused and elapsedTime is 0, that means we reset?
             // No, pausedTime in app.js is what matters.
             // The server sends 'pausedTime' in the payload too.
             
             let timeToShow = 0;
             if (data.pausedTime !== undefined && data.pausedTime !== null) {
                 timeToShow = data.pausedTime;
             } else if (data.elapsedTime > 0) {
                 timeToShow = data.elapsedTime;
             }
             
             if (timeToShow > 0) {
                 const minutes = Math.floor(timeToShow / 60);
                 const seconds = Math.floor(timeToShow % 60);
                 globalTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} (PAUSED)`;
             } else {
                 globalTimer.textContent = "00:00 (STOPPED)";
             }
        }
    }
});

// Socket Events
socket.on('connect', () => {
    initGroups();
});

socket.on('userList', (data) => {
    // Merge updates if we have them? Or just replace.
    // Replacing is safer for full sync.
    // We need to preserve local selection state though, which renderUsers does (based on IDs).
    users = data;
    renderUsers();
});

socket.on('userStatusUpdate', (data) => {
    // data: { socketId, status }
    if (users[data.socketId]) {
        users[data.socketId].status = data.status;
        
        // Find the specific DOM element to update
        const userDiv = document.querySelector(`.user-item[data-socket-id="${data.socketId}"]`);
        const userEl = userDiv ? userDiv.querySelector('.user-status') : null;
        
        if (userEl && userDiv) {
            let statusText = 'Online';
            const s = data.status;
            let backgroundColor = '';

            if (s.state === 'trigger') {
                const minutes = Math.floor(s.time / 60);
                const seconds = Math.floor(s.time % 60);
                const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                let durationFormatted = '';
                if (s.duration && !isNaN(s.duration) && s.duration > 0) {
                    const durMinutes = Math.floor(s.duration / 60);
                    const durSeconds = Math.floor(s.duration % 60);
                    durationFormatted = ` / ${durMinutes.toString().padStart(2, '0')}:${durSeconds.toString().padStart(2, '0')}`;
                }
                statusText = `Playing ${s.file} (${timeFormatted}${durationFormatted})`;
                userEl.style.color = 'red';
                backgroundColor = '#ffffe0'; // Light yellow
            } else if (s.state === 'stem') {
                const minutes = Math.floor(s.time / 60);
                const seconds = Math.floor(s.time % 60);
                const timeFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                let durationFormatted = '';
                if (s.duration && !isNaN(s.duration) && s.duration > 0) {
                    const durMinutes = Math.floor(s.duration / 60);
                    const durSeconds = Math.floor(s.duration % 60);
                    durationFormatted = ` / ${durMinutes.toString().padStart(2, '0')}:${durSeconds.toString().padStart(2, '0')}`;
                }
                statusText = `Playing ${s.file} (${timeFormatted}${durationFormatted})`;
                userEl.style.color = 'green';
            } else if (s.state === 'paused') {
                statusText = `Paused/Waiting`;
                userEl.style.color = '#666';
            }
            
            userEl.textContent = statusText;
            
            // Check history for background color if not playing trigger
            if (!backgroundColor && users[data.socketId].triggerHistory && users[data.socketId].triggerHistory.length > 0) {
                backgroundColor = '#e0f7fa'; // Light blue
            }
            
            userDiv.style.backgroundColor = backgroundColor;
        }
    }
});

socket.on('audioFilesList', (files) => {
    audioFiles = files;
    renderAudioFiles();
});

socket.on('hiddenFilesUpdate', (files) => {
    hiddenFiles = new Set(files);
    renderAudioFiles();
});

socket.on('groupCountUpdate', (data) => {
    currentGroupCount = data.count;
    groupCountSlider.value = currentGroupCount;
    groupCountLabel.textContent = currentGroupCount;
    initGroups();
    renderUsers(); // Re-render users into new group structure
});

socket.on('groupTracksUpdate', (data) => {
    groupTracks = data;
    initGroups(); // Re-render groups to update dropdowns
    renderUsers();
});

// Initial Load
initGroups();
