const socket = io({
    query: { client: 'admin' }
});

// State
let users = {}; // { socketId: { ... } }
let audioFiles = [];
let selectedUsers = new Set(); // Set of socketIds
let selectedAudio = null; // Filename

// DOM Elements
const groupsContainer = document.getElementById('groupsContainer');
const audioList = document.getElementById('audioList');
const applyAudioBtn = document.getElementById('applyAudioBtn');
const stopAudioBtn = document.getElementById('stopAudioBtn');
const sortPlayersBtn = document.getElementById('sortPlayersBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const playStemBtn = document.getElementById('playStemBtn');
const pauseStemBtn = document.getElementById('pauseStemBtn');
const resetExperienceBtn = document.getElementById('resetExperienceBtn');
const isLastClipCheckbox = document.getElementById('isLastClip');

// Initialize Groups
function initGroups() {
    groupsContainer.innerHTML = '';
    for (let i = 1; i <= 6; i++) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'group-container';
        groupDiv.dataset.groupId = i;
        groupDiv.innerHTML = `
            <div class="group-header" onclick="toggleGroupSelection(${i})">
                <input type="checkbox" class="checkbox group-checkbox" data-group="${i}">
                GROUP ${i}
            </div>
            <div class="group-users" id="group-${i}-users" ondrop="drop(event)" ondragover="allowDrop(event)"></div>
        `;
        groupsContainer.appendChild(groupDiv);
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
    for (let i = 1; i <= 6; i++) {
        const el = document.getElementById(`group-${i}-users`);
        if (el) el.innerHTML = '';
    }

    Object.values(users).forEach(user => {
        const groupId = user.track || 1; // Default to 1 if missing
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
            
            userDiv.innerHTML = `
                <div style="display:flex; align-items:center;">
                    <input type="checkbox" class="checkbox" ${isSelected ? 'checked' : ''} pointer-events="none">
                    <div>
                        <div>User ${user.id.substring(0, 6)}</div>
                        <div class="user-status">Online</div>
                    </div>
                </div>
            `;
            container.appendChild(userDiv);
        }
    });
    updateButtons();
}

// Render Audio Files
function renderAudioFiles() {
    audioList.innerHTML = '';
    audioFiles.forEach(file => {
        const div = document.createElement('div');
        div.className = `audio-item ${selectedAudio === file ? 'selected' : ''}`;
        div.onclick = () => selectAudio(file);
        div.innerHTML = `
            <input type="checkbox" class="checkbox" ${selectedAudio === file ? 'checked' : ''}>
            ${file}
        `;
        audioList.appendChild(div);
    });
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
    
    applyAudioBtn.disabled = !(hasUsers && hasAudio);
    stopAudioBtn.disabled = !hasUsers;
}

// Button Handlers
applyAudioBtn.onclick = () => {
    if (selectedUsers.size > 0 && selectedAudio) {
        socket.emit('applyAudio', {
            targets: Array.from(selectedUsers),
            filename: selectedAudio,
            isLastClip: isLastClipCheckbox.checked
        });
        
        // Uncheck after sending if it was checked? Or keep it?
        // User might want to send multiple last clips. Keep it.
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
        // Update specific user element if possible, or re-render
        // Let's find the specific DOM element to update text
        const userEl = document.querySelector(`.user-item[data-socket-id="${data.socketId}"] .user-status`);
        if (userEl) {
            let statusText = 'Online';
            const s = data.status;
            if (s.state === 'trigger') statusText = `Playing ${s.file}`;
            else if (s.state === 'stem') statusText = `Playing Stem (${Math.round(s.time)}s)`;
            else if (s.state === 'paused') statusText = `Paused/Waiting`;
            
            userEl.textContent = statusText;
            userEl.style.color = s.state === 'trigger' ? 'red' : (s.state === 'stem' ? 'green' : '#666');
        }
    }
});

socket.on('audioFilesList', (files) => {
    audioFiles = files;
    renderAudioFiles();
});

// Initial Load
initGroups();
