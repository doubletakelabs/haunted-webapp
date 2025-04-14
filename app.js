let express = require("express");
let app = express();
let server = require("http").createServer(app);
const cors = require("cors");
io = require("socket.io")(server, {
  handlePreflightRequest: (req, res) => {
    const headers = {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Origin": req.headers.origin,
      "Access-Control-Allow-Credentials": true,
    };
    res.writeHead(200, headers);
    res.end();
  },
});
const cookieParser = require("cookie-parser");

// Get port from command line or use default
const port = process.argv[2] || 3000;

let connectedUsers = {}; // Store connected users and their assigned roles

// Track the next role to assign
let nextRoleIndex = 0;
const roles = ['Human', 'Bot', 'Glitched'];

// Track who is the last human
let lastHumanSocketId = null;

// Generate the next role in the cycle
function getNextRole() {
  const role = roles[nextRoleIndex];
  nextRoleIndex = (nextRoleIndex + 1) % roles.length;
  return role;
}

app.use(cors());
app.use(cookieParser("doubletakelabs-haunted"));
app.use(express.json());

app.use(function (req, res, next) {
  var cookie = req.signedCookies["connect.sid"];
  if (cookie === undefined) {
    var randomNumber = Math.random().toString();
    randomNumber = randomNumber.substring(2, randomNumber.length);
    res.cookie("connect.sid", randomNumber, {
      maxAge: 7200000,
      httpOnly: false,
      signed: true,
    });
  }
  next();
});

function getCookieID(str) {
  if (str == undefined) {
    return "none";
  }
  try {
    let inputString = str.split("connect.sid=")[1];
    if (inputString && inputString.includes(";")) {
      inputString = inputString.substring(0, inputString.indexOf(";"));
    }
    return inputString || "none";
  } catch (error) {
    console.log(error);
    return "none";
  }
}

// Get role from cookie string
function getRoleFromCookie(str) {
  if (str == undefined) {
    return null;
  }
  try {
    const cookies = str.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'hvbRole') {
        return value;
      }
    }
    return null;
  } catch (error) {
    console.log(error);
    return null;
  }
}

// Simple event logging function
function logEvent(userID, timestamp, event) {
  console.log(`User ${userID} at ${timestamp}: ${JSON.stringify(event)}`);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static(`${__dirname}/public`));

// Serve manifest.json at root level
app.get("/manifest.json", function (req, res) {
  res.sendFile(`${__dirname}/manifest.json`);
});

// Main route with persistent role assignment
app.get("/", function (req, res) {
  // Check if user already has an assigned role
  const existingRole = req.cookies.hvbRole;
  
  if (!existingRole) {
    // Assign the next role in the cycle
    const newRole = getNextRole();
    
    // Set the role in a cookie
    res.cookie("hvbRole", newRole, { 
      maxAge: 7200000, 
      httpOnly: false,
      path: "/"
    });
    console.log(`New visitor assigned to role: ${newRole}`);
  } else {
    console.log(`Returning visitor with role: ${existingRole}`);
  }
  
  res.sendFile(`${__dirname}/html/hvb.html`);
});

// Admin route
app.get("/admin", function (req, res) {
  res.sendFile(`${__dirname}/html/admin.html`);
});

// Send current user list to admins
function updateAdminsWithUserList() {
  io.to("admin").emit("userList", connectedUsers);
}

io.on("connection", function (socket) {
  console.log("a visitor connected");
  
  // Get user ID from cookie
  let userID = getCookieID(socket.request.headers.cookie);
  let timestamp = new Date(new Date().toUTCString());
  
  // Check if this is an admin connection
  const isAdmin = socket.handshake.query.client === 'admin';
  
  if (isAdmin) {
    socket.join("admin");
    console.log("Admin connected");
    // Send current user list to the admin
    socket.emit("userList", connectedUsers);
  } else {
    socket.join("app");
    
    // Get role from cookie
    const role = getRoleFromCookie(socket.request.headers.cookie) || 'unassigned';
    
    // Store user info
    connectedUsers[socket.id] = {
      id: userID,
      role: role,
      connectedAt: timestamp.toLocaleString(),
      socketId: socket.id,
      isLastHuman: false
    };
    
    // Notify admins about the new user
    updateAdminsWithUserList();
  }

  logEvent(userID, timestamp, { event: "connected" });

  // Update role information when client reports it
  socket.on("reportRole", function(data) {
    if (connectedUsers[socket.id]) {
      connectedUsers[socket.id].role = data.role;
      updateAdminsWithUserList();
    }
  });

  // Handle admin choosing the last human
  socket.on("chooseLastHuman", function() {
    if (isAdmin) {
      // Reset any previous last human
      if (lastHumanSocketId && connectedUsers[lastHumanSocketId]) {
        connectedUsers[lastHumanSocketId].isLastHuman = false;
      }
      
      // Get all connected user socket IDs
      const userSocketIds = Object.keys(connectedUsers);
      
      if (userSocketIds.length > 0) {
        // Choose a random user
        const randomIndex = Math.floor(Math.random() * userSocketIds.length);
        lastHumanSocketId = userSocketIds[randomIndex];
        
        // Mark the chosen user as the last human
        connectedUsers[lastHumanSocketId].isLastHuman = true;
        
        console.log(`Last human chosen: ${connectedUsers[lastHumanSocketId].id}`);
        
        // Notify all clients
        io.to(lastHumanSocketId).emit("youAreLastHuman");
        
        // Notify the admin
        io.to("admin").emit("lastHumanChosen", {
          id: connectedUsers[lastHumanSocketId].id
        });
      }
    }
  });

  socket.on("event", function (msg) {
    let user = getCookieID(socket.request.headers.cookie);
    let timestamp = new Date(new Date().toUTCString());
    logEvent(user, timestamp, msg.event);
  });

  socket.on("resetRoles", function () {
    console.log("Roles reset by admin");
    // Clear all role cookies and force refresh
    io.in("app").emit("clearRoleCookie");
    io.in("app").emit("forceRefresh");
  });

  socket.on("disconnect", function () {
    console.log("a visitor disconnected");
    
    // If this was the last human, clear the status
    if (lastHumanSocketId === socket.id) {
      lastHumanSocketId = null;
    }
    
    // Remove user from connected users
    if (connectedUsers[socket.id]) {
      delete connectedUsers[socket.id];
      // Update admins with the new user list
      updateAdminsWithUserList();
    }
    
    let event = { event: "disconnected" };
    let user = getCookieID(socket.request.headers.cookie);
    let timestamp = new Date(new Date().toUTCString());
    logEvent(user, timestamp, event);
  });
});

server.listen(parseInt(port), function () {
  console.log(`HVB server listening on port ${port}`);
});
