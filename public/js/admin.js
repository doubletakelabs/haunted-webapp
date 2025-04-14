// Connect to socket.io
const socket = io({
    query: {
        client: 'admin'
    }
});

// DOM Elements
const resetRolesBtn = document.getElementById('resetRoles');
const chooseLastHumanBtn = document.getElementById('chooseLastHuman');
const userList = document.getElementById('userList');
const statusInfo = document.getElementById('statusInfo');

// Log function for status updates
function log(message) {
    const timestamp = new Date().toLocaleTimeString();
    statusInfo.innerHTML = `[${timestamp}] ${message}\n${statusInfo.innerHTML}`;
}

// Update user list
function updateUserList(users) {
    userList.innerHTML = '';
    
    if (Object.keys(users).length === 0) {
        userList.innerHTML = '<div class="user-item">No users connected</div>';
        return;
    }
    
    Object.values(users).forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = `user-item ${user.role.toLowerCase()}`;
        userItem.innerHTML = `
            <strong>ID:</strong> ${user.id}<br>
            <strong>Role:</strong> ${user.role}<br>
            <strong>Connected:</strong> ${user.connectedAt}
        `;
        userList.appendChild(userItem);
    });
}

// Event Listeners
resetRolesBtn.addEventListener('click', () => {
    socket.emit('resetRoles');
    log('Reset roles command sent to all clients');
});

chooseLastHumanBtn.addEventListener('click', () => {
    socket.emit('chooseLastHuman');
    log('Last Human has been chosen!');
});

// Socket Event Listeners
socket.on('connect', () => {
    log('Connected to server');
});

socket.on('disconnect', () => {
    log('Disconnected from server');
});

socket.on('userList', (users) => {
    updateUserList(users);
    log(`Updated user list: ${Object.keys(users).length} users connected`);
});

socket.on('lastHumanChosen', (data) => {
    log(`The Last Human has been chosen: ${data.id}`);
});

// Initial log
log('Admin panel initialized'); 